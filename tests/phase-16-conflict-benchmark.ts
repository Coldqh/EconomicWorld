import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { activateConflict, mobilizeConflict, proposeConflict } from "../src/conflict/engine.ts";
import { checkInvariants } from "../src/economy/invariants.ts";

const months = Number(process.env.EW_CONFLICT_MONTHS ?? 240);
const world = createWorld("baseline", { mode: "REAL_WORLD" });
const conflict = proposeConflict(world, "us", "de", "coerce");
if (!conflict || !activateConflict(world, conflict.id)) throw new Error("Конфликт не активирован");
mobilizeConflict(world, conflict.id, "us", 150_000, 1_200);
mobilizeConflict(world, conflict.id, "de", 90_000, 1_000);
const started = performance.now(); runMonths(world, months); const wallClockMs = Math.round(performance.now() - started);
const failures = checkInvariants(world).filter((item) => !item.ok);
console.log(JSON.stringify({ months, wallClockMs, status: conflict.status, fiscalCost: conflict.fiscalCostMinorByCountry, personnelLosses: conflict.militaryLossesByCountry, equipmentLosses: conflict.equipmentLossMinorByCountry, capitalDamage: conflict.capitalDamageMinorByCountry, tradeDisruption: conflict.tradeDisruptionBpsByCountry, saveSizeBytes: Buffer.byteLength(JSON.stringify(world)), heapUsedBytes: process.memoryUsage().heapUsed, failures: failures.map((item) => item.id) }));
if (failures.length) process.exitCode = 1;
