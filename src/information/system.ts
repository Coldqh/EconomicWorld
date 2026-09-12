import type { BeliefMetric, InformationConfidence, InformationSource, InformationState, InformationStatus, ObservedMetric, WorldState } from "../domain/model.ts";
import { bankAccountBalance, bankAccountsForOwner, ensureAccount, openBankAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";

const clamp = (value: number, min = 0, max = 10_000) => Math.max(min, Math.min(max, Math.round(value)));
export const PUBLIC_INFORMATION_AGENT = "PUBLIC";
const beliefIndexes = new WeakMap<WorldState, Map<string, BeliefMetric>>();
const beliefKey = (agentId: string, metricId: string, subjectId: string) => `${agentId}\u0000${metricId}\u0000${subjectId}`;

function beliefIndex(world: WorldState): Map<string, BeliefMetric> {
  let index = beliefIndexes.get(world);
  if (!index) { index = new Map(world.information.beliefs.map((item) => [beliefKey(item.agentId, item.metricId, item.subjectId), item])); beliefIndexes.set(world, index); }
  return index;
}

function hashUnit(...parts: Array<string | number>): number {
  let hash = 2_166_136_261;
  for (const char of parts.join("|")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16_777_619); }
  return ((hash >>> 0) % 20_001) / 10_000 - 1;
}

function confidenceLabel(value: number): InformationConfidence { return value >= 7_500 ? "HIGH" : value >= 4_500 ? "MEDIUM" : "LOW"; }

export function createInformationState(countryIds: string[] = []): InformationState {
  const sources: InformationSource[] = [
    { id: "public-statistics", type: "PUBLIC_STATISTICS", ownerId: null, delayMonths: 2, accuracyBps: 8_400, biasBps: 0, reliabilityBps: 8_500, costMinor: 0, scope: ["macro"], access: "PUBLIC" },
    { id: "company-report", type: "COMPANY_REPORT", ownerId: null, delayMonths: 3, accuracyBps: 8_000, biasBps: 80, reliabilityBps: 8_000, costMinor: 0, scope: ["company"], access: "PUBLIC" },
    { id: "market-price", type: "MARKET_PRICE", ownerId: null, delayMonths: 0, accuracyBps: 7_200, biasBps: 0, reliabilityBps: 7_500, costMinor: 0, scope: ["market"], access: "PUBLIC" },
    { id: "bank-internal", type: "BANK_INTERNAL_DATA", ownerId: null, delayMonths: 0, accuracyBps: 9_400, biasBps: 0, reliabilityBps: 9_500, costMinor: 0, scope: ["borrower"], access: "OWNER" },
    { id: "company-internal", type: "COMPANY_INTERNAL_DATA", ownerId: null, delayMonths: 0, accuracyBps: 9_700, biasBps: 0, reliabilityBps: 9_600, costMinor: 0, scope: ["company"], access: "OWNER" },
    { id: "government-internal", type: "GOVERNMENT_INTERNAL_DATA", ownerId: null, delayMonths: 0, accuracyBps: 9_700, biasBps: 0, reliabilityBps: 9_600, costMinor: 0, scope: ["own-country"], access: "GOVERNMENT" },
    { id: "trade-data", type: "TRADE_DATA", ownerId: null, delayMonths: 1, accuracyBps: 9_000, biasBps: 0, reliabilityBps: 9_000, costMinor: 0, scope: ["trade"], access: "GOVERNMENT" },
    { id: "intelligence-estimate", type: "INTELLIGENCE_ESTIMATE", ownerId: null, delayMonths: 1, accuracyBps: 6_800, biasBps: 0, reliabilityBps: 7_000, costMinor: 0, scope: ["foreign"], access: "GOVERNMENT" },
  ];
  return {
    sources, observations: [], beliefs: [], surprises: [], decisionTraces: [], archivedSummaries: [], nextObservationId: 1, nextSurpriseId: 1, nextTraceId: 1, lastReleaseMonth: -1,
    intelligence: countryIds.map((countryId, index) => ({ countryId, collectionBps: 5_800 + index * 190, analysisBps: 5_900 + index * 170, economicIntelligenceBps: 6_000 + index * 160, militaryIntelligenceBps: 5_700 + index * 180, counterintelligenceBps: 5_500 + index * 160, opacityBps: 3_500 + (index % 3) * 600, monthlyCostMinor: 2_000_000 + index * 250_000, focus: index % 2 ? "ECONOMIC" : "MILITARY" })),
  };
}

function addObservation(world: WorldState, input: Omit<ObservedMetric, "id" | "confidence" | "informationAge" | "lowerBound" | "upperBound">): ObservedMetric {
  const spread = Math.max(1, Math.round(Math.abs(input.observedValue) * (10_000 - input.confidenceBps) / 10_000));
  const observation: ObservedMetric = { ...input, id: `obs-${world.information.nextObservationId++}`, confidence: confidenceLabel(input.confidenceBps), informationAge: Math.max(0, world.clock.elapsedMonths - input.observationMonth), lowerBound: input.observedValue - spread, upperBound: input.observedValue + spread };
  world.information.observations.push(observation);
  return observation;
}

function updateBelief(world: WorldState, agentId: string, observation: ObservedMetric): BeliefMetric {
  const key = beliefKey(agentId, observation.metricId, observation.subjectId);
  const index = beliefIndex(world);
  const prior = index.get(key) ?? null;
  const previousObservedValue = prior?.observedValue ?? null;
  const freshnessBps = clamp(10_000 - observation.informationAge * 550, 2_000, 10_000);
  const weight = clamp(observation.qualityBps * freshnessBps / 10_000, 1_000, 9_800);
  const value = prior ? Math.round((prior.observedValue * (10_000 - weight) + observation.observedValue * weight) / 10_000) : observation.observedValue;
  const confidenceBps = prior ? clamp((prior.confidenceBps * 3 + observation.confidenceBps * 2) / 5) : observation.confidenceBps;
  const belief: BeliefMetric = { ...observation, id: `belief:${key}`, agentId, observedValue: value, priorValue: prior?.observedValue ?? null, confidenceBps, confidence: confidenceLabel(confidenceBps), updatedAtMonth: world.clock.elapsedMonths };
  if (prior) Object.assign(prior, belief); else world.information.beliefs.push(belief);
  index.set(key, prior ?? belief);
  if (previousObservedValue !== null && Math.abs(value - previousObservedValue) > Math.max(1, Math.abs(previousObservedValue) * 0.08)) {
    world.information.surprises.push({ id: `surprise-${world.information.nextSurpriseId++}`, agentId, metricId: observation.metricId, subjectId: observation.subjectId, expectedValue: previousObservedValue, realizedValue: value, magnitudeBps: clamp(Math.abs(value - previousObservedValue) * 10_000 / Math.max(1, Math.abs(previousObservedValue))), elapsedMonth: world.clock.elapsedMonths, cause: observation.revisionOfId ? "Пересмотр опубликованных данных" : "Новая доступная информация" });
  }
  return belief;
}

function noisyValue(world: WorldState, source: InformationSource, metricId: string, subjectId: string, trueValue: number, observationMonth: number, extraAccuracyBps = 0): number {
  const accuracy = clamp(source.accuracyBps + extraAccuracyBps, 1_000, 9_950);
  const error = hashUnit(world.seed, source.id, metricId, subjectId, observationMonth) * (10_000 - accuracy) / 10_000;
  return Math.round(trueValue * (1 + error + source.biasBps / 100_000));
}

function publish(world: WorldState, agentIds: string[], sourceId: string, metricId: string, subjectId: string, trueValue: number, observationMonth: number, status: InformationStatus, qualityAdjustment = 0): ObservedMetric {
  const source = world.information.sources.find((item) => item.id === sourceId)!;
  const prior = [...world.information.observations].reverse().find((item) => item.metricId === metricId && item.subjectId === subjectId && item.sourceIds.includes(sourceId));
  const qualityBps = clamp(source.reliabilityBps + qualityAdjustment - Math.max(0, world.clock.elapsedMonths - observationMonth) * 120, 1_500, 9_900);
  const observedValue = noisyValue(world, source, metricId, subjectId, trueValue, observationMonth, qualityAdjustment / 2);
  const observation = addObservation(world, { metricId, subjectId, observedValue, confidenceBps: qualityBps, observationMonth, releaseMonth: world.clock.elapsedMonths, sourceIds: [sourceId], qualityBps, status, revisionOfId: prior && prior.observationMonth === observationMonth ? prior.id : null });
  for (const agentId of agentIds) updateBelief(world, agentId, observation);
  return observation;
}

function compactInformation(world: WorldState): void {
  const cutoff = world.clock.elapsedMonths - 3;
  const old = world.information.observations.filter((item) => item.releaseMonth < cutoff);
  if (old.length) {
    const average = Math.round(old.reduce((sum, item) => sum + (10_000 - item.confidenceBps), 0) / old.length);
    world.information.archivedSummaries.push({ key: `observations-through-${cutoff}`, count: old.length, averageSurpriseBps: average, throughMonth: cutoff });
    world.information.observations = world.information.observations.filter((item) => item.releaseMonth >= cutoff);
  }
  if (world.information.archivedSummaries.length > 24) world.information.archivedSummaries.splice(0, world.information.archivedSummaries.length - 24);
  if (world.information.surprises.length > 300) world.information.surprises.splice(0, world.information.surprises.length - 300);
  if (world.information.decisionTraces.length > 500) world.information.decisionTraces.splice(0, world.information.decisionTraces.length - 500);
}

function resolveDecisionOutcomes(world: WorldState): void {
  for (const trace of world.information.decisionTraces.filter((item) => item.realizedResult === null && world.clock.elapsedMonths - item.elapsedMonth >= (item.decisionType === "M&A_DILIGENCE" ? 1 : 12))) {
    if (trace.decisionType === "CAPEX") trace.realizedResult = world.companies.find((item) => item.id === trace.subjectId)?.lastSalesMilliUnits ?? null;
    else if (trace.decisionType.startsWith("CREDIT_")) trace.realizedResult = world.companies.find((item) => item.id === trace.subjectId)?.financialReports.at(-1)?.operatingCashFlowCents ?? null;
    else if (trace.decisionType === "M&A_DILIGENCE") trace.realizedResult = getBelief(world, trace.agentId, "diligence-risk-bps", trace.subjectId)?.observedValue ?? null;
    else if (trace.decisionType === "CONFLICT_ASSESSMENT") trace.realizedResult = world.defenseEconomy.countries.find((item) => item.countryId === trace.subjectId)?.readinessBps ?? null;
    if (trace.realizedResult !== null) trace.realizedAtMonth = world.clock.elapsedMonths;
  }
}

function fundIntelligence(world: WorldState): void {
  for (const capability of world.information.intelligence) {
    const government = world.governments.find((item) => item.countryId === capability.countryId);
    if (!government || capability.monthlyCostMinor <= 0) continue;
    const payer = bankAccountsForOwner(world, government.id, government.currencyId)[0];
    if (!payer) continue;
    let recipientId: string | null = bankAccountsForOwner(world, `intelligence-service:${capability.countryId}`, government.currencyId)[0]?.id ?? null;
    if (!recipientId) {
      const opened = openBankAccount(world, `intelligence-service:${capability.countryId}`, payer.bankId, true);
      recipientId = opened.accountId ?? null;
    }
    const cost = Math.min(capability.monthlyCostMinor * 12, bankAccountBalance(world, payer.id));
    const paid = recipientId && cost > 0 ? transferBankAccountBalance(world, payer.id, recipientId, cost, "PROCUREMENT", `Стратегическая аналитика ${capability.countryId}`) : null;
    if (paid) {
      const serviceId = `intelligence-service:${capability.countryId}`;
      const expenseId = `expense:intelligence:${government.id}`;
      const incomeId = `income:intelligence:${serviceId}`;
      ensureAccount(world.ledger, expenseId, government.id, "Стратегическая аналитика", "expense", government.currencyId);
      ensureAccount(world.ledger, incomeId, serviceId, "Доход стратегической аналитики", "income", government.currencyId);
      postTransaction(world, "PROCUREMENT", `Признание услуг стратегической аналитики ${capability.countryId}`, [{ accountId: expenseId, side: "debit", amountCents: cost }, { accountId: incomeId, side: "credit", amountCents: cost }], [paid]);
    }
    if (!paid) { capability.collectionBps = clamp(capability.collectionBps - 20, 1_000, 10_000); capability.analysisBps = clamp(capability.analysisBps - 20, 1_000, 10_000); }
  }
}

function revisedHistoricalValue(world: WorldState, observation: ObservedMetric): number | null {
  const point = world.macroHistory.find((item) => item.countryId === observation.subjectId && item.elapsedMonth === observation.observationMonth);
  const state = world.countryMacroStates.find((item) => item.countryId === observation.subjectId);
  if (observation.metricId === "gdp-growth-bps") return point?.gdpGrowthBps ?? null;
  if (observation.metricId === "financial-stress-bps") {
    if (point) return Math.round((point.defaultRateBps + point.sovereignRiskBps + point.lendingStandardsBps) / 3);
    if (state) return Math.round((state.defaultRateBps + state.sovereignRiskBps + state.lendingStandardsBps) / 3);
  }
  return null;
}

export function runInformationMonth(world: WorldState): void {
  if (world.information.lastReleaseMonth === world.clock.elapsedMonths) return;
  for (const belief of world.information.beliefs) belief.informationAge = Math.max(0, world.clock.elapsedMonths - belief.observationMonth);
  if (world.clock.elapsedMonths % 12 === 0) fundIntelligence(world);
  const publicAgents = [PUBLIC_INFORMATION_AGENT];
  const statisticalMonth = world.clock.elapsedMonths - 2;
  if (statisticalMonth >= 0) {
    for (const country of world.countries) {
      const point = [...world.macroHistory].reverse().find((item) => item.countryId === country.id && item.elapsedMonth <= statisticalMonth);
      const current = world.countryMacroStates.find((item) => item.countryId === country.id);
      if (!point && !current) continue;
      const observationMonth = point?.elapsedMonth ?? statisticalMonth;
      const growthBps = point?.gdpGrowthBps ?? current!.outputGapBps;
      const stressBps = Math.round(((point?.defaultRateBps ?? current!.defaultRateBps) + (point?.sovereignRiskBps ?? current!.sovereignRiskBps) + (point?.lendingStandardsBps ?? current!.lendingStandardsBps)) / 3);
      publish(world, publicAgents, "public-statistics", "gdp-growth-bps", country.id, growthBps, observationMonth, "PUBLIC", world.clock.elapsedMonths % 12 === 0 ? 500 : 0);
      publish(world, publicAgents, "public-statistics", "financial-stress-bps", country.id, stressBps, observationMonth, "PUBLIC");
    }
  }
  if (world.clock.elapsedMonths > 12 && world.clock.elapsedMonths % 12 === 0) {
    const candidates = world.information.observations.filter((item) => item.sourceIds.includes("public-statistics") && item.revisionOfId === null && item.observationMonth <= world.clock.elapsedMonths - 10).slice(-world.countries.length * 2);
    for (const previous of candidates) {
      const revisedValue = revisedHistoricalValue(world, previous);
      if (revisedValue !== null) publish(world, publicAgents, "public-statistics", previous.metricId, previous.subjectId, revisedValue, previous.observationMonth, "PUBLIC", 900);
    }
  }
  if (world.clock.elapsedMonths % 3 === 0) {
    for (const company of world.companies.filter((item) => item.active && (item.corporateStatus === "public" || item.ownerHouseholdId === world.player.householdId))) {
      const report = company.financialReports.at(-1);
      if (report) publish(world, publicAgents, "company-report", "operating-cash-flow", company.id, report.operatingCashFlowCents, Math.max(0, world.clock.elapsedMonths - 3), "PUBLIC");
    }
  }
  if (world.clock.elapsedMonths % 3 === 0 || !world.information.beliefs.some((item) => item.metricId === "readiness-bps")) {
    for (const observer of world.countries) for (const target of world.countries) {
      if (observer.id === target.id) continue;
      const defense = world.defenseEconomy.countries.find((item) => item.countryId === target.id);
      if (!defense) continue;
      collectStrategicEstimate(world, observer.id, target.id, "readiness-bps", defense.readinessBps);
      collectStrategicEstimate(world, observer.id, target.id, "stockpile-minor", defense.munitionsStockMinor + defense.fuelStockMinor + defense.sparePartsStockMinor);
    }
  }
  world.information.lastReleaseMonth = world.clock.elapsedMonths;
  resolveDecisionOutcomes(world);
  if (world.clock.elapsedMonths % 3 === 0 || world.information.observations.length > 2_000) compactInformation(world);
}

export function setIntelligenceFocus(world: WorldState, countryId: string, focus: WorldState["information"]["intelligence"][number]["focus"]): boolean {
  const capability = world.information.intelligence.find((item) => item.countryId === countryId);
  if (!capability) return false;
  capability.focus = focus;
  return true;
}

export function collectStrategicEstimate(world: WorldState, observerCountryId: string, targetCountryId: string, metricId: string, trueValue: number): BeliefMetric {
  const observer = world.information.intelligence.find((item) => item.countryId === observerCountryId);
  const target = world.information.intelligence.find((item) => item.countryId === targetCountryId);
  const focusBonus = observer?.focus === "MILITARY" ? 800 : 0;
  const capability = ((observer?.collectionBps ?? 5_000) + (observer?.analysisBps ?? 5_000) + (observer?.militaryIntelligenceBps ?? 5_000)) / 3;
  const obstruction = ((target?.counterintelligenceBps ?? 5_000) + (target?.opacityBps ?? 3_000)) / 2;
  const adjustment = Math.round((capability - obstruction) * 0.45 + focusBonus);
  const governmentId = world.governments.find((item) => item.countryId === observerCountryId)?.id ?? `government-${observerCountryId}`;
  const observation = publish(world, [governmentId], "intelligence-estimate", metricId, targetCountryId, trueValue, Math.max(0, world.clock.elapsedMonths - 1), "ESTIMATED", adjustment);
  return getBelief(world, governmentId, metricId, targetCountryId)! ?? updateBelief(world, governmentId, observation);
}

export function getBelief(world: WorldState, agentId: string, metricId: string, subjectId: string): BeliefMetric | null {
  return beliefIndex(world).get(beliefKey(agentId, metricId, subjectId)) ?? null;
}

export function beliefValue(world: WorldState, agentId: string, metricId: string, subjectId: string, fallback: number): number {
  return getBelief(world, agentId, metricId, subjectId)?.observedValue ?? getBelief(world, PUBLIC_INFORMATION_AGENT, metricId, subjectId)?.observedValue ?? fallback;
}

export function strategicEstimate(world: WorldState, observerCountryId: string, targetCountryId: string, metricId: "readiness-bps" | "stockpile-minor"): BeliefMetric | null {
  const governmentId = world.governments.find((item) => item.countryId === observerCountryId)?.id ?? `government-${observerCountryId}`;
  return getBelief(world, governmentId, metricId, targetCountryId);
}

export function observedBorrowerCashFlow(world: WorldState, bankId: string, borrowerId: string, fallback: number): { value: number; confidenceBps: number; status: InformationStatus } {
  const relationship = world.loans.some((item) => item.lenderBankId === bankId && item.borrowerId === borrowerId);
  const privateBelief = getBelief(world, bankId, "operating-cash-flow", borrowerId);
  if (privateBelief) return { value: privateBelief.observedValue, confidenceBps: privateBelief.confidenceBps, status: privateBelief.status };
  const publicBelief = getBelief(world, PUBLIC_INFORMATION_AGENT, "operating-cash-flow", borrowerId);
  if (!relationship && publicBelief) return { value: publicBelief.observedValue, confidenceBps: publicBelief.confidenceBps, status: publicBelief.status };
  const company = world.companies.find((item) => item.id === borrowerId);
  const report = company?.financialReports.at(-1);
  const base = report?.operatingCashFlowCents ?? fallback;
  if (!relationship && !report) {
    const estimate = Math.round(base * (1 + hashUnit(world.seed, bankId, borrowerId, world.clock.elapsedMonths) * 0.12));
    return { value: estimate, confidenceBps: 4_000, status: "ESTIMATED" };
  }
  const sourceId = relationship ? "bank-internal" : "company-report";
  const observation = publish(world, [bankId], sourceId, "operating-cash-flow", borrowerId, base, Math.max(0, world.clock.elapsedMonths - (relationship ? 0 : 3)), relationship ? "INTERNAL" : "PUBLIC", relationship ? 300 : -500);
  return { value: observation.observedValue, confidenceBps: observation.confidenceBps, status: observation.status };
}

export function conductDueDiligence(world: WorldState, buyerId: string, targetCompanyId: string): { riskBps: number; confidenceBps: number; finding: string; observationIds: string[] } {
  const target = world.companies.find((item) => item.id === targetCompanyId);
  if (!target) return { riskBps: 10_000, confidenceBps: 0, finding: "Цель недоступна", observationIds: [] };
  const hiddenDebt = world.loans.filter((item) => item.borrowerId === target.id && item.status === "active").reduce((sum, item) => sum + item.remainingPrincipalCents, 0);
  const cashFlow = target.financialReports.at(-1)?.operatingCashFlowCents ?? target.lastGrossRevenueCents - target.lastOperatingExpenseCents;
  const scale = Math.max(1, Math.abs(target.lastGrossRevenueCents));
  const trueRiskBps = clamp(hiddenDebt * 4_000 / scale + Math.max(0, -cashFlow) * 6_000 / scale);
  const source: InformationSource = { id: `diligence:${buyerId}:${targetCompanyId}`, type: "COMPANY_INTERNAL_DATA", ownerId: targetCompanyId, delayMonths: 0, accuracyBps: 9_200, biasBps: 0, reliabilityBps: 9_000, costMinor: 0, scope: [targetCompanyId], access: "DILIGENCE" };
  world.information.sources = world.information.sources.filter((item) => item.id !== source.id); world.information.sources.push(source);
  const observation = publish(world, [buyerId], source.id, "diligence-risk-bps", targetCompanyId, trueRiskBps, world.clock.elapsedMonths, "INTERNAL");
  const prior = getBelief(world, buyerId, "diligence-risk-bps", targetCompanyId)?.priorValue;
  const finding = prior != null && observation.observedValue > prior * 1.15 ? "Риск выше ожиданий" : observation.observedValue > 5_500 ? "Обнаружен существенный риск" : observation.observedValue < 2_000 ? "Состояние лучше ожиданий" : "Оценка подтверждена";
  return { riskBps: observation.observedValue, confidenceBps: observation.confidenceBps, finding, observationIds: [observation.id] };
}

export function recordDecisionTrace(world: WorldState, agentId: string, decisionType: string, subjectId: string, beliefs: BeliefMetric[], decision: string): string {
  const id = `trace-${world.information.nextTraceId++}`;
  world.information.decisionTraces.push({ id, agentId, decisionType, subjectId, elapsedMonth: world.clock.elapsedMonths, observedInputIds: beliefs.map((item) => item.id), beliefValues: Object.fromEntries(beliefs.map((item) => [item.metricId, item.observedValue])), confidenceBps: beliefs.length ? Math.round(beliefs.reduce((sum, item) => sum + item.confidenceBps, 0) / beliefs.length) : 0, decision, realizedResult: null, realizedAtMonth: null });
  return id;
}

export function realizeDecisionTrace(world: WorldState, traceId: string, result: number): void {
  const trace = world.information.decisionTraces.find((item) => item.id === traceId);
  if (!trace) return;
  trace.realizedResult = result; trace.realizedAtMonth = world.clock.elapsedMonths;
}
