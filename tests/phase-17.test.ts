import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideCompanyMonth } from "../src/company/decision-engine.ts";
import { conflictDecisionScore } from "../src/conflict/engine.ts";
import type { BeliefMetric } from "../src/domain/model.ts";
import { createWorld } from "../src/economy/create-world.ts";
import { issueLoan } from "../src/finance/credit.ts";
import { conductDueDiligence, getBelief, runInformationMonth, strategicEstimate } from "../src/information/system.ts";
import { marketInformationSignal } from "../src/markets/agents/engine.ts";
import { migrateWorldState } from "../src/persistence/migrations.ts";
import { FEATURE_UNLOCKS, MAX_PLAYER_LEVEL, awardExperience, changeReputation, featureAccess, isFeatureActionable, isFeatureVisible, reputationTier, syncPlayerProgression } from "../src/player/progression.ts";

function belief(agentId: string, metricId: string, subjectId: string, value: number, confidenceBps = 6_000): BeliefMetric {
  return { id: `belief:${agentId}:${metricId}:${subjectId}`, agentId, metricId, subjectId, observedValue: value, confidence: confidenceBps >= 7_500 ? "HIGH" : confidenceBps >= 4_500 ? "MEDIUM" : "LOW", confidenceBps, observationMonth: 0, releaseMonth: 2, informationAge: 2, sourceIds: ["public-statistics"], qualityBps: confidenceBps, status: "PUBLIC", lowerBound: Math.round(value * 0.85), upperBound: Math.round(value * 1.15), revisionOfId: null, priorValue: null, updatedAtMonth: 2 };
}

test("публичная статистика выпускается с задержкой и без trueValue", () => {
  const world = createWorld();
  world.clock.elapsedMonths = 1; runInformationMonth(world);
  assert.equal(world.information.observations.some((item) => item.metricId === "gdp-growth-bps"), false);
  world.clock.elapsedMonths = 2; world.information.lastReleaseMonth = -1; runInformationMonth(world);
  const observation = world.information.observations.find((item) => item.metricId === "gdp-growth-bps");
  assert.ok(observation); assert.ok(observation.releaseMonth - observation.observationMonth >= 2);
  assert.equal("trueValue" in observation, false);
});

test("годовой пересмотр ссылается на исходный релиз", () => {
  const world = createWorld();
  world.clock.elapsedMonths = 2; runInformationMonth(world);
  world.clock.elapsedMonths = 24; world.information.lastReleaseMonth = -1; runInformationMonth(world);
  assert.ok(world.information.observations.some((item) => item.revisionOfId));
});

test("убеждения разрежены и confidence учитывает качество", () => {
  const world = createWorld(); world.clock.elapsedMonths = 3; runInformationMonth(world);
  assert.ok(world.information.beliefs.length < 2_000);
  assert.ok(world.information.beliefs.every((item) => item.confidenceBps >= 0 && item.confidenceBps <= 10_000));
  assert.ok(world.information.beliefs.every((item) => item.lowerBound <= item.observedValue && item.upperBound >= item.observedValue));
});

test("компания меняет прогноз по наблюдаемому сигналу, а не по истинной макрооценке", () => {
  const weak = createWorld(); const strong = structuredClone(weak);
  const companyWeak = weak.companies[0]; const companyStrong = strong.companies[0];
  companyWeak.lastSalesMilliUnits = 100_000; companyStrong.lastSalesMilliUnits = 100_000;
  weak.information.beliefs.push(belief(companyWeak.id, "gdp-growth-bps", companyWeak.headquartersCountryId, -2_000));
  strong.information.beliefs.push(belief(companyStrong.id, "gdp-growth-bps", companyStrong.headquartersCountryId, 3_000));
  const low = decideCompanyMonth(weak, companyWeak).expectedDemandMilliUnits;
  const high = decideCompanyMonth(strong, companyStrong).expectedDemandMilliUnits;
  assert.ok(high > low);
});

test("банк использует доступную оценку денежного потока заёмщика", () => {
  const world = createWorld(); const company = world.companies[0];
  world.information.beliefs.push(belief(company.bankId, "operating-cash-flow", company.id, -1_000_000, 8_500));
  assert.equal(issueLoan(world, company.bankId, company.id, 100_000, 12, 100), null);
  assert.ok(world.information.decisionTraces.some((item) => item.decisionType === "CREDIT_REJECTION"));
});

test("стратегическое решение сохраняется при изменении скрытой истинной готовности", () => {
  const world = createWorld(); world.clock.elapsedMonths = 1; runInformationMonth(world);
  const before = conflictDecisionScore(world, "ru", "us").scoreBps;
  world.defenseEconomy.countries.find((item) => item.countryId === "us")!.readinessBps = 10_000;
  const after = conflictDecisionScore(world, "ru", "us").scoreBps;
  assert.equal(after, before);
});

test("разведывательная способность улучшает оценку, контрразведка снижает качество", () => {
  const capable = createWorld(); capable.clock.elapsedMonths = 1; runInformationMonth(capable);
  const base = strategicEstimate(capable, "ru", "us", "readiness-bps")!.confidenceBps;
  const ru = capable.information.intelligence.find((item) => item.countryId === "ru")!; ru.collectionBps = 9_800; ru.analysisBps = 9_800; ru.militaryIntelligenceBps = 9_800;
  capable.clock.elapsedMonths = 2; capable.information.lastReleaseMonth = -1; runInformationMonth(capable);
  const improved = strategicEstimate(capable, "ru", "us", "readiness-bps")!.confidenceBps;
  const us = capable.information.intelligence.find((item) => item.countryId === "us")!; us.counterintelligenceBps = 10_000; us.opacityBps = 10_000;
  capable.clock.elapsedMonths = 3; capable.information.lastReleaseMonth = -1; runInformationMonth(capable);
  const obstructed = strategicEstimate(capable, "ru", "us", "readiness-bps")!.confidenceBps;
  assert.ok(improved >= base); assert.ok(obstructed < improved);
});

test("due diligence уменьшает неопределённость и фиксирует реальную находку", () => {
  const world = createWorld(); const buyer = world.companies[0]; const target = world.companies[1];
  const result = conductDueDiligence(world, buyer.id, target.id);
  assert.ok(result.confidenceBps >= 8_000); assert.equal(result.observationIds.length, 1);
  assert.ok(getBelief(world, buyer.id, "diligence-risk-bps", target.id));
});

test("одни данные дают разные фундаментальные сигналы разным моделям", () => {
  const world = createWorld(); const listing = world.listings[0]; const company = world.companies.find((item) => item.id === listing.companyId)!;
  company.financialReports.push({ elapsedMonth: 0, quarter: 1, year: 2026, revenueCents: 5_000_000, cogsCents: 1_000_000, grossProfitCents: 4_000_000, wagesCents: 500_000, interestCents: 0, taxesCents: 0, depreciationCents: 0, inventoryCents: 0, operatingCashFlowCents: 1_500_000, investingCashFlowCents: 0, financingCashFlowCents: 0, netIncomeCents: 1_000_000, assetsCents: 8_000_000, liabilitiesCents: 2_000_000, equityCents: 6_000_000, productiveCapitalCents: 4_000_000 });
  const a = marketInformationSignal(world, "fund-model-a", listing.securityId, "fundamental");
  const b = marketInformationSignal(world, "fund-model-z", listing.securityId, "fundamental");
  assert.notEqual(a, b); assert.equal(Math.sign(a), Math.sign(b));
});

test("50 уровней, ранние открытия и защита от фарма", () => {
  const world = createWorld(); assert.equal(MAX_PLAYER_LEVEL, 50);
  assert.ok(FEATURE_UNLOCKS.every((item) => item.minimumLevel >= 1 && item.minimumLevel <= 50));
  const grants = Array.from({ length: 10 }, () => awardExperience(world, "trivial-click", 100, "Повтор")).reduce((sum, item) => sum + item, 0);
  assert.equal(grants, 150); assert.ok(world.player.experience.level < 5);
});

test("уровень переживает банкротство, дефолт портит репутацию, рыночный убыток — нет", () => {
  const world = createWorld(); world.player.experience.level = 42; const beforeRep = world.player.reputation.score;
  const account = world.bankAccounts.find((item) => item.ownerId === world.player.householdId)!;
  world.loans.push({ id: "player-default", lenderBankId: account.bankId, borrowerId: world.player.householdId, currencyId: account.currencyId, settlementBankAccountId: account.id, originalPrincipalCents: 100_000, remainingPrincipalCents: 100_000, annualRateBps: 1_000, remainingMonths: 1, missedPayments: 3, status: "defaulted", issuedAtMonth: 0 });
  syncPlayerProgression(world); assert.equal(world.player.experience.level, 42); assert.ok(world.player.reputation.score < beforeRep);
  const afterDefault = world.player.reputation.score; world.equityHoldings.filter((item) => item.ownerId === world.player.householdId).forEach((item) => { item.costBasisCents = 0; }); syncPlayerProgression(world);
  assert.equal(world.player.reputation.score, afterDefault); assert.equal(reputationTier(world.player.reputation.score), "НЕИЗВЕСТНАЯ");
});

test("полный интерфейс ничего не выдаёт и не обходит actionability", () => {
  const world = createWorld(); const snapshot = { level: world.player.experience.level, xp: world.player.experience.lifetimeXp, rep: world.player.reputation.score, balances: structuredClone(world.ledger.balances) };
  world.player.interfacePreferences.fullInterface = true;
  assert.equal(isFeatureVisible(world, "control"), true); assert.equal(featureAccess(world, "corporate-transactions"), "UNDISCOVERED");
  assert.equal(isFeatureActionable(world, "corporate-transactions"), false);
  assert.deepEqual({ level: world.player.experience.level, xp: world.player.experience.lifetimeXp, rep: world.player.reputation.score, balances: world.ledger.balances }, snapshot);
});

test("уровень 1 получает компактную навигацию, а закрытая M&A не actionable", () => {
  const world = createWorld(); const visible = FEATURE_UNLOCKS.filter((item) => isFeatureVisible(world, item.featureId) && item.uiGroup !== "SYSTEM");
  assert.ok(visible.filter((item) => featureAccess(world, item.featureId) === "ACTIONABLE").length >= 4);
  assert.ok(visible.filter((item) => featureAccess(world, item.featureId) === "ACTIONABLE").length <= 6);
  assert.notEqual(featureAccess(world, "corporate-transactions"), "ACTIONABLE");
});

test("миграция v15 сохраняет экономику и добавляет PHASE 17", () => {
  const world = createWorld(); const cash = structuredClone(world.ledger.balances); const raw = structuredClone(world) as unknown as Record<string, unknown>; raw.schemaVersion = 15; raw.saveVersion = 15; delete raw.information;
  const player = raw.player as Record<string, unknown>; delete player.experience; delete player.reputation; delete player.interfacePreferences;
  const migrated = migrateWorldState(raw); assert.equal(migrated.schemaVersion, 16); assert.deepEqual(migrated.ledger.balances, cash); assert.equal(migrated.player.experience.level >= 1, true); assert.ok(migrated.information.sources.length);
});

test("неполное сохранение текущей схемы не обнуляет значения шаблона", () => {
  const raw = structuredClone(createWorld()) as unknown as Record<string, unknown>;
  raw.equitySecurities = null;
  const migrated = migrateWorldState(raw);
  assert.ok(Array.isArray(migrated.equitySecurities));
  assert.ok(migrated.equitySecurities.length > 0);
});

test("ключевая конфликтная функция не читает истинную готовность противника", () => {
  const source = readFileSync(new URL("../src/conflict/engine.ts", import.meta.url), "utf8");
  const decision = source.slice(source.indexOf("export function conflictDecisionScore"), source.indexOf("export function proposeConflict"));
  assert.equal(/enemy\.readinessBps|capability\(world, defenderCountryId\)/.test(decision), false);
});

test("репутация едина и ограничена диапазоном", () => {
  const world = createWorld(); changeReputation(world, 5_000, "Надёжность", "Тест"); assert.equal(world.player.reputation.score, 1_000);
  changeReputation(world, -9_000, "Дефолт", "Тест"); assert.equal(world.player.reputation.score, -1_000);
  assert.equal("bankReputation" in world.player, false);
});

test("репутация меняет цену кредита, но не нормативы банка", () => {
  const trusted = createWorld();
  const risky = createWorld();
  const prepare = (world: ReturnType<typeof createWorld>, reputation: number) => {
    const company = world.companies[0];
    company.ownerHouseholdId = world.player.householdId;
    company.lastGrossRevenueCents = 10_000_000;
    company.lastOperatingExpenseCents = 1_000_000;
    world.player.reputation.score = reputation;
    return { world, company };
  };
  const good = prepare(trusted, 1_000);
  const bad = prepare(risky, -1_000);
  const trustedLoan = issueLoan(good.world, good.company.bankId, good.company.id, 10_000, 12, 100);
  const riskyLoan = issueLoan(bad.world, bad.company.bankId, bad.company.id, 10_000, 12, 100);
  assert.ok(trustedLoan && riskyLoan);
  assert.equal(riskyLoan.originalPrincipalCents, trustedLoan.originalPrincipalCents);
  assert.equal(riskyLoan.annualRateBps - trustedLoan.annualRateBps, 240);
});

test("PLAYER PROGRESSION E2E: крах не стирает опыт, после него доступен новый путь", () => {
  const world = createWorld(); world.player.experience.level = 16;
  const levelBefore = world.player.experience.level;
  world.households.find((item) => item.id === world.player.householdId)!.employerId = null;
  for (const account of world.bankAccounts.filter((item) => item.ownerId === world.player.householdId)) world.ledger.balances[account.ledgerDepositAccountId] = 0;
  syncPlayerProgression(world);
  assert.ok(world.player.experience.level >= levelBefore);
  const comebackXp = awardExperience(world, "comeback-career", 600, "Возвращение к работе после финансового краха");
  assert.ok(comebackXp > 0); assert.ok(world.player.experience.unlockedFeatures.includes("companies"));
});

test("INFORMATION E2E: запаздывающий сигнал меняет решение и создаёт surprise", () => {
  const world = createWorld(); const company = world.companies[0]; company.lastSalesMilliUnits = 100_000;
  const macro = world.countryMacroStates.find((item) => item.countryId === company.headquartersCountryId)!;
  macro.outputGapBps = 3_000; world.clock.elapsedMonths = 2; runInformationMonth(world);
  const optimistic = decideCompanyMonth(world, company).expectedDemandMilliUnits;
  macro.outputGapBps = -3_000; world.clock.elapsedMonths = 3; world.information.lastReleaseMonth = -1; runInformationMonth(world);
  const revised = decideCompanyMonth(world, company).expectedDemandMilliUnits;
  assert.ok(revised < optimistic); assert.ok(world.information.surprises.some((item) => item.metricId === "gdp-growth-bps"));
});
