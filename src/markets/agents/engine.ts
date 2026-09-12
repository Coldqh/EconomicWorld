import type { MarketAgentKind, WorldState } from "../../domain/model.ts";
import { openBrokerageAccount, placeOrder } from "../exchange.ts";
import { brokerageForOwner, marketRuntimeIndex, recentOhlcvBars } from "../runtime-index.ts";
import { beliefValue } from "../../information/system.ts";

export function marketInformationSignal(world: WorldState, agentId: string, securityId: string, kind: MarketAgentKind, barsBySecurity = new Map<string, WorldState["ohlcvBars"]>(), companyById = new Map(world.companies.map((item) => [item.id, item]))): number {
  const listing = marketRuntimeIndex(world).listingsBySecurity.get(securityId)?.[0]; const company = listing && companyById.get(listing.companyId); const bars = barsBySecurity.get(securityId) ?? []; if (!listing) return 0;
  if (kind === "momentum") return bars.length > 1 ? bars.at(-1)!.closeCents - bars[0].closeCents : 0;
  if (kind === "fundamental" && company) {
    const publicReport = company.financialReports.at(-1)?.operatingCashFlowCents ?? 0;
    const observedCashFlow = beliefValue(world, agentId, "operating-cash-flow", company.id, publicReport);
    const modelTiltBps = 8_500 + [...agentId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3_001;
    return Math.round(observedCashFlow * modelTiltBps / 10_000);
  }
  if (kind === "passive" || kind === "pension") return 1;
  if (kind === "retail") return world.metricsHistory.at(-1)?.realGdpGrowthBps ?? 1;
  if (kind === "hedge") return bars.length > 1 ? -(bars.at(-1)!.closeCents - bars[0].closeCents) : 0;
  return 0;
}
export function runHeterogeneousMarketAgents(world: WorldState): void {
  marketRuntimeIndex(world);
  const companyById = new Map(world.companies.map((item) => [item.id, item]));
  const barsBySecurity = new Map<string, WorldState["ohlcvBars"]>();
  for (const listing of world.listings) if (!barsBySecurity.has(listing.securityId)) barsBySecurity.set(listing.securityId, recentOhlcvBars(world, listing.securityId, 4));
  const holdingByOwnerSecurity = new Map<string, WorldState["equityHoldings"][number]>();
  for (const holding of world.equityHoldings) {
    const key = `${holding.ownerId}\u0000${holding.securityId}`;
    if (!holdingByOwnerSecurity.has(key)) holdingByOwnerSecurity.set(key, holding);
  }
  for (const agent of world.marketAgents.filter((item) => item.active && !["market-maker", "arbitrageur"].includes(item.kind))) {
    openBrokerageAccount(world, agent.ownerId);
    const account = brokerageForOwner(world, agent.ownerId);
    if (!account) continue;
    let evaluated = 0;
    for (const listing of world.listings) {
      if (!agent.exchangeIds.includes(listing.exchangeId)) continue;
      evaluated += 1;
      const value = marketInformationSignal(world, agent.ownerId, listing.securityId, agent.kind, barsBySecurity, companyById); if (!value) { if (evaluated >= 3) break; continue; }
      const holding = holdingByOwnerSecurity.get(`${agent.ownerId}\u0000${listing.securityId}`); const side = agent.kind === "forced-seller" ? "sell" : value > 0 ? "buy" : "sell"; const quantity = side === "sell" ? Math.min(10, holding?.shares ?? 0) : Math.max(1, Math.min(10, Math.floor(agent.capitalMinor / Math.max(1, listing.lastPriceCents) / 20))); if (quantity > 0) placeOrder(world, account.id, listing.securityId, side, agent.kind === "forced-seller" ? "market" : "limit", quantity, side === "buy" ? Math.round(listing.lastPriceCents * 1.01) : Math.round(listing.lastPriceCents * 0.99), listing.exchangeId);
      if (evaluated >= 3) break;
    }
  }
}
