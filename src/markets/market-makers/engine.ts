import { openBankAccount } from "../../core/ledger.ts";
import type { WorldState } from "../../domain/model.ts";
import { openBrokerageAccount, placeOrder } from "../exchange.ts";
import { activeOrdersForOwnerPair, brokerageForOwnerCurrency, marketPairKey, marketRuntimeIndex, recentOhlcvBars } from "../runtime-index.ts";

function volatility(bars: WorldState["ohlcvBars"]): number {
  if (bars.length < 2) return 150;
  const returns = bars.slice(1).map((bar, index) => Math.abs(bar.closeCents - bars[index].closeCents) * 10_000 / Math.max(1, bars[index].closeCents));
  return Math.min(3_000, Math.round(returns.reduce((sum, value) => sum + value, 0) / returns.length));
}

/**
 * Give brokers realistic access to same-currency venues and seed a small number of
 * secondary listings. This creates a genuine multi-venue topology without duplicating
 * securities or synchronising prices by fiat. The same security/ownership registry is
 * used on every venue; only the order books differ.
 */
function ensureMultiVenueTopology(world: WorldState): void {
  for (const broker of world.brokers) {
    const currencies = new Set(broker.supportedCurrencyIds);
    for (const exchange of world.exchanges) if (currencies.has(exchange.currencyId) && !broker.exchangeIds.includes(exchange.id)) broker.exchangeIds.push(exchange.id);
  }

  const exchangesByCurrency = new Map<string, typeof world.exchanges>();
  for (const exchange of world.exchanges) {
    const group = exchangesByCurrency.get(exchange.currencyId) ?? [];
    group.push(exchange);
    exchangesByCurrency.set(exchange.currencyId, group);
  }
  for (const exchanges of exchangesByCurrency.values()) {
    if (exchanges.length < 2) continue;
    const originals = world.listings.filter((listing) => exchanges.some((exchange) => exchange.id === listing.exchangeId));
    // A handful of liquid cross-listings is enough for price discovery/arbitrage and
    // avoids multiplying every security across every venue.
    for (const listing of originals.slice(0, Math.min(4, originals.length))) {
      const sourceIndex = exchanges.findIndex((exchange) => exchange.id === listing.exchangeId);
      const target = exchanges[(sourceIndex + 1) % exchanges.length];
      if (!target || target.id === listing.exchangeId || world.listings.some((item) => item.securityId === listing.securityId && item.exchangeId === target.id)) continue;
      const secondary = { ...listing, id: `listing-x-${listing.securityId}-${target.id}`, exchangeId: target.id, listedAtMonth: world.clock.elapsedMonths, previousCloseCents: listing.lastPriceCents };
      world.listings.push(secondary);
      if (!target.listedSecurityIds.includes(listing.securityId)) target.listedSecurityIds.push(listing.securityId);
    }
  }
}
export function seedMarketAgents(world: WorldState): void {
  ensureMultiVenueTopology(world);
  if (world.marketAgents.length) return;
  for (const exchange of world.exchanges) {
    const owners = [...new Set(world.equityHoldings.filter((holding) => exchange.listedSecurityIds.includes(holding.securityId) && holding.shares > 100).map((holding) => holding.ownerId))].slice(0, 3);
    owners.forEach((ownerId, index) => world.marketAgents.push({ id: `maker-${exchange.id}-${index + 1}`, ownerId, kind: "market-maker", exchangeIds: [exchange.id], capitalMinor: 10_000_000, riskLimitMinor: 3_000_000, latencyBps: 100 + index * 40, active: true }));
    const kinds = ["fundamental", "retail", "momentum", "passive", "pension", "hedge", "arbitrageur"] as const;
    kinds.forEach((kind, index) => {
      const ownerId = owners[index % Math.max(1, owners.length)];
      if (!ownerId) return;
      const exchangeIds = kind === "arbitrageur"
        ? world.exchanges.filter((candidate) => candidate.currencyId === exchange.currencyId).map((candidate) => candidate.id)
        : [exchange.id];
      world.marketAgents.push({ id: `${kind}-${exchange.id}`, ownerId, kind, exchangeIds, capitalMinor: 5_000_000 + index * 500_000, riskLimitMinor: 1_000_000, latencyBps: 250 + index * 50, active: true });
      if (kind === "arbitrageur") {
        const homeCurrency = world.bankAccounts.find((account) => account.ownerId === ownerId && account.isPrimary)?.currencyId;
        const liquidCurrencies = [homeCurrency, "USD", "EUR", "JPY"].filter((currency, position, all): currency is string => Boolean(currency) && all.indexOf(currency) === position).slice(0, 3);
        for (const currencyId of liquidCurrencies) {
          if (world.bankAccounts.some((account) => account.ownerId === ownerId && account.currencyId === currencyId && account.status === "active")) continue;
          const bank = world.banks.find((candidate) => candidate.baseCurrency === currencyId);
          if (bank) openBankAccount(world, ownerId, bank.id, false);
        }
      }
    });
  }
}
export function runMarketMakers(world: WorldState): void {
  seedMarketAgents(world);
  const topology = marketRuntimeIndex(world);
  const previousQuotes = world.marketMakerQuotes;
  const previousQuoteByPair = new Map(previousQuotes.map((item) => [`${item.agentId}\u0000${marketPairKey(item.securityId, item.exchangeId)}`, item]));
  const agentById = new Map(world.marketAgents.map((item) => [item.id, item]));
  const breakerBySecurity = new Map(world.circuitBreakers.map((item) => [item.securityId, item]));
  const inventoryByOwnerSecurity = new Map<string, number>();
  for (const holding of world.equityHoldings) {
    const key = `${holding.ownerId}\u0000${holding.securityId}`;
    if (!inventoryByOwnerSecurity.has(key)) inventoryByOwnerSecurity.set(key, holding.shares);
  }
  const barsBySecurity = new Map<string, WorldState["ohlcvBars"]>();
  for (const listing of world.listings) if (!barsBySecurity.has(listing.securityId)) barsBySecurity.set(listing.securityId, recentOhlcvBars(world, listing.securityId, 12));
  const recentFlowBySecurity = new Map<string, number>();
  const flowCutoff = world.clock.elapsedMonths - 2;
  for (const trade of world.marketTrades) if (trade.elapsedMonth >= flowCutoff) recentFlowBySecurity.set(trade.securityId, (recentFlowBySecurity.get(trade.securityId) ?? 0) + trade.quantity);
  world.marketMakerQuotes = [];
  for (const [listingIndex, listing] of world.listings.entries()) {
    const exchange = topology.exchangeById.get(listing.exchangeId); if (!exchange) continue;
    const breaker = breakerBySecurity.get(listing.securityId); if (breaker?.haltedUntilMonth != null && breaker.haltedUntilMonth >= world.clock.elapsedMonths) continue;
    const vol = volatility(barsBySecurity.get(listing.securityId) ?? []); const toxic = Math.min(1_000, Math.round((recentFlowBySecurity.get(listing.securityId) ?? 0) / 10));
    const makers = (topology.makerIdsByPair.get(marketPairKey(listing.securityId, exchange.id)) ?? []).map((id) => agentById.get(id)!).filter(Boolean);
    // One designated maker supplies each venue/security quote per month. Assignment
    // rotates deterministically, so every maker remains active while the book avoids
    // three economically redundant quote pairs and the resulting quadratic matching.
    const designated = makers.length ? makers[(world.clock.elapsedMonths + listingIndex) % makers.length] : null;
    for (const agent of designated ? [designated] : []) {
      openBrokerageAccount(world, agent.ownerId); const account = brokerageForOwnerCurrency(world, agent.ownerId, listing.currencyId); if (!account) continue;
      const inventory = inventoryByOwnerSecurity.get(`${agent.ownerId}\u0000${listing.securityId}`) ?? 0; const limit = Math.max(100, Math.round(agent.riskLimitMinor / Math.max(1, listing.lastPriceCents)));
      const skew = Math.max(-250, Math.min(250, Math.round((inventory - limit / 2) * 500 / limit))); const halfSpread = Math.max(exchange.brokerFeeBps + exchange.exchangeFeeBps + 5, Math.round(20 + vol * 0.18 + toxic * 0.08)); const midpoint = Math.max(1, Math.round(listing.lastPriceCents * (10_000 - skew) / 10_000)); const bid = Math.max(1, Math.round(midpoint * (10_000 - halfSpread) / 10_000)); const ask = Math.max(bid + 1, Math.round(midpoint * (10_000 + halfSpread) / 10_000)); const quoteSize = Math.max(1, Math.min(100, Math.round(limit * Math.max(1_500, 10_000 - vol * 2) / 100_000)));
      world.marketMakerQuotes.push({ id: `quote-${world.clock.elapsedMonths}-${agent.id}-${listing.securityId}`, agentId: agent.id, securityId: listing.securityId, exchangeId: exchange.id, bidMinor: bid, askMinor: ask, bidSize: quoteSize, askSize: Math.min(quoteSize, inventory), inventory, inventoryLimit: limit, volatilityBps: vol, adverseSelectionBps: toxic, elapsedMonth: world.clock.elapsedMonths });
      // Replace only this maker's prior quote. The owner may use the same brokerage
      // account for a separate investment/arbitrage order, which must not be erased
      // merely because the quoting strategy refreshes its prices.
      const previous = previousQuoteByPair.get(`${agent.id}\u0000${marketPairKey(listing.securityId, exchange.id)}`);
      if (previous) for (const order of activeOrdersForOwnerPair(world, agent.ownerId, listing.securityId, exchange.id)) if (order.brokerageAccountId === account.id && order.type === "limit" && (order.limitPriceCents === previous.bidMinor || order.limitPriceCents === previous.askMinor)) order.status = "cancelled";
      placeOrder(world, account.id, listing.securityId, "buy", "limit", quoteSize, bid, exchange.id);
      if (inventory > 0) placeOrder(world, account.id, listing.securityId, "sell", "limit", Math.min(quoteSize, inventory), ask, exchange.id);
    }
  }
}
