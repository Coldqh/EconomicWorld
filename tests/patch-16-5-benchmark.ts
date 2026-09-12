import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { enableLongRunInvariantHarness } from "../src/economy/long-run-invariant-harness.ts";
import { stepMonth } from "../src/economy/simulation.ts";

const mode = process.env.EW_PATCH_16_5_MODE ?? "peace";
const months = Number(process.env.EW_PATCH_16_5_MONTHS ?? (mode === "peace" ? 240 : 120));
const world = createWorld("baseline", { mode: "REAL_WORLD" });
if (mode === "conflict") for (let index = 0; index < 3; index++) world.geoeconomics.policies.push({ id: `benchmark-friction-${index}`, actorCountryId: index % 2 ? "ru" : "us", targetCountryIds: [index % 2 ? "us" : "ru"], kind: "sanction", commodityIds: [], rateBps: 1_000, accessPenaltyBps: 8_000, startsAtMonth: 0, endsAtMonth: null, status: "active", retaliationOfId: null, transactionIds: [] });
const harness = enableLongRunInvariantHarness(world, false);
const checkpoints: Array<Record<string, unknown>> = [];
const started = performance.now();
for (let month = 1; month <= months; month++) {
  stepMonth(world);
  if ([24, 60, 120, 240, 600].includes(month)) {
    const conflict = world.conflicts.conflicts[0];
    checkpoints.push({ month, readiness: Object.fromEntries(world.defenseEconomy.countries.filter((item) => ["us", "ru", "de", "jp", "kr"].includes(item.countryId)).map((item) => [item.countryId, item.readinessBps])), condition: Object.fromEntries(world.defenseEconomy.countries.filter((item) => ["us", "ru", "de", "jp", "kr"].includes(item.countryId)).map((item) => [item.countryId, item.equipmentConditionBps])), conflictStatus: conflict?.status ?? null, conflictLosses: conflict?.militaryLossesByCountry ?? null });
  }
}
const wallClockMs = Math.round(performance.now() - started);
const failures = checkInvariants(world).filter((item) => !item.ok);
const report = { mode, months, wallClockMs, checkpoints, conflicts: world.conflicts.conflicts.map((item) => ({ id: item.id, status: item.status, startMonth: item.startMonth, endMonth: item.endMonth, losses: item.militaryLossesByCountry, damage: item.capitalDamageMinorByCountry })), monthlyStageChecks: harness.checks, monthlyFailures: harness.failures, finalInvariantFailures: failures, saveSizeBytes: Buffer.byteLength(JSON.stringify(world)), heapUsedBytes: process.memoryUsage().heapUsed };
console.log(JSON.stringify(report));
assert.equal(harness.failures.length, 0);
assert.equal(failures.length, 0);
assert.ok(world.defenseEconomy.countries.every((item) => item.readinessBps > 0 && item.equipmentConditionBps > 0));
if (mode === "conflict") {
  assert.ok(world.conflicts.conflicts.length > 0);
  assert.ok(world.conflicts.conflicts.some((item) => item.militaryLossesByCountry.us > 0 || item.militaryLossesByCountry.ru > 0));
}
