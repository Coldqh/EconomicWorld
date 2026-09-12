import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { runMonths } from "../src/economy/simulation.ts";

interface Sample { months: number; wallClockMs: number; saveSizeBytes: number; heapBytes: number; observations: number; beliefs: number; traces: number; invariantFailures: number }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
function sample(months: number): Sample {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  global.gc?.(); const started = performance.now(); runMonths(world, months); const wallClockMs = Math.round(performance.now() - started);
  global.gc?.(); const heapBytes = process.memoryUsage().heapUsed; const saveSizeBytes = Buffer.byteLength(JSON.stringify(world));
  return { months, wallClockMs, saveSizeBytes, heapBytes, observations: world.information.observations.length, beliefs: world.information.beliefs.length, traces: world.information.decisionTraces.length, invariantFailures: checkInvariants(world).filter((item) => !item.ok).length };
}
function summarize(samples: Sample[]) { return { wallClockMs: { min: Math.min(...samples.map((item) => item.wallClockMs)), median: median(samples.map((item) => item.wallClockMs)), max: Math.max(...samples.map((item) => item.wallClockMs)) }, saveSizeBytes: { min: Math.min(...samples.map((item) => item.saveSizeBytes)), median: median(samples.map((item) => item.saveSizeBytes)), max: Math.max(...samples.map((item) => item.saveSizeBytes)) }, heapBytes: { min: Math.min(...samples.map((item) => item.heapBytes)), median: median(samples.map((item) => item.heapBytes)), max: Math.max(...samples.map((item) => item.heapBytes)) }, samples }; }

sample(600);
const twenty = Array.from({ length: 3 }, (_, index) => { const value = sample(240); console.error(JSON.stringify({ scenario: "20Y", run: index + 1, ...value })); return value; });
const fifty = Array.from({ length: 3 }, (_, index) => { const value = sample(600); console.error(JSON.stringify({ scenario: "50Y", run: index + 1, ...value })); return value; });
const artifact = { phase: 17, generatedAt: new Date().toISOString(), protocol: { warmupMonths: 600, measuredRuns: 3, mode: "REAL_WORLD", seed: "baseline" }, twentyYears: summarize(twenty), fiftyYears: summarize(fifty) };
writeFileSync("phase-17-benchmark.json", `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact));
assert.ok([...twenty, ...fifty].every((item) => item.invariantFailures === 0));
assert.ok(artifact.twentyYears.wallClockMs.max <= 65_000);
assert.ok(artifact.fiftyYears.wallClockMs.max <= 180_000);
assert.ok(artifact.twentyYears.saveSizeBytes.max <= 36_000_000);
assert.ok(artifact.fiftyYears.saveSizeBytes.max <= 50_000_000);
