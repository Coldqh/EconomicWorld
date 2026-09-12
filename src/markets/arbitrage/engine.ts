import { bankAccountBalance, bankAccountsForOwner } from "../../core/ledger.ts";
import type { DerivativeContract, MarketOrder, WorldState } from "../../domain/model.ts";
import { executeFxConversion, quoteFxConversion } from "../../finance/fx-market.ts";
import { createFuture } from "../../finance/derivatives.ts";
import { openBrokerageAccount, placeOrder } from "../exchange.ts";
import { bestOrder, brokerageForOwnerCurrency, marketRuntimeIndex } from "../runtime-index.ts";

function active(world: WorldState, securityId: string, exchangeId: string, side: MarketOrder["side"]): MarketOrder | undefined {
  return bestOrder(world, securityId, exchangeId, side, false);
}
export function consolidatedQuote(world: WorldState, securityId: string) {
  const topology = marketRuntimeIndex(world);
  const venues = (topology.securityVenueIndex.get(securityId) ?? []).map((exchangeId) => ({ exchangeId, bid: active(world, securityId, exchangeId, "buy"), ask: active(world, securityId, exchangeId, "sell") }));
  let bestBid: typeof venues[number] | null = null;
  let bestAsk: typeof venues[number] | null = null;
  for (const venue of venues) {
    if (venue.bid && (!bestBid?.bid || venue.bid.limitPriceCents! > bestBid.bid.limitPriceCents!)) bestBid = venue;
    if (venue.ask && (!bestAsk?.ask || venue.ask.limitPriceCents! < bestAsk.ask.limitPriceCents!)) bestAsk = venue;
  }
  return { venues, bestBid, bestAsk };
}
export function routeOrder(world: WorldState, brokerageAccountId: string, securityId: string, side: "buy" | "sell", quantity: number) {
  const quote = consolidatedQuote(world, securityId); const venue = side === "buy" ? quote.bestAsk : quote.bestBid; return venue ? placeOrder(world, brokerageAccountId, securityId, side, "market", quantity, null, venue.exchangeId) : { ok: false, message: "Нет исполнимой ликвидности" };
}
export function runCrossVenueArbitrage(world: WorldState): number {
  let count = 0;
  const topology = marketRuntimeIndex(world);
  for (const securityId of topology.crossListedSecurityIds) {
    const q = consolidatedQuote(world, securityId); if (!q.bestAsk?.ask || !q.bestBid?.bid || q.bestAsk.exchangeId === q.bestBid.exchangeId) continue;
    const buyExchange = topology.exchangeById.get(q.bestAsk.exchangeId)!; const sellExchange = topology.exchangeById.get(q.bestBid.exchangeId)!; const costsBps = buyExchange.brokerFeeBps + buyExchange.exchangeFeeBps + sellExchange.brokerFeeBps + sellExchange.exchangeFeeBps + 10;
    const ask = q.bestAsk.ask.limitPriceCents!; const bid = q.bestBid.bid.limitPriceCents!; if ((bid - ask) * 10_000 <= ask * costsBps) continue;
    const agent = world.marketAgents.find((item) => item.kind === "arbitrageur" && item.active && item.exchangeIds.includes(buyExchange.id) && item.exchangeIds.includes(sellExchange.id)); if (!agent) continue;
    openBrokerageAccount(world, agent.ownerId);
    const account = brokerageForOwnerCurrency(world, agent.ownerId, buyExchange.currencyId);
    if (!account) continue;
    const actualCash = bankAccountsForOwner(world, agent.ownerId, buyExchange.currencyId).reduce((sum, item) => sum + bankAccountBalance(world, item.id), 0);
    const quantity = Math.max(0, Math.min(q.bestAsk.ask.remainingQuantity, q.bestBid.bid.remainingQuantity, Math.floor(Math.min(agent.capitalMinor, actualCash) / Math.max(1, ask))));
    if (quantity <= 0) continue;
    // Execute the buy first and only sell inventory actually acquired. This preserves
    // ownership constraints when one venue only partially fills and makes execution
    // risk explicit instead of assuming both legs always clear.
    const buy = placeOrder(world, account.id, securityId, "buy", "limit", quantity, ask, buyExchange.id);
    const filledBuy = buy.filledQuantity ?? 0;
    const sell = filledBuy > 0 ? placeOrder(world, account.id, securityId, "sell", "limit", filledBuy, bid, sellExchange.id) : { ok: false as const, message: "Покупка не исполнилась" };
    const filledSell = sell.filledQuantity ?? 0;
    const filled = Math.min(filledBuy, filledSell);
    const costs = Math.round(filled * ask * costsBps / 10_000);
    world.arbitrageRecords.push({ id: `arb-${world.arbitrageRecords.length + 1}`, type: "cross-venue", agentId: agent.id, legs: [buy.orderId ?? "", sell.orderId ?? ""], expectedProfitMinor: quantity * (bid - ask) - Math.round(quantity * ask * costsBps / 10_000), realizedProfitMinor: filled * (bid - ask) - costs, costsMinor: costs, elapsedMonth: world.clock.elapsedMonths, status: filledBuy === quantity && filledSell === quantity ? "executed" : filledBuy || filledSell ? "partial" : "rejected" });
    count += 1;
  }
  return count;
}
export function runTriangularFxArbitrage(world: WorldState, ownerId: string, currencies: [string, string, string], capitalMinor: number): boolean {
  const [a, b, c] = currencies; const q1 = quoteFxConversion(world, a, b, capitalMinor); const q2 = q1 && quoteFxConversion(world, b, c, q1.amountToMinor); const q3 = q2 && quoteFxConversion(world, c, a, q2.amountToMinor); if (!q1 || !q2 || !q3 || q3.amountToMinor <= capitalMinor) return false;
  const aa = bankAccountsForOwner(world, ownerId, a)[0]; const ab = bankAccountsForOwner(world, ownerId, b)[0]; const ac = bankAccountsForOwner(world, ownerId, c)[0]; if (!aa || !ab || !ac) return false;
  const t1 = executeFxConversion(world, ownerId, aa.id, ab.id, capitalMinor); if (!t1.ok) return false; const t2 = executeFxConversion(world, ownerId, ab.id, ac.id, t1.quote!.amountToMinor); if (!t2.ok) return false; const t3 = executeFxConversion(world, ownerId, ac.id, aa.id, t2.quote!.amountToMinor); if (!t3.ok) return false;
  world.arbitrageRecords.push({ id: `arb-${world.arbitrageRecords.length + 1}`, type: "fx-triangle", agentId: ownerId, legs: [t1.tradeId!, t2.tradeId!, t3.tradeId!], expectedProfitMinor: q3.amountToMinor - capitalMinor, realizedProfitMinor: t3.quote!.amountToMinor - capitalMinor, costsMinor: q1.feeMinor + q2.feeMinor + q3.feeMinor, elapsedMonth: world.clock.elapsedMonths, status: "executed" }); return true;
}

export function runAutonomousTriangularFxArbitrage(world: WorldState): number {
  let executed = 0;
  const topology = marketRuntimeIndex(world);
  for (const [ownerId, triangles] of topology.fxTrianglesByOwner) {
    const agent = topology.arbitrageAgents.find((item) => item.ownerId === ownerId);
    if (!agent) continue;
    const accounts = bankAccountsForOwner(world, agent.ownerId).filter((item) => item.status === "active");
    for (const currencies of triangles) {
      const first = accounts.find((item) => item.currencyId === currencies[0]);
      if (!first) continue;
      const capital = Math.min(agent.capitalMinor, Math.floor(bankAccountBalance(world, first.id) / 4));
      if (capital > 0 && runTriangularFxArbitrage(world, agent.ownerId, currencies, capital)) { executed += 1; break; }
    }
  }
  return executed;
}
export function evaluateCashAndCarry(world: WorldState, ownerId: string): number {
  let opportunities = 0;
  const futures = world.derivativeContracts.filter((item): item is Extract<DerivativeContract, { type: "future" }> => item.type === "future" && item.status === "active");
  for (const contract of futures) {
    if (contract.underlying.kind !== "equity") continue;
    const underlyingSecurityId = contract.underlying.securityId;
    const listing = world.listings.find((item) => item.securityId === underlyingSecurityId && item.exchangeId === contract.exchangeId);
    if (!listing || world.arbitrageRecords.some((item) => item.type === "cash-and-carry" && item.agentId === ownerId && item.legs.includes(contract.id) && item.elapsedMonth === world.clock.elapsedMonths)) continue;
    const months = Math.max(1, contract.maturityMonth - world.clock.elapsedMonths);
    const policy = world.centralBanks.find((item) => item.currencyId === listing.currencyId && item.setsPolicyRate)?.policyRateBps ?? 0;
    const issuerId = world.equitySecurities.find((item) => item.id === underlyingSecurityId)?.companyId;
    const annualDividends = world.corporateActions.filter((item) => item.companyId === issuerId && item.type === "dividend" && item.elapsedMonth > world.clock.elapsedMonths - 12).reduce((sum, item) => sum + item.amountCents, 0);
    const sharesOutstanding = world.equitySecurities.find((item) => item.id === underlyingSecurityId)?.sharesOutstanding ?? 0;
    const dividendCarryBps = Math.round(annualDividends * 10_000 / Math.max(1, sharesOutstanding * listing.lastPriceCents));
    const feeBps = (world.exchanges.find((item) => item.id === listing.exchangeId)?.exchangeFeeBps ?? 0) * 2 + 35;
    const fair = Math.round(listing.lastPriceCents * (1 + (policy - dividendCarryBps) / 10_000 * months / 12));
    const edge = contract.lastSettlementPriceMinor - fair;
    if (Math.abs(edge) * 10_000 <= fair * feeBps) continue;
    openBrokerageAccount(world, ownerId);
    const account = world.brokerageAccounts.find((item) => item.ownerId === ownerId && item.currencyId === listing.currencyId && item.status === "active");
    const settlement = account && world.bankAccounts.find((item) => account.settlementBankAccountIds.includes(item.id) && item.currencyId === listing.currencyId);
    const ownedShares = world.equityHoldings.find((item) => item.ownerId === ownerId && item.securityId === underlyingSecurityId)?.shares ?? 0;
    const capitalQuantity = settlement ? Math.floor(Math.max(0, bankAccountsForOwner(world, ownerId, listing.currencyId).reduce((sum, item) => sum + bankAccountBalance(world, item.id), 0)) / Math.max(1, listing.lastPriceCents * contract.contractSize)) : 0;
    const reverse = edge < 0;
    const quantity = Math.max(0, Math.min(contract.quantity, capitalQuantity, reverse ? Math.floor(ownedShares / contract.contractSize) : contract.quantity));
    const counterpartyId = world.fxDealers[0]?.id;
    if (!account || !counterpartyId || quantity <= 0) continue;
    const spotQuantity = quantity * contract.contractSize;
    const spot = placeOrder(world, account.id, underlyingSecurityId, reverse ? "sell" : "buy", "limit", spotQuantity, listing.lastPriceCents, listing.exchangeId);
    const hedge = createFuture(world, reverse ? ownerId : counterpartyId, reverse ? counterpartyId : ownerId, contract.underlying, contract.exchangeId, quantity, contract.contractSize, months);
    if (hedge) { hedge.initialPriceMinor = contract.lastSettlementPriceMinor; hedge.lastSettlementPriceMinor = contract.lastSettlementPriceMinor; hedge.lastMarkMinor = contract.lastSettlementPriceMinor; }
    const filledSpot = world.executionQuality.find((item) => item.orderId === spot.orderId)?.filledQuantity ?? 0;
    const entered = Boolean(hedge);
    const costs = Math.round(spotQuantity * listing.lastPriceCents * feeBps / 10_000);
    world.arbitrageRecords.push({ id: `arb-${world.arbitrageRecords.length + 1}`, type: "cash-and-carry", agentId: ownerId, legs: [spot.orderId ?? "", hedge?.id ?? "", contract.id], expectedProfitMinor: Math.abs(edge) * spotQuantity - costs, realizedProfitMinor: 0, costsMinor: costs, elapsedMonth: world.clock.elapsedMonths, status: entered && filledSpot === spotQuantity ? "executed" : entered || filledSpot > 0 ? "partial" : "rejected" });
    opportunities += 1;
  }
  return opportunities;
}
