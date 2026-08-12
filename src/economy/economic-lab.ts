import type { BalanceOfPaymentsRecord, MacroMonthlyPoint, WorldState } from "../domain/model.ts";
import { runMonths } from "./simulation.ts";

export interface EconomicLabScenario {
  countryId: string;
  horizonMonths: number;
  policyRateDeltaBps?: number;
  incomeTaxDeltaBps?: number;
  corporateTaxDeltaBps?: number;
  governmentSpendingDeltaBps?: number;
  bankCapitalRequirementDeltaBps?: number;
  tradeCapacityDeltaBps?: number;
  resourceCapacityDeltaBps?: number;
  fxRegime?: "FLOATING" | "MANAGED_FLOAT" | "PEG";
}

export interface EconomicLabMetricDelta {
  metric: "nominalGdpMinor" | "inflationBps" | "unemploymentBps" | "currentAccountUsdMinor" | "creditMinor";
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

function applyScenario(world: WorldState, scenario: EconomicLabScenario): string[] {
  const evidence: string[] = [];
  const country = world.countries.find((item) => item.id === scenario.countryId);
  if (!country) throw new Error(`Страна ${scenario.countryId} не найдена`);
  const centralBank = world.centralBanks.find((item) => item.id === country.centralBankId);
  if (centralBank && scenario.policyRateDeltaBps) { centralBank.policyRateBps += scenario.policyRateDeltaBps; evidence.push(`policyRate:${centralBank.id}:${scenario.policyRateDeltaBps}`); }
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
  };
}

function hashNumbers(values: number[]): string {
  let hash = 2_166_136_261;
  for (const value of values) hash = Math.imul(hash ^ Math.trunc(value), 16_777_619);
  return (hash >>> 0).toString(36);
}

export function runEconomicLab(source: WorldState, scenario: EconomicLabScenario): EconomicLabResult {
  const baseline = cloneWorldForCounterfactual(source);
  const counterfactual = cloneWorldForCounterfactual(source);
  const evidence = applyScenario(counterfactual, scenario);
  runMonths(baseline, scenario.horizonMonths);
  runMonths(counterfactual, scenario.horizonMonths);
  const base = observations(baseline, scenario.countryId);
  const altered = observations(counterfactual, scenario.countryId);
  const deltas = (Object.keys(base) as Array<keyof typeof base>).map((metric) => ({ metric, baseline: base[metric], counterfactual: altered[metric], delta: altered[metric] - base[metric] }));
  const nonZero = deltas.filter((item) => item.delta !== 0);
  const causalChain: EconomicLabCausalLink[] = nonZero.map((delta) => ({ from: evidence[0] ?? "scenario", to: delta.metric, observedContribution: delta.delta, evidence: [...evidence, `baseline:${delta.baseline}`, `counterfactual:${delta.counterfactual}`] }));
  return { baselineWorldId: `${source.seed}:${source.clock.elapsedMonths}:baseline`, counterfactualWorldId: `${source.seed}:${source.clock.elapsedMonths}:counterfactual`, countryId: scenario.countryId, horizonMonths: scenario.horizonMonths, deltas, causalChain, deterministicFingerprint: hashNumbers(deltas.flatMap((item) => [item.baseline, item.counterfactual, item.delta])) };
}
