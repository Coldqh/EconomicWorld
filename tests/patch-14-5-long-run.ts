import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { runMonths } from "../src/economy/simulation.ts";

const requiredCountries = new Set(["ru", "de", "us", "jp", "kr"]);
const world = createWorld("baseline", { mode: "REAL_WORLD" });
const months = Number(process.env.EW_BENCHMARK_MONTHS ?? 240);
const started = performance.now();
runMonths(world, months);
const wallClockMs = Math.round(performance.now() - started);
const points = world.longRunDiagnostics.points
  .filter((point) => point.elapsedMonth === months && requiredCountries.has(point.countryId))
  .map((point) => ({
    country: point.countryId,
    actualGdp: point.actualNominalGdpMinor,
    structuralGdp: point.structuralNominalGdpMinor,
    wagesBps: point.wagesToGdpBps,
    consumptionBps: point.consumptionToGdpBps,
    investmentBps: point.investmentToGdpBps,
    revenueBps: point.revenueToGdpBps,
    primarySpendingBps: point.primarySpendingToGdpBps,
    interestBps: point.interestToGdpBps,
    debtBps: point.debtToGdpBps,
    effectiveRateBps: point.effectiveDebtRateBps,
    marginalRateBps: point.marginalDebtRateBps,
    firms: point.representedFirms,
  }));
const warnings = world.longRunDiagnostics.warnings.filter((warning) => warning.elapsedMonth === months && requiredCountries.has(warning.countryId));
const failures = checkInvariants(world).filter((item) => !item.ok);
const report = {
  months: world.clock.elapsedMonths,
  wallClockMs,
  saveSizeBytes: Buffer.byteLength(JSON.stringify(world)),
  heapUsedBytes: process.memoryUsage().heapUsed,
  points,
  warnings: warnings.map(({ countryId, code, severity }) => ({ countryId, code, severity })),
  defaults: world.events.filter((event) => event.type === "SovereignDefault").length,
  activeOrRestructuredBonds: world.sovereignBonds.filter((bond) => bond.status === "active" || bond.status === "restructured").length,
  investmentTransactions: world.ledger.transactions.filter((transaction) => transaction.kind === "CAPITAL_INVESTMENT").length,
  failedInvariantIds: failures.map((item) => item.id),
  failedInvariants: failures,
  debtBridgeGaps: Object.values(world.countryEconomicAccounts.closedByCountry).filter((period) => period.financial.debtBridgeGapMinor !== 0).map((period) => ({ country: period.countryId, ...period.financial })),
};
console.log(JSON.stringify(report));

assert.equal(points.length, requiredCountries.size);
assert.equal(failures.length, 0);
assert.equal(warnings.filter((warning) => warning.severity === "failure").length, 0);
assert.ok(points.every((point) => point.actualGdp > 0 && point.structuralGdp > 0));
assert.ok(points.every((point) => point.wagesBps >= 1_500));
assert.ok(points.every((point) => point.consumptionBps >= 1_500));
assert.ok(points.every((point) => point.revenueBps >= (months >= 600 ? 200 : 300)));
assert.ok(points.every((point) => point.primarySpendingBps >= (months >= 600 ? 150 : 300)));
assert.ok(points.every((point) => point.investmentBps > 0));
assert.ok(points.every((point) => point.firms > 0));
assert.ok(months !== 240 || wallClockMs <= 47_500, `20-летний прогон занял ${wallClockMs} мс (целевой шлюз 45 000 мс, допустимый CI-запас 5%)`);
