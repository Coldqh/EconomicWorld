import { bankAccountBalance } from "../core/ledger.ts";
import type { FundRedemptionRequest, WorldState } from "../domain/model.ts";
import { calculateFundNav, redeemFund } from "./institutional.ts";
import { openBrokerageAccount, placeOrder } from "../markets/exchange.ts";

export function requestFundRedemption(world: WorldState, fundId: string, investorId: string, unitsMicros: number): FundRedemptionRequest | null {
  const fund = world.funds.find((item) => item.id === fundId && item.status === "active"); const holding = world.fundUnitHoldings.find((item) => item.fundId === fundId && item.investorId === investorId); if (!fund || !holding || unitsMicros <= 0 || holding.unitsMicros < unitsMicros) return null; const nav = calculateFundNav(world, fundId); const amount = Math.floor(unitsMicros * nav.navPerUnitMinor / 1_000_000);
  const request: FundRedemptionRequest = { id: `redemption-${world.fundRedemptionRequests.length + 1}`, fundId, investorId, unitsMicros, amountDueMinor: amount, status: "requested", sellOrderIds: [], requestedAtMonth: world.clock.elapsedMonths }; world.fundRedemptionRequests.push(request); processFundRedemptions(world); return request;
}
export function processFundRedemptions(world: WorldState): void {
  for (const request of world.fundRedemptionRequests.filter((item) => item.status === "requested" || item.status === "liquidating")) {
    const fund = world.funds.find((item) => item.id === request.fundId); if (!fund) { request.status = "failed"; continue; }
    if (bankAccountBalance(world, fund.bankAccountId) >= request.amountDueMinor) { const paid = redeemFund(world, fund.id, request.investorId, request.unitsMicros); request.status = paid.ok ? "paid" : "failed"; if (paid.ok) world.fundFlows.push({ id: `fund-flow-${world.fundFlows.length + 1}`, fundId: fund.id, investorId: request.investorId, type: "redemption", amountMinor: paid.amountMinor!, elapsedMonth: world.clock.elapsedMonths, transactionIds: world.ledger.transactions.slice(-2).map((item) => item.id) }); continue; }
    const activeOrders = world.marketOrders.filter((order) => request.sellOrderIds.includes(order.id) && (order.status === "open" || order.status === "partially-filled")); if (activeOrders.length) { request.status = "liquidating"; continue; }
    openBrokerageAccount(world, fund.id); const brokerage = world.brokerageAccounts.find((item) => item.ownerId === fund.id && item.currencyId === fund.currencyId && item.status === "active"); if (!brokerage) { request.status = "failed"; continue; }
    let shortfall = request.amountDueMinor - bankAccountBalance(world, fund.bankAccountId); for (const holding of world.equityHoldings.filter((item) => item.ownerId === fund.id && item.shares > 0).sort((a, b) => b.shares - a.shares)) { const listing = world.listings.find((item) => item.securityId === holding.securityId && item.currencyId === fund.currencyId); if (!listing || shortfall <= 0) continue; const quantity = Math.min(holding.shares, Math.ceil(shortfall / Math.max(1, listing.lastPriceCents))); const placed = placeOrder(world, brokerage.id, holding.securityId, "sell", "market", quantity, null, listing.exchangeId); if (placed.orderId) request.sellOrderIds.push(placed.orderId); shortfall -= quantity * listing.lastPriceCents; }
    request.status = request.sellOrderIds.length ? "liquidating" : "failed";
  }
}
