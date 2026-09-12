import assert from "node:assert/strict";
import test from "node:test";
import { activeIpoProcesses, activeMAndADeals } from "../src/corporate-finance/pipeline-index.ts";
import type { IPOProcess, MAndADeal } from "../src/domain/model.ts";
import { createWorld } from "../src/economy/create-world.ts";
import {
  setSimulationTimingEnabled,
  simulationTimingBreakdown,
  type SimulationTimingPhase,
} from "../src/economy/performance-timing.ts";
import { activeSovereignBonds } from "../src/economy/sovereign-runtime-index.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { marketRuntimeIndex } from "../src/markets/runtime-index.ts";

const activeOrder = (status: string): boolean => status === "open" || status === "partially-filled";

test("developer timing tree records every required monthly performance phase", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  setSimulationTimingEnabled(true);
  runMonths(world, 3);
  const recorded = [...simulationTimingBreakdown()];
  setSimulationTimingEnabled(false);
  const phases = new Set(recorded.flatMap((month) => Object.keys(month.phasesMs) as SimulationTimingPhase[]));
  const required: SimulationTimingPhase[] = [
    "Market Makers", "Heterogeneous Market Agents", "Cross-Venue Arbitrage", "Triangular FX Arbitrage", "ETF Arbitrage",
    "Cash-and-Carry", "Order Matching", "Settlement", "Fund Rebalancing", "Banks", "Corporate Decisions", "Trade", "FX",
    "Government", "Sovereign Debt", "Insurance", "PE/M&A/IPO", "Accounting Close", "Ledger Indexing", "History Compaction",
    "Serialization/save preparation",
  ];
  for (const phase of required) assert.ok(phases.has(phase), `В timing tree отсутствует ${phase}`);
  assert.equal(recorded.length, 3);
  assert.ok(recorded.every((month) => month.totalMs > 0));
});

test("market topology and active maker state stay bounded instead of growing with history", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const initialTopology = marketRuntimeIndex(world);
  const initialTriangleCount = [...initialTopology.fxTrianglesByOwner.values()].reduce((sum, triangles) => sum + triangles.length, 0);
  runMonths(world, 12);
  const makerOwners = new Set(world.marketAgents.filter((agent) => agent.kind === "market-maker").map((agent) => agent.ownerId));
  const brokerageOwner = new Map(world.brokerageAccounts.map((account) => [account.id, account.ownerId]));
  const activeMakerOrdersAt12 = world.marketOrders.filter((order) => activeOrder(order.status) && makerOwners.has(brokerageOwner.get(order.brokerageAccountId) ?? "")).length;
  const pairCount = world.listings.length;
  assert.ok(activeMakerOrdersAt12 <= pairCount * 12, `${activeMakerOrdersAt12} active maker orders for ${pairCount} pairs`);
  runMonths(world, 12);
  const activeMakerOrdersAt24 = world.marketOrders.filter((order) => activeOrder(order.status) && makerOwners.has(brokerageOwner.get(order.brokerageAccountId) ?? "")).length;
  assert.ok(activeMakerOrdersAt24 <= pairCount * 12);
  assert.ok(activeMakerOrdersAt24 <= activeMakerOrdersAt12 + pairCount * 2);
  const finalTriangleCount = [...marketRuntimeIndex(world).fxTrianglesByOwner.values()].reduce((sum, triangles) => sum + triangles.length, 0);
  assert.equal(finalTriangleCount, initialTriangleCount);
  const rawArchivedTransactions = world.ledgerArchives.reduce((sum, archive) => sum + archive.transactionCount, 0);
  assert.ok(world.history.compactedLedgerRecords.length < rawArchivedTransactions);
});

test("sovereign and deal work sets exclude historical closed records", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const activeBond = activeSovereignBonds(world)[0];
  assert.ok(activeBond);
  world.sovereignBonds.push({ ...activeBond, id: "performance-matured-bond", status: "matured", outstandingFaceValueMinor: 0 });
  assert.ok(!activeSovereignBonds(world).some((bond) => bond.id === "performance-matured-bond"));

  const dealBase: Omit<MAndADeal, "id" | "status"> = {
    buyerId: "buyer", targetCompanyId: "target", type: "friendly", consideration: "cash", offerPriceMinor: 1, premiumBps: 0,
    financingMinor: 1, boardSupport: true, shareholderApprovalBps: 10_000, antitrustResult: "approved", dueDiligenceRiskBps: 0,
    competingBidIds: [], conditions: [], integrationProgressBps: 0, announcedAtMonth: 0, closedAtMonth: null, tenderElections: [],
  };
  world.mAndADeals.push({ ...dealBase, id: "performance-open-deal", status: "diligence" }, { ...dealBase, id: "performance-closed-deal", status: "closed", closedAtMonth: 0 });
  const ipoBase: Omit<IPOProcess, "id" | "stage"> = { companyId: "target", underwriterBankId: null, primaryShares: 1, secondaryShares: 0, indicativeLowMinor: 1, indicativeHighMinor: 2, finalPriceMinor: null, feeBps: 0, lockupUntilMonth: null, indications: [], allocations: [], startedAtMonth: 0 };
  world.ipoProcesses.push({ ...ipoBase, id: "performance-open-ipo", stage: "preparation" }, { ...ipoBase, id: "performance-closed-ipo", stage: "completed" });
  assert.deepEqual(activeMAndADeals(world).map((deal) => deal.id).filter((id) => id.startsWith("performance-")), ["performance-open-deal"]);
  assert.deepEqual(activeIpoProcesses(world).map((ipo) => ipo.id).filter((id) => id.startsWith("performance-")), ["performance-open-ipo"]);
});
