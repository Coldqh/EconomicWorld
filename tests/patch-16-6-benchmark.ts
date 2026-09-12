import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createWorld } from "../src/economy/create-world.ts";
import { checkInvariants } from "../src/economy/invariants.ts";
import { stepMonth } from "../src/economy/simulation.ts";
import { runMarketMakers, seedMarketAgents } from "../src/markets/market-makers/engine.ts";
import { openBrokerageAccount, placeOrder } from "../src/markets/exchange.ts";
import { openMarginAccount, placeMarginBuy } from "../src/finance/leverage.ts";
import { requestFundRedemption } from "../src/finance/fund-liquidity.ts";
import { bankAccountBalance, bankAccountsForOwner, seedDeposit as seedGenesisDeposit } from "../src/core/ledger.ts";
import { subscribeFund } from "../src/finance/institutional.ts";
import type { Fund } from "../src/domain/model.ts";

type Scenario = "peace1" | "peace5" | "peace20" | "peace50" | "capital10" | "stress";

function seedDeposit(world: ReturnType<typeof createWorld>, ownerId: string, bankId: string, amountMinor: number): void {
  const initialized = world.initializationComplete;
  world.initializationComplete = false;
  try { seedGenesisDeposit(world, ownerId, bankId, amountMinor); }
  finally { world.initializationComplete = initialized; }
}

interface RunResult {
  run: number;
  warmup: boolean;
  wallClockMs: number;
  heapBeforeBytes: number;
  heapAfterBytes: number;
  saveSizeBytes: number;
  serializationMs: number;
  seed: "baseline";
  mode: "REAL_WORLD";
  months: number;
  timestamp: string;
  commitOrDiffId: string;
  genesisAfterInit: number;
  invariantFailures: number;
  transactionCount: number;
  tradeCount: number;
  orderCount: number;
  derivativeContracts: number;
  stress: null | {
    redemptionRequests: number;
    liquidationOrders: number;
    startPriceMinor: number;
    minimumPriceMinor: number;
    endPriceMinor: number;
    maximumSlippageBps: number;
    marginCalls: number;
    forcedSellerOrders: number;
    maximumMakerSpreadBps: number;
    etfArbitrageEvents: number;
  };
}

const scenario = (process.env.EW_BENCHMARK_SCENARIO ?? process.argv[2] ?? "peace20") as Scenario;
const recoveryRun = process.argv[3] === undefined ? null : Number.parseInt(process.argv[3], 10);
assert.ok(recoveryRun === null || Number.isInteger(recoveryRun) && recoveryRun >= 0, "Recovery run должен быть неотрицательным целым индексом");
const monthsByScenario: Record<Scenario, number> = { peace1: 12, peace5: 60, peace20: 240, peace50: 600, capital10: 120, stress: 12 };
assert.ok(scenario in monthsByScenario, `Неизвестный benchmark scenario: ${scenario}`);

const artifactPath = resolve(process.env.EW_BENCHMARK_ARTIFACT ?? "benchmark-results.json");
const progressPath = resolve(process.env.EW_BENCHMARK_PROGRESS_ARTIFACT ?? "benchmark-progress.json");
const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };
const commitOrDiffId = process.env.EW_BENCHMARK_REVISION ?? process.env.GITHUB_SHA ?? `working-tree:${packageVersion.version}`;

interface BenchmarkArtifact {
  patch: "16.6";
  generatedAt: string;
  commitOrDiffId: string;
  scenarios: Partial<Record<Scenario, unknown>>;
}

function readArtifact(): BenchmarkArtifact {
  if (!existsSync(artifactPath)) return { patch: "16.6", generatedAt: new Date().toISOString(), commitOrDiffId, scenarios: {} };
  try { return JSON.parse(readFileSync(artifactPath, "utf8")) as BenchmarkArtifact; }
  catch { return { patch: "16.6", generatedAt: new Date().toISOString(), commitOrDiffId, scenarios: {} }; }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function persistScenario(value: unknown): void {
  const artifact = readArtifact();
  artifact.generatedAt = new Date().toISOString();
  artifact.commitOrDiffId = commitOrDiffId;
  artifact.scenarios[scenario] = value;
  writeJsonAtomic(artifactPath, artifact);
}

function configureCapitalMarkets(world: ReturnType<typeof createWorld>): void {
  seedMarketAgents(world);
  for (const agent of world.marketAgents) {
    agent.capitalMinor = Math.round(agent.capitalMinor * 3);
    agent.riskLimitMinor = Math.round(agent.riskLimitMinor * 2);
    agent.latencyBps = Math.max(1, Math.floor(agent.latencyBps / 2));
  }
}

function configureStress(world: ReturnType<typeof createWorld>): { securityId: string; startPriceMinor: number; stressStartedAtMonth: number; redemptionRequests: number; liquidationOrders: number } {
  configureCapitalMarkets(world);
  const template = world.funds.find((item) => item.type === "open-end" && item.status === "active");
  assert.ok(template, "Для stress benchmark нужен шаблон открытого фонда");
  const bank = world.banks.find((item) => item.baseCurrency === template.currencyId && item.countryId === world.assetManagers.find((manager) => manager.id === template.managerId)?.countryId)!;
  const investorId = "benchmark-stress-investor";
  const fundId = "benchmark-stress-fund";
  seedDeposit(world, investorId, bank.id, 75_000_000);
  seedDeposit(world, fundId, bank.id, 1);
  const fundAccount = bankAccountsForOwner(world, fundId, bank.baseCurrency)[0];
  const investorAccount = bankAccountsForOwner(world, investorId, bank.baseCurrency)[0];
  const fund: Fund = { ...structuredClone(template), id: fundId, name: "Benchmark Stress Fund", bankAccountId: fundAccount.id, unitsOutstandingMicros: 0, navMinor: 0, unitSecurityId: null };
  world.funds.push(fund);
  world.assetManagers.find((manager) => manager.id === fund.managerId)?.fundIds.push(fund.id);
  assert.ok(subscribeFund(world, fund.id, investorId, 50_000_000, investorAccount.id).ok, "Stress fund subscription должна рассчитаться");
  openBrokerageAccount(world, fund.id, undefined, fund.bankAccountId);
  const fundBrokerage = world.brokerageAccounts.find((item) => item.ownerId === fund.id && item.currencyId === fund.currencyId)!;
  const initialCash = bankAccountBalance(world, fund.bankAccountId);
  for (const listing of world.listings.filter((item) => item.currencyId === fund.currencyId).sort((left, right) => right.lastPriceCents - left.lastPriceCents)) {
    if (bankAccountBalance(world, fund.bankAccountId) <= Math.round(initialCash * 0.2)) break;
    const sellerHolding = world.equityHoldings.filter((item) => item.securityId === listing.securityId && item.ownerId !== fund.id && item.shares > 1).sort((left, right) => right.shares - left.shares)[0];
    const sellerAccount = sellerHolding && bankAccountsForOwner(world, sellerHolding.ownerId, fund.currencyId)[0];
    if (!sellerHolding || !sellerAccount) continue;
    openBrokerageAccount(world, sellerHolding.ownerId, undefined, sellerAccount.id);
    const sellerBrokerage = world.brokerageAccounts.find((item) => item.ownerId === sellerHolding.ownerId && item.currencyId === fund.currencyId)!;
    const affordable = Math.floor((bankAccountBalance(world, fund.bankAccountId) - Math.round(initialCash * 0.15)) / Math.max(1, listing.lastPriceCents));
    const quantity = Math.max(0, Math.min(sellerHolding.shares, affordable));
    if (quantity <= 0) continue;
    const sell = placeOrder(world, sellerBrokerage.id, listing.securityId, "sell", "limit", quantity, listing.lastPriceCents, listing.exchangeId);
    if (sell.ok) placeOrder(world, fundBrokerage.id, listing.securityId, "buy", "market", quantity, null, listing.exchangeId);
  }
  const units = fund && world.fundUnitHoldings.filter((item) => item.fundId === fund.id && item.unitsMicros > 0).sort((left, right) => right.unitsMicros - left.unitsMicros)[0];
  const fundHolding = fund && world.equityHoldings.filter((item) => item.ownerId === fund.id && item.shares > 0).sort((left, right) => right.shares - left.shares)[0];
  const listing = fundHolding && world.listings.find((item) => item.securityId === fundHolding.securityId && item.currencyId === fund.currencyId);
  assert.ok(fund && units && listing, "Для stress benchmark нужен открытый фонд с ликвидной позицией");
  runMarketMakers(world);
  const leveragedId = "benchmark-leveraged-investor";
  seedDeposit(world, leveragedId, bank.id, 100_000);
  const settlement = bankAccountsForOwner(world, leveragedId, listing.currencyId)[0];
  openBrokerageAccount(world, leveragedId, undefined, settlement.id);
  const brokerage = world.brokerageAccounts.find((item) => item.ownerId === leveragedId && item.currencyId === listing.currencyId)!;
  const margin = openMarginAccount(world, leveragedId, brokerage.id);
  assert.ok(margin.marginAccountId, "Stress leverage должен открыть маржинальный счёт");
  const marginAccount = world.marginAccounts.find((item) => item.id === margin.marginAccountId)!;
  const bestAsk = world.marketOrders.filter((order) => order.securityId === listing.securityId && order.exchangeId === listing.exchangeId && order.side === "sell" && (order.status === "open" || order.status === "partially-filled")).reduce((minimum, order) => Math.min(minimum, order.limitPriceCents ?? Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.ok(Number.isSafeInteger(bestAsk) && bestAsk < Number.MAX_SAFE_INTEGER, "Маркет-мейкер должен дать ask для плечевой позиции");
  const marginQuantity = Math.max(1, Math.floor(bankAccountBalance(world, settlement.id) * 19 / Math.max(1, bestAsk) / 10));
  const marginBuy = placeMarginBuy(world, marginAccount.id, listing.securityId, marginQuantity, bestAsk);
  assert.ok(marginBuy.ok && marginAccount.borrowedMinor > 0, "Плечевая позиция должна реально исполниться и получить финансирование");
  // A stress margin add-on is a real-world part of a redemption shock: the
  // prime broker raises maintenance requirements after the position is open.
  // The initial purchase still passes the ordinary initial-margin checks.
  marginAccount.maintenanceMarginBps = 6_500;
  const startPriceMinor = listing.lastPriceCents;
  const request = requestFundRedemption(world, fund.id, units.investorId, Math.max(1, Math.floor(units.unitsMicros * 0.9)));
  assert.ok(request, "Заявка на погашение должна быть создана");
  return { securityId: listing.securityId, startPriceMinor, stressStartedAtMonth: world.clock.elapsedMonths, redemptionRequests: 1, liquidationOrders: request.sellOrderIds.length };
}

function runOne(index: number): RunResult {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const initializationGenesisIds = new Set(world.ledger.transactions.filter((transaction) => transaction.kind === "GENESIS").map((transaction) => transaction.id));
  let stressed: { securityId: string; startPriceMinor: number; stressStartedAtMonth: number; redemptionRequests: number; liquidationOrders: number } | null = null;
  if (scenario === "capital10") configureCapitalMarkets(world);
  if (scenario === "stress") stressed = configureStress(world);
  global.gc?.();
  const heapBeforeBytes = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let completed = 0; completed < monthsByScenario[scenario]; completed += 1) {
    stepMonth(world);
    const elapsedMs = performance.now() - started;
    if (elapsedMs >= 120_000 && ((completed + 1) % 12 === 0 || completed + 1 === monthsByScenario[scenario])) {
      writeJsonAtomic(progressPath, { scenario, run: index, warmup: index === 0, completedMonths: completed + 1, totalMonths: monthsByScenario[scenario], elapsedMs: Math.round(elapsedMs), timestamp: new Date().toISOString(), commitOrDiffId });
    }
  }
  const wallClockMs = Math.round(performance.now() - started);
  global.gc?.();
  const heapAfterBytes = process.memoryUsage().heapUsed;
  const failures = checkInvariants(world).filter((item) => !item.ok);
  const stress = stressed ? {
    redemptionRequests: Math.max(stressed.redemptionRequests, world.fundRedemptionRequests.length),
    liquidationOrders: Math.max(stressed.liquidationOrders, world.fundRedemptionRequests.reduce((sum, item) => sum + item.sellOrderIds.length, 0)),
    startPriceMinor: stressed.startPriceMinor,
    minimumPriceMinor: world.ohlcvBars.filter((item) => item.securityId === stressed!.securityId && item.elapsedMonth >= stressed!.stressStartedAtMonth).reduce((minimum, item) => Math.min(minimum, item.lowCents), stressed.startPriceMinor),
    endPriceMinor: world.listings.find((item) => item.securityId === stressed!.securityId)?.lastPriceCents ?? 0,
    maximumSlippageBps: world.executionQuality.reduce((maximum, item) => Math.max(maximum, Math.abs(item.slippageBps)), 0),
    marginCalls: world.marginCalls.length,
    forcedSellerOrders: world.events.filter((event) => event.type === "ForcedLiquidation").reduce((sum, event) => sum + Number(event.data.orderCount ?? event.causeIds.length), 0),
    maximumMakerSpreadBps: world.marketMakerQuotes.reduce((maximum, item) => Math.max(maximum, Math.round((item.askMinor - item.bidMinor) * 10_000 / Math.max(1, item.bidMinor))), 0),
    etfArbitrageEvents: world.etfArbitrageEvents.length,
  } : null;
  const serializationStarted = performance.now();
  const serializedWorld = JSON.stringify(world);
  const serializationMs = Math.round(performance.now() - serializationStarted);
  const genesisAfterInit = world.ledger.transactions.filter((transaction) => transaction.kind === "GENESIS" && !initializationGenesisIds.has(transaction.id)).length;
  const ledgerTransactions = world.ledger.transactions.length + world.ledgerArchives.reduce((sum, archive) => sum + archive.transactionCount, 0);
  const marketTrades = world.marketTrades.length + world.history.compactedMarketRecords.reduce((sum, record) => sum + record.tradeCount, 0);
  const marketOrders = world.marketOrders.length + world.archivedMarketOrders.length + world.history.compactedMarketRecords.reduce((sum, record) => sum + record.orderCount, 0);
  return { run: index, warmup: index === 0, wallClockMs, heapBeforeBytes, heapAfterBytes, saveSizeBytes: Buffer.byteLength(serializedWorld), serializationMs, seed: "baseline", mode: "REAL_WORLD", months: monthsByScenario[scenario], timestamp: new Date().toISOString(), commitOrDiffId, genesisAfterInit, invariantFailures: failures.length, transactionCount: ledgerTransactions, tradeCount: marketTrades, orderCount: marketOrders, derivativeContracts: world.derivativeContracts.length + world.history.compactedDerivativeRecords.length, stress };
}

const runs: RunResult[] = [];
for (const index of recoveryRun === null ? [0, 1, 2, 3] : [recoveryRun]) {
  const result = runOne(index);
  runs.push(result);
  console.error(JSON.stringify({ progressRun: index, warmup: result.warmup, wallClockMs: result.wallClockMs, saveSizeBytes: result.saveSizeBytes, invariantFailures: result.invariantFailures }));
  if (!result.warmup || recoveryRun !== null) persistScenario({ scenario, months: monthsByScenario[scenario], status: "in-progress", runs });
}
if (recoveryRun !== null) {
  const result = runs[0]!;
  const report = { scenario, months: monthsByScenario[scenario], protocol: { recoveryMeasuredRun: recoveryRun, profiler: false }, runs };
  persistScenario(report);
  console.log(JSON.stringify(report));
  assert.equal(result.invariantFailures, 0);
  assert.equal(result.genesisAfterInit, 0);
  assert.ok(result.saveSizeBytes <= (scenario === "peace50" ? 45_000_000 : 33_000_000));
  process.exit(0);
}
const measured = runs.slice(1);
const sortedTimes = measured.map((item) => item.wallClockMs).sort((left, right) => left - right);
const sortedSaves = measured.map((item) => item.saveSizeBytes).sort((left, right) => left - right);
const sortedHeaps = measured.map((item) => item.heapAfterBytes).sort((left, right) => left - right);
const report = { scenario, months: monthsByScenario[scenario], protocol: { warmupRuns: 1, measuredRuns: 3, profiler: false }, wallClockMs: { min: sortedTimes[0], median: sortedTimes[1], max: sortedTimes[2] }, saveSizeBytes: { min: sortedSaves[0], median: sortedSaves[1], max: sortedSaves[2] }, steadyHeapBytes: { min: sortedHeaps[0], median: sortedHeaps[1], max: sortedHeaps[2] }, runs };
persistScenario(report);
console.log(JSON.stringify(report));
assert.ok(measured.every((item) => item.invariantFailures === 0));
assert.ok(measured.every((item) => item.genesisAfterInit === 0));
assert.ok(measured.every((item) => item.saveSizeBytes <= (scenario === "peace50" ? 45_000_000 : 33_000_000)));
const timeLimitMs: Partial<Record<Scenario, number>> = { peace20: 60_000, peace50: 180_000, capital10: 30_000, stress: 5_000 };
if (timeLimitMs[scenario]) assert.ok(report.wallClockMs.median <= timeLimitMs[scenario]!);
if (scenario === "stress") assert.ok(measured.every((item) => item.stress
  && item.stress.redemptionRequests > 0
  && item.stress.liquidationOrders > 0
  && item.stress.minimumPriceMinor < item.stress.startPriceMinor
  && item.stress.marginCalls > 0
  && item.stress.forcedSellerOrders > 0
  && item.stress.maximumMakerSpreadBps > 0
  && item.stress.etfArbitrageEvents > 0));
