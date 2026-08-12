import type { BalanceOfPaymentsRecord, MacroMonthlyPoint, PolicyInterventionMode, WorldState } from "../domain/model.ts";
import { createWorld } from "./create-world.ts";
import { runMonths } from "./simulation.ts";

export interface EconomicLabScenario {
  countryId: string;
  horizonMonths: number;
  policyRateDeltaBps?: number;
  policyMode?: PolicyInterventionMode;
  policyDurationMonths?: number;
  policyRatePathBps?: number[];
  incomeTaxDeltaBps?: number;
  corporateTaxDeltaBps?: number;
  governmentSpendingDeltaBps?: number;
  bankCapitalRequirementDeltaBps?: number;
  tradeCapacityDeltaBps?: number;
  resourceCapacityDeltaBps?: number;
  fxRegime?: "FLOATING" | "MANAGED_FLOAT" | "PEG";
  historicalStartYear?: number;
  replayObservedExternalShocks?: boolean;
}

export interface EconomicLabMetricDelta {
  metric: "nominalGdpMinor" | "inflationBps" | "unemploymentBps" | "currentAccountUsdMinor" | "creditMinor" | "housingIndexBps" | "stockIndexMinor" | "fxRatePpm" | "governmentDebtMinor" | "tradeUsdMinor";
  baseline: number;
  counterfactual: number;
  delta: number;
}

export interface EconomicLabCausalLink {
  from: string;
  to: string;
  observedContribution: number;
  evidence: string[];
}

export interface EconomicLabResult {
  baselineWorldId: string;
  counterfactualWorldId: string;
  countryId: string;
  horizonMonths: number;
  deltas: EconomicLabMetricDelta[];
  causalChain: EconomicLabCausalLink[];
  deterministicFingerprint: string;
}

export function cloneWorldForCounterfactual(world: WorldState): WorldState {
  return structuredClone(world);
}

export function createHistoricalValidationWorld(source: WorldState, startYear: number, endYear = 2023): WorldState {
  const world = createWorld(source.scenario, {
    mode: "REAL_WORLD",
    referenceYear: startYear,
    baselineDate: `${startYear}-12-31`,
  });
  world.baselineReference.replayObservedExternalShocks = false;
  // Annual observations are mapped to December. Include both the starting
  // December and the ending December in the simulated comparison window.
  runMonths(world, Math.max(1, (endYear - startYear) * 12 + 1));
  return world;
}

function applyScenario(world: WorldState, scenario: EconomicLabScenario): string[] {
  const evidence: string[] = [];
  const country = world.countries.find((item) => item.id === scenario.countryId);
  if (!country) throw new Error(`Страна ${scenario.countryId} не найдена`);
  const centralBank = world.centralBanks.find((item) => item.id === country.centralBankId);
  if (centralBank && scenario.policyRateDeltaBps) {
    const intervention = { id: `policy-experiment-${centralBank.id}-${world.clock.elapsedMonths}`, countryId: scenario.countryId, targetCentralBankId: centralBank.id, startMonth: world.clock.elapsedMonths, durationMonths: scenario.policyDurationMonths ?? scenario.horizonMonths, mode: scenario.policyMode ?? "RATE_SHOCK" as const, valueBps: scenario.policyRateDeltaBps, ratePathBps: scenario.policyRatePathBps ?? [], baselineRateBps: centralBank.policyRateBps };
    world.policyInterventions.push(intervention); evidence.push(intervention.id);
  }
  const government = world.governments.find((item) => item.id === country.governmentId);
  if (government && scenario.incomeTaxDeltaBps) { government.incomeTaxBps = Math.max(0, government.incomeTaxBps + scenario.incomeTaxDeltaBps); evidence.push(`incomeTax:${government.id}:${scenario.incomeTaxDeltaBps}`); }
  if (government && scenario.corporateTaxDeltaBps) { government.corporateTaxBps = Math.max(0, government.corporateTaxBps + scenario.corporateTaxDeltaBps); evidence.push(`corporateTax:${government.id}:${scenario.corporateTaxDeltaBps}`); }
  const profile = world.countryEconomicProfiles.find((item) => item.countryId === scenario.countryId);
  if (profile && scenario.governmentSpendingDeltaBps) { profile.governmentSpendingShareBps = Math.max(0, profile.governmentSpendingShareBps + scenario.governmentSpendingDeltaBps); evidence.push(`governmentSpending:${scenario.countryId}:${scenario.governmentSpendingDeltaBps}`); }
  if (scenario.bankCapitalRequirementDeltaBps) for (const bank of world.banks.filter((item) => item.countryId === scenario.countryId)) { bank.minimumCapitalRatioBps = Math.max(0, bank.minimumCapitalRatioBps + scenario.bankCapitalRequirementDeltaBps); evidence.push(`capitalRequirement:${bank.id}:${scenario.bankCapitalRequirementDeltaBps}`); }
  if (scenario.tradeCapacityDeltaBps) for (const route of world.tradeRoutes.filter((item) => item.originCountryId === scenario.countryId || item.destinationCountryId === scenario.countryId)) route.capacityMilliUnits = Math.max(1, Math.round(route.capacityMilliUnits * (10_000 + scenario.tradeCapacityDeltaBps) / 10_000));
  if (scenario.resourceCapacityDeltaBps) for (const deposit of world.resourceDeposits.filter((item) => item.countryId === scenario.countryId)) deposit.monthlyCapacityMilliUnits = Math.max(1, Math.round(deposit.monthlyCapacityMilliUnits * (10_000 + scenario.resourceCapacityDeltaBps) / 10_000));
  const regime = world.fxRegimes.find((item) => item.countryId === scenario.countryId);
  if (regime && scenario.fxRegime) { regime.regime = scenario.fxRegime; evidence.push(`fxRegime:${scenario.countryId}:${scenario.fxRegime}`); }
  return evidence;
}

function latestMacro(world: WorldState, countryId: string): MacroMonthlyPoint | null {
  return [...world.macroHistory].reverse().find((item) => item.countryId === countryId) ?? null;
}

function latestBop(world: WorldState, countryId: string): BalanceOfPaymentsRecord | null {
  return [...world.balanceOfPayments].reverse().find((item) => item.countryId === countryId) ?? null;
}

function observations(world: WorldState, countryId: string) {
  const metric = [...world.countryMetricsHistory].reverse().find((item) => item.countryId === countryId);
  const macro = latestMacro(world, countryId);
  const bop = latestBop(world, countryId);
  return {
    nominalGdpMinor: metric?.nominalGdpMinor ?? 0,
    inflationBps: macro?.inflationBps ?? metric?.inflationBps ?? 0,
    unemploymentBps: macro?.unemploymentBps ?? metric?.unemploymentBps ?? 0,
    currentAccountUsdMinor: bop?.currentAccountUsdMinor ?? 0,
    creditMinor: metric?.creditMinor ?? 0,
    housingIndexBps: world.countryEconomicProfiles.find((item) => item.countryId === countryId)?.housingCostIndexBps ?? 0,
    stockIndexMinor: world.marketIndices.find((item) => world.exchanges.find((exchange) => exchange.id === item.exchangeId)?.countryId === countryId)?.levelBps ?? 0,
    fxRatePpm: world.fxPairs.find((item) => item.baseCurrencyId === world.countries.find((country) => country.id === countryId)?.currencyReference && item.quoteCurrencyId === "USD")?.lastRatePpm ?? 1_000_000,
    governmentDebtMinor: world.governmentBudgets.find((item) => item.countryId === countryId)?.publicDebtMinor ?? 0,
    tradeUsdMinor: (bop?.goodsExportsUsdMinor ?? 0) + (bop?.goodsImportsUsdMinor ?? 0),
  };
}

function hashNumbers(values: number[]): string {
  let hash = 2_166_136_261;
  for (const value of values) hash = Math.imul(hash ^ Math.trunc(value), 16_777_619);
  return (hash >>> 0).toString(36);
}

export function runEconomicLab(source: WorldState, scenario: EconomicLabScenario): EconomicLabResult {
  const preparedSource = scenario.historicalStartYear && scenario.historicalStartYear !== source.baselineReference.referenceYear
    ? createWorld(source.scenario, { mode: "REAL_WORLD", referenceYear: scenario.historicalStartYear, baselineDate: `${scenario.historicalStartYear}-12-31` })
    : cloneWorldForCounterfactual(source);
  const labSource = preparedSource;
  labSource.baselineReference.replayObservedExternalShocks = scenario.replayObservedExternalShocks ?? false;
  const baseline = cloneWorldForCounterfactual(labSource);
  const counterfactual = cloneWorldForCounterfactual(labSource);
  const evidence = applyScenario(counterfactual, scenario);
  runMonths(baseline, scenario.horizonMonths);
  runMonths(counterfactual, scenario.horizonMonths);
  const base = observations(baseline, scenario.countryId);
  const altered = observations(counterfactual, scenario.countryId);
  const deltas = (Object.keys(base) as Array<keyof typeof base>).map((metric) => ({ metric, baseline: base[metric], counterfactual: altered[metric], delta: altered[metric] - base[metric] }));
  const contributionEvents = counterfactual.macroContributionEvents.filter((item) => item.countryId === scenario.countryId && item.elapsedMonth >= labSource.clock.elapsedMonths && item.evidenceIds.some((id) => evidence.includes(id)));
  const ranked = new Map<string, EconomicLabCausalLink>();
  for (const event of contributionEvents) {
    const key = `${event.fromMetric}:${event.toMetric}`;
    const existing = ranked.get(key) ?? { from: event.fromMetric, to: event.toMetric, observedContribution: 0, evidence: [] };
    existing.observedContribution += event.contribution;
    existing.evidence.push(...event.evidenceIds.filter((id) => !existing.evidence.includes(id)));
    ranked.set(key, existing);
  }
  const causalChain = [...ranked.values()].sort((left, right) => Math.abs(right.observedContribution) - Math.abs(left.observedContribution));
  return { baselineWorldId: `${labSource.seed}:${labSource.baselineReference.referenceYear}:${labSource.clock.elapsedMonths}:baseline`, counterfactualWorldId: `${labSource.seed}:${labSource.baselineReference.referenceYear}:${labSource.clock.elapsedMonths}:counterfactual`, countryId: scenario.countryId, horizonMonths: scenario.horizonMonths, deltas, causalChain, deterministicFingerprint: hashNumbers(deltas.flatMap((item) => [item.baseline, item.counterfactual, item.delta])) };
}
