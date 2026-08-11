import { emitSimpleEvent } from "../core/events.ts";
import { accountIds, bankAccountBalance, bankAccountsForOwner, depositOf, ensureAccount, postTransaction, primaryBankAccount, settleDepositPayment, transferBankAccountBalance } from "../core/ledger.ts";
import { transferShares } from "../corporate/finance.ts";
import type { BrokerageAccount, MarketOrder, MarketTrade, WorldState } from "../domain/model.ts";

export interface MarketResult {
  ok: boolean;
  message: string;
  orderId?: string;
  tradeIds?: string[];
}

function ownerCountryId(world: WorldState, ownerId: string): string | null {
  if (ownerId === world.player.householdId) return world.cities.find((city) => city.id === world.player.currentCityId)?.countryId ?? null;
  const explicitAccount = world.bankAccounts.find((account) => account.ownerId === ownerId && account.isPrimary && account.status === "active") ?? world.bankAccounts.find((account) => account.ownerId === ownerId && account.status === "active");
  if (explicitAccount) return world.banks.find((bank) => bank.id === explicitAccount.bankId)?.countryId ?? null;
  const household = world.households.find((item) => item.id === ownerId);
  const population = world.populationCohorts.find((item) => item.id === ownerId);
  const company = world.companies.find((item) => item.id === ownerId);
  const bankId = household?.bankId ?? population?.bankId ?? company?.bankId;
  return world.banks.find((bank) => bank.id === bankId)?.countryId ?? null;
}

export function openBrokerageAccount(world: WorldState, ownerId: string, brokerId?: string, settlementBankAccountId?: string): MarketResult {
  const countryId = ownerCountryId(world, ownerId);
  const broker = world.brokers.find((item) => item.id === brokerId) ?? world.brokers.find((item) => item.countryId === countryId);
  if (!countryId || !broker || broker.countryId !== countryId) return { ok: false, message: "Нет локального брокера" };
  const settlement = settlementBankAccountId
    ? world.bankAccounts.find((account) => account.id === settlementBankAccountId && account.ownerId === ownerId && account.status === "active")
    : bankAccountsForOwner(world, ownerId).find((account) => broker.supportedCurrencyIds.includes(account.currencyId));
  if (!settlement || !broker.supportedCurrencyIds.includes(settlement.currencyId)) return { ok: false, message: `Нужен расчётный счёт в ${broker.supportedCurrencyIds.join("/")}` };
  const existing = world.brokerageAccounts.find((account) => account.ownerId === ownerId && account.brokerId === broker.id && account.currencyId === settlement.currencyId && account.status === "active");
  if (existing) return { ok: true, message: "Брокерский счёт уже открыт" };
  const country = world.countries.find((item) => item.id === countryId)!;
  const account: BrokerageAccount = {
    id: `brokerage-${String(world.nextBrokerageAccountId++).padStart(6, "0")}`,
    brokerId: broker.id,
    ownerId,
    currencyId: settlement.currencyId,
    jurisdictionCountryId: country.id,
    settlementBankAccountIds: [settlement.id],
    openedAtMonth: world.clock.elapsedMonths,
    status: "active",
  };
  world.brokerageAccounts.push(account);
  if (ownerId === world.player.householdId && !world.player.brokerageAccountIds.includes(account.id)) world.player.brokerageAccountIds.push(account.id);
  emitSimpleEvent(world, "BrokerageOpened", "Открыт брокерский счёт", broker.name, [ownerId, broker.id], "positive");
  return { ok: true, message: "Брокерский счёт открыт" };
}

function executablePrice(buy: MarketOrder, sell: MarketOrder, lastPriceCents: number): number | null {
  const buyPrice = buy.type === "market" ? Number.POSITIVE_INFINITY : buy.limitPriceCents!;
  const sellPrice = sell.type === "market" ? 0 : sell.limitPriceCents!;
  if (buyPrice < sellPrice) return null;
  if (buy.type === "market" && sell.type === "market") return lastPriceCents;
  if (buy.type === "market") return sell.limitPriceCents ?? lastPriceCents;
  if (sell.type === "market") return buy.limitPriceCents ?? lastPriceCents;
  return buy.sequence < sell.sequence ? buy.limitPriceCents : sell.limitPriceCents;
}

function orderOwner(world: WorldState, order: MarketOrder): string {
  return world.brokerageAccounts.find((account) => account.id === order.brokerageAccountId)!.ownerId;
}

function settleFee(world: WorldState, payerId: string, recipientId: string, amountCents: number, kind: "BROKER_FEE" | "EXCHANGE_FEE", memo: string, payerBankAccountId?: string): string | null {
  if (amountCents <= 0) return null;
  const payerAccount = payerBankAccountId ? world.bankAccounts.find((account) => account.id === payerBankAccountId && account.ownerId === payerId) : null;
  const recipientAccount = payerAccount && bankAccountsForOwner(world, recipientId, payerAccount.currencyId)[0];
  const currency = payerAccount?.currencyId ?? primaryBankAccount(world, payerId)?.currencyId ?? "RUB";
  ensureAccount(world.ledger, accountIds.operatingExpense(payerId), payerId, "Комиссионные расходы", "expense", currency);
  ensureAccount(world.ledger, accountIds.operatingIncome(recipientId), recipientId, "Комиссионные доходы", "income", currency);
  if (payerAccount && recipientAccount) {
    const cashId = transferBankAccountBalance(world, payerAccount.id, recipientAccount.id, amountCents, kind, memo);
    if (!cashId) return null;
    const expense = world.ledger.accounts[accountIds.operatingExpense(payerId)]?.currency === currency ? accountIds.operatingExpense(payerId) : `${accountIds.operatingExpense(payerId)}:${currency}`;
    const income = world.ledger.accounts[accountIds.operatingIncome(recipientId)]?.currency === currency ? accountIds.operatingIncome(recipientId) : `${accountIds.operatingIncome(recipientId)}:${currency}`;
    ensureAccount(world.ledger, expense, payerId, `Комиссионные расходы · ${currency}`, "expense", currency);
    ensureAccount(world.ledger, income, recipientId, `Комиссионные доходы · ${currency}`, "income", currency);
    return postTransaction(world, kind, memo, [{ accountId: expense, side: "debit", amountCents }, { accountId: income, side: "credit", amountCents }], [cashId]);
  }
  return settleDepositPayment(world, payerId, recipientId, amountCents, kind, memo, accountIds.operatingExpense(payerId), accountIds.operatingIncome(recipientId));
}

function orderSettlement(world: WorldState, order: MarketOrder) {
  const brokerage = world.brokerageAccounts.find((account) => account.id === order.brokerageAccountId);
  return brokerage && world.bankAccounts.find((account) => brokerage.settlementBankAccountIds.includes(account.id) && account.currencyId === brokerage.currencyId && account.status === "active");
}

function updateOhlcv(world: WorldState, trade: MarketTrade): void {
  let bar = world.ohlcvBars.find((item) => item.securityId === trade.securityId && item.elapsedMonth === trade.elapsedMonth);
  if (!bar) {
    bar = { securityId: trade.securityId, elapsedMonth: trade.elapsedMonth, openCents: trade.priceCents, highCents: trade.priceCents, lowCents: trade.priceCents, closeCents: trade.priceCents, volume: 0 };
    world.ohlcvBars.push(bar);
  }
  bar.highCents = Math.max(bar.highCents, trade.priceCents);
  bar.lowCents = Math.min(bar.lowCents, trade.priceCents);
  bar.closeCents = trade.priceCents;
  bar.volume += trade.quantity;
}

export function matchOrderBook(world: WorldState, securityId: string): string[] {
  const listing = world.listings.find((item) => item.securityId === securityId);
  if (!listing) return [];
  const exchange = world.exchanges.find((item) => item.id === listing.exchangeId)!;
  const tradeIds: string[] = [];
  while (true) {
    const open = world.marketOrders.filter((order) => order.securityId === securityId && (order.status === "open" || order.status === "partially-filled") && order.remainingQuantity > 0);
    const buys = open.filter((order) => order.side === "buy").sort((a, b) => {
      if (a.type !== b.type) return a.type === "market" ? -1 : 1;
      return (b.limitPriceCents ?? 0) - (a.limitPriceCents ?? 0) || a.sequence - b.sequence;
    });
    const sells = open.filter((order) => order.side === "sell").sort((a, b) => {
      if (a.type !== b.type) return a.type === "market" ? -1 : 1;
      return (a.limitPriceCents ?? 0) - (b.limitPriceCents ?? 0) || a.sequence - b.sequence;
    });
    const buy = buys[0];
    const sell = sells[0];
    if (!buy || !sell) break;
    const priceCents = executablePrice(buy, sell, listing.lastPriceCents);
    if (!priceCents || priceCents <= 0) break;
    const quantity = Math.min(buy.remainingQuantity, sell.remainingQuantity);
    const buyerId = orderOwner(world, buy);
    const sellerId = orderOwner(world, sell);
    const buyerSettlement = orderSettlement(world, buy);
    const sellerSettlement = orderSettlement(world, sell);
    const grossCents = quantity * priceCents;
    const brokerAccount = world.brokerageAccounts.find((account) => account.id === buy.brokerageAccountId)!;
    const broker = world.brokers.find((item) => item.id === brokerAccount.brokerId)!;
    const brokerFee = Math.max(1, Math.floor((grossCents * exchange.brokerFeeBps) / 10_000));
    const exchangeFee = Math.max(1, Math.floor((grossCents * exchange.exchangeFeeBps) / 10_000));
    if (!buyerSettlement || !sellerSettlement || bankAccountBalance(world, buyerSettlement.id) < grossCents + brokerFee + exchangeFee) {
      buy.status = "rejected";
      buy.remainingQuantity = 0;
      continue;
    }
    const transfer = transferShares(world, securityId, sellerId, buyerId, quantity, priceCents, "MARKET_TRADE", { buyerBankAccountId: buyerSettlement.id, sellerBankAccountId: sellerSettlement.id });
    if (!transfer.ok) {
      sell.status = transfer.message.includes("акций") ? "rejected" : sell.status;
      buy.status = transfer.message.includes("денег") ? "rejected" : buy.status;
      if (buy.status !== "rejected" && sell.status !== "rejected") break;
      continue;
    }
    settleFee(world, buyerId, broker.id, brokerFee, "BROKER_FEE", `Комиссия брокера ${broker.name}`, buyerSettlement.id);
    settleFee(world, buyerId, exchange.id, exchangeFee, "EXCHANGE_FEE", `Комиссия биржи ${exchange.shortName}`, buyerSettlement.id);
    buy.remainingQuantity -= quantity;
    sell.remainingQuantity -= quantity;
    buy.status = buy.remainingQuantity === 0 ? "filled" : "partially-filled";
    sell.status = sell.remainingQuantity === 0 ? "filled" : "partially-filled";
    const trade: MarketTrade = {
      id: `trade-${String(world.nextTradeId++).padStart(8, "0")}`,
      securityId,
      exchangeId: exchange.id,
      buyOrderId: buy.id,
      sellOrderId: sell.id,
      buyerId,
      sellerId,
      quantity,
      priceCents,
      elapsedMonth: world.clock.elapsedMonths,
    };
    world.marketTrades.push(trade);
    listing.lastPriceCents = priceCents;
    updateOhlcv(world, trade);
    tradeIds.push(trade.id);
    emitSimpleEvent(world, "TradeExecuted", "Биржевая сделка", `${listing.ticker}: ${quantity.toLocaleString("ru-RU")} × ${priceCents}`, [buyerId, sellerId, exchange.id], "info", transfer.transactionIds, { quantity, priceCents });
  }
  return tradeIds;
}

export function placeOrder(
  world: WorldState,
  brokerageAccountId: string,
  securityId: string,
  side: "buy" | "sell",
  type: "market" | "limit",
  quantity: number,
  limitPriceCents: number | null = null,
): MarketResult {
  const account = world.brokerageAccounts.find((item) => item.id === brokerageAccountId && item.status === "active");
  const listing = world.listings.find((item) => item.securityId === securityId);
  const broker = account && world.brokers.find((item) => item.id === account.brokerId);
  if (!account || !listing || !broker || !broker.exchangeIds.includes(listing.exchangeId)) return { ok: false, message: "Инструмент недоступен у брокера" };
  if (account.currencyId !== listing.currencyId) return { ok: false, message: "Валютный рынок ещё не реализован: выберите локальную биржу" };
  quantity = Math.floor(quantity);
  if (quantity <= 0 || (type === "limit" && (!limitPriceCents || limitPriceCents <= 0))) return { ok: false, message: "Некорректные параметры заявки" };
  const ownerId = account.ownerId;
  if (side === "sell") {
    const shares = world.equityHoldings.find((holding) => holding.ownerId === ownerId && holding.securityId === securityId)?.shares ?? 0;
    const reserved = world.marketOrders.filter((order) => order.securityId === securityId && order.side === "sell" && (order.status === "open" || order.status === "partially-filled") && orderOwner(world, order) === ownerId).reduce((sum, order) => sum + order.remainingQuantity, 0);
    if (shares - reserved < quantity) return { ok: false, message: "Недостаточно свободных акций" };
  } else {
    const estimatedPrice = limitPriceCents ?? listing.lastPriceCents;
    const settlement = world.bankAccounts.find((item) => account.settlementBankAccountIds.includes(item.id) && item.currencyId === account.currencyId && item.status === "active");
    const openCommitment = world.marketOrders.filter((order) => order.side === "buy" && (order.status === "open" || order.status === "partially-filled") && order.brokerageAccountId === account.id).reduce((sum, order) => {
      const price = order.limitPriceCents ?? world.listings.find((item) => item.securityId === order.securityId)?.lastPriceCents ?? 0;
      return sum + order.remainingQuantity * price;
    }, 0);
    if (!settlement || bankAccountBalance(world, settlement.id) - openCommitment < quantity * estimatedPrice) return { ok: false, message: "Недостаточно свободных денег" };
  }
  const order: MarketOrder = {
    id: `order-${String(world.nextOrderId++).padStart(8, "0")}`,
    brokerageAccountId,
    securityId,
    side,
    type,
    quantity,
    remainingQuantity: quantity,
    limitPriceCents: type === "limit" ? Math.floor(limitPriceCents!) : null,
    placedAtMonth: world.clock.elapsedMonths,
    sequence: world.nextOrderSequence++,
    status: "open",
  };
  world.marketOrders.push(order);
  emitSimpleEvent(world, "OrderPlaced", "Заявка принята", `${side === "buy" ? "Покупка" : "Продажа"}: ${quantity.toLocaleString("ru-RU")}`, [ownerId, listing.exchangeId], "info", [], { quantity });
  const tradeIds = matchOrderBook(world, securityId);
  return { ok: true, message: tradeIds.length ? "Заявка исполнена полностью или частично" : "Заявка в книге", orderId: order.id, tradeIds };
}

export function cancelOrder(world: WorldState, orderId: string, ownerId: string): MarketResult {
  const order = world.marketOrders.find((item) => item.id === orderId);
  if (!order || orderOwner(world, order) !== ownerId || (order.status !== "open" && order.status !== "partially-filled")) return { ok: false, message: "Заявку нельзя отменить" };
  order.status = "cancelled";
  emitSimpleEvent(world, "OrderCancelled", "Заявка отменена", order.id, [ownerId], "info");
  return { ok: true, message: "Заявка отменена", orderId };
}

export function portfolioSummary(world: WorldState, ownerId: string): {
  cashCents: number;
  marketValueCents: number;
  costBasisCents: number;
  unrealizedPnlCents: number;
  realizedIncomeCents: number;
  positions: Array<{ securityId: string; ticker: string; shares: number; priceCents: number; valueCents: number; costBasisCents: number; pnlCents: number }>;
} {
  const positions = world.equityHoldings.filter((holding) => holding.ownerId === ownerId && holding.shares > 0).map((holding) => {
    const listing = world.listings.find((item) => item.securityId === holding.securityId);
    const priceCents = listing?.lastPriceCents ?? Math.round(holding.costBasisCents / Math.max(1, holding.shares));
    const valueCents = holding.shares * priceCents;
    return { securityId: holding.securityId, ticker: listing?.ticker ?? "Частная", shares: holding.shares, priceCents, valueCents, costBasisCents: holding.costBasisCents, pnlCents: valueCents - holding.costBasisCents };
  });
  const marketValueCents = positions.reduce((sum, position) => sum + position.valueCents, 0);
  const costBasisCents = positions.reduce((sum, position) => sum + position.costBasisCents, 0);
  const realizedIncomeCents = world.equityHoldings.filter((holding) => holding.ownerId === ownerId).reduce((sum, holding) => sum + holding.dividendsReceivedCents, 0)
    + world.bondHoldings.filter((holding) => holding.holderId === ownerId).reduce((sum, holding) => sum + holding.couponsReceivedCents, 0);
  return { cashCents: depositOf(world, ownerId), marketValueCents, costBasisCents, unrealizedPnlCents: marketValueCents - costBasisCents, realizedIncomeCents, positions };
}

export function runMarketAgents(world: WorldState): void {
  for (const listing of world.listings) listing.previousCloseCents = listing.lastPriceCents;
  const archived = world.marketOrders.filter((order) => order.placedAtMonth < world.clock.elapsedMonths - 2 && ["filled", "cancelled", "rejected"].includes(order.status));
  if (archived.length) {
    world.archivedMarketOrders.push(...archived);
    const archivedIds = new Set(archived.map((order) => order.id));
    world.marketOrders = world.marketOrders.filter((order) => !archivedIds.has(order.id));
  }
  for (const listing of world.listings) {
    const company = world.companies.find((item) => item.id === listing.companyId);
    if (!company) continue;
    const security = world.equitySecurities.find((item) => item.id === listing.securityId)!;
    const recentProfit = company.financialReports.slice(-12).reduce((sum, report) => sum + report.netIncomeCents, 0)
      + Math.max(0, company.lastGrossRevenueCents - company.lastOperatingExpenseCents - company.lastCogsCents);
    const bookEquity = Math.max(1, company.productiveCapital.bookValueCents + company.inventoryValueCents + depositOf(world, company.id));
    const authorityId = world.monetaryAreas.find((area) => area.currencyId === listing.currencyId)?.monetaryAuthorityId;
    const riskFreeBps = world.centralBanks.find((bank) => bank.id === authorityId)?.policyRateBps ?? 500;
    const earningsValue = Math.max(0, recentProfit) * Math.max(5, Math.round(18 - riskFreeBps / 150));
    const fairPrice = Math.max(1, Math.round(Math.max(bookEquity, earningsValue) / Math.max(1, security.sharesOutstanding)));
    const gapBps = Math.round((fairPrice - listing.lastPriceCents) * 10_000 / Math.max(1, listing.lastPriceCents));
    if (Math.abs(gapBps) < 40) continue;
    const publicHolderId = `population-${company.headquartersCityId}-1`;
    const passiveInvestorId = `population-${company.headquartersCityId}-2`;
    const sellerId = gapBps > 0 ? publicHolderId : company.ownerHouseholdId;
    const buyerId = gapBps > 0 ? passiveInvestorId : publicHolderId;
    openBrokerageAccount(world, sellerId);
    openBrokerageAccount(world, buyerId);
    const sellerAccount = world.brokerageAccounts.find((item) => item.ownerId === sellerId && item.status === "active");
    const buyerAccount = world.brokerageAccounts.find((item) => item.ownerId === buyerId && item.status === "active");
    if (!sellerAccount || !buyerAccount) continue;
    for (const order of world.marketOrders.filter((item) => item.securityId === listing.securityId && item.placedAtMonth < world.clock.elapsedMonths - 1 && (item.status === "open" || item.status === "partially-filled"))) order.status = "cancelled";
    const priceStepBps = Math.max(-250, Math.min(250, Math.round(gapBps / 8)));
    const price = Math.max(1, Math.round(listing.lastPriceCents * (10_000 + priceStepBps) / 10_000));
    const quantity = Math.max(5, Math.min(50, Math.floor(Math.abs(gapBps) / 40)));
    const sellerShares = world.equityHoldings.find((holding) => holding.ownerId === sellerId && holding.securityId === listing.securityId)?.shares ?? 0;
    if (sellerShares >= quantity) {
      placeOrder(world, sellerAccount.id, listing.securityId, "sell", "limit", quantity, price);
      placeOrder(world, buyerAccount.id, listing.securityId, "buy", "limit", quantity, price);
    }
  }
  for (const index of world.marketIndices) {
    const listings = index.constituentSecurityIds.map((securityId) => world.listings.find((item) => item.securityId === securityId)).filter(Boolean);
    if (!listings.length) continue;
    const averageReturn = listings.reduce((sum, listing) => sum + ((listing!.lastPriceCents - listing!.previousCloseCents) / Math.max(1, listing!.previousCloseCents)), 0) / listings.length;
    index.levelBps = Math.max(1, Math.round(index.levelBps * (1 + averageReturn)));
    index.history.push({ elapsedMonth: world.clock.elapsedMonths, levelBps: index.levelBps });
  }
}
