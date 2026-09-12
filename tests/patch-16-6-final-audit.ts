import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { bankAccountBalance } from "../src/core/ledger.ts";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { stepMonth } from "../src/economy/simulation.ts";

const months = Number.parseInt(process.argv[2] ?? "12", 10);
assert.ok(Number.isSafeInteger(months) && months > 0, "Укажите положительное число месяцев");

const world = createWorld("baseline", { mode: "REAL_WORLD" });
const initializationGenesisIds = new Set(world.ledger.transactions.filter((transaction) => transaction.kind === "GENESIS").map((transaction) => transaction.id));
const started = performance.now();
for (let index = 0; index < months; index += 1) {
  stepMonth(world);
  if (months >= 120 && world.clock.elapsedMonths % 120 === 0) console.error(JSON.stringify({ progressMonths: world.clock.elapsedMonths, elapsedMs: Math.round(performance.now() - started) }));
}
const wallClockMs = Math.round(performance.now() - started);
const invariantResults = checkInvariants(world);
const failures = invariantResults.filter((item) => !item.ok);
const postInitializationGenesis = world.ledger.transactions.filter((transaction) => transaction.kind === "GENESIS" && !initializationGenesisIds.has(transaction.id));
const negativeHoldings = world.equityHoldings.filter((holding) => holding.shares < 0);
const negativeStocks = world.companies.filter((company) => company.inventoryMilliUnits < 0 || Object.values(company.inputInventoryMilliUnits).some((amount) => amount < 0));
const negativeCashAccounts = world.bankAccounts.filter((account) => bankAccountBalance(world, account.id) < 0);
const insuranceOverpayments = world.insuranceLossEvents.filter((loss) => world.insuranceClaims.filter((claim) => claim.lossEventId === loss.id).reduce((sum, claim) => sum + claim.paidMinor, 0) > loss.economicLossMinor);
const brokenPeStructures = world.privateEquityDeals.filter((deal) => {
  if (!deal.acquisitionVehicleId) return Boolean(deal.acquisitionLoanIds?.length);
  const vehicle = world.acquisitionVehicles.find((item) => item.id === deal.acquisitionVehicleId);
  return !vehicle || (deal.acquisitionLoanIds ?? []).some((loanId) => world.loans.find((loan) => loan.id === loanId)?.borrowerId !== vehicle.id);
});
const activeMarketMonths = new Set([...world.marketOrders, ...world.archivedMarketOrders].map((order) => order.placedAtMonth)).size;
const topLevelSaveBytes = Object.fromEntries(Object.entries(world).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))]).sort((left, right) => Number(right[1]) - Number(left[1])).slice(0, 12));
const historySaveBytes = Object.fromEntries(Object.entries(world.history).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))]).sort((left, right) => Number(right[1]) - Number(left[1])));

const report = {
  months,
  wallClockMs,
  heapUsedBytes: process.memoryUsage().heapUsed,
  saveSizeBytes: Buffer.byteLength(JSON.stringify(world)),
  schemaVersion: world.schemaVersion,
  initializationGenesisTransactions: initializationGenesisIds.size,
  postInitializationGenesisTransactions: postInitializationGenesis.length,
  postInitializationGenesisSources: postInitializationGenesis.map((transaction) => ({ id: transaction.id, month: transaction.elapsedMonth, memo: transaction.memo })),
  invariantResults: invariantResults.length,
  invariantFailures: failures,
  accountingInvariant: invariantResults.find((item) => item.id === "double-entry")?.ok ?? false,
  bopInvariant: invariantResults.find((item) => item.id === "bop-reconciliation")?.ok ?? false,
  ownershipInvariant: invariantResults.find((item) => item.id === "cap-table")?.ok ?? false,
  fundUnitsInvariant: invariantResults.find((item) => item.id === "fund-units")?.ok ?? false,
  peStructureInvariant: invariantResults.find((item) => item.id === "pe-acquisition-structure")?.ok ?? false,
  insuranceInvariant: invariantResults.find((item) => item.id === "covered-loss-limit")?.ok ?? false,
  negativeHoldings: negativeHoldings.length,
  negativeStocks: negativeStocks.length,
  negativeCashAccounts: negativeCashAccounts.length,
  insuranceOverpayments: insuranceOverpayments.length,
  brokenPeStructures: brokenPeStructures.length,
  activeMarketMonths,
  ledgerTransactionsHot: world.ledger.transactions.length,
  ledgerTransactionsArchived: world.diagnostics.ledgerArchivedTransactions,
  marketOrdersHot: world.marketOrders.length,
  marketOrdersArchived: world.archivedMarketOrders.length,
  marketTrades: world.marketTrades.length,
  insuranceClaims: world.insuranceClaims.length,
  acquisitionVehicles: world.acquisitionVehicles.length,
  topLevelSaveBytes,
  historySaveBytes,
};

console.log(JSON.stringify(report));
assert.equal(postInitializationGenesis.length, 0);
assert.equal(failures.length, 0);
assert.equal(negativeHoldings.length, 0);
assert.equal(negativeStocks.length, 0);
assert.equal(negativeCashAccounts.length, 0);
assert.equal(insuranceOverpayments.length, 0);
assert.equal(brokenPeStructures.length, 0);
