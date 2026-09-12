import test from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/economy/create-world.ts";
import { runMonths } from "../src/economy/simulation.ts";
import { requiredPersonnelCost, runDefenseEconomyMonth } from "../src/defense-economy/engine.ts";
import { activateConflict, mobilizeConflict, proposeConflict, runConflictPostEconomy, runConflictPreEconomy } from "../src/conflict/engine.ts";
import { evaluateEconomicPolicyAccess } from "../src/geoeconomics/access.ts";
import { runGeoeconomicMonth } from "../src/geoeconomics/engine.ts";
import { refreshPoliticalEconomyAccounts } from "../src/political-economy/engine.ts";
import { migrateWorldState } from "../src/persistence/migrations.ts";

test("maintenance имеет устойчивое состояние, а недофинансирование ухудшает состояние", () => {
  const funded = createWorld("baseline", { mode: "REAL_WORLD" });
  const state = funded.defenseEconomy.countries.find((item) => item.countryId === "us")!;
  const before = state.equipmentConditionBps;
  for (let month = 0; month < 60; month++) runDefenseEconomyMonth(funded);
  assert.ok(state.equipmentConditionBps > 2_500);
  assert.ok(state.readinessBps > 2_500);
  const underfunded = createWorld("baseline", { mode: "REAL_WORLD" });
  const weak = underfunded.defenseEconomy.countries.find((item) => item.countryId === "us")!;
  weak.targetSpendingToGdpBps = 1;
  for (let month = 0; month < 24; month++) runDefenseEconomyMonth(underfunded);
  assert.ok(weak.equipmentConditionBps < before);
});

test("военный payroll зависит от численности", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const state = world.defenseEconomy.countries.find((item) => item.countryId === "de")!;
  const base = requiredPersonnelCost(world, state);
  state.activePersonnel *= 2;
  const doubled = requiredPersonnelCost(world, state);
  assert.ok(doubled > base * 1.7);
});

test("мобилизация переносит труд и капитал из гражданской экономики", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const conflict = proposeConflict(world, "us", "ru", "limited-political")!;
  assert.ok(activateConflict(world, conflict.id));
  const employed = world.populationCohorts.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.employedCount, 0);
  const civilianCapital = world.firmCohorts.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.capitalCents, 0);
  const militaryCapacity = world.defenseEconomy.industries.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.capacityMinor, 0);
  assert.ok(mobilizeConflict(world, conflict.id, "us", 50_000, 500));
  assert.ok(world.populationCohorts.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.employedCount, 0) < employed);
  assert.ok(world.firmCohorts.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.capitalCents, 0) < civilianCapital);
  assert.ok(world.defenseEconomy.industries.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.capacityMinor, 0) > militaryCapacity);
});

test("потери уменьшают личный состав, население и труд", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const conflict = proposeConflict(world, "us", "ru", "coerce")!;
  activateConflict(world, conflict.id);
  const population = world.populationCohorts.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.populationCount, 0);
  const personnel = world.defenseEconomy.countries.find((item) => item.countryId === "us")!.activePersonnel;
  runConflictPostEconomy(world);
  assert.ok(world.defenseEconomy.countries.find((item) => item.countryId === "us")!.activePersonnel < personnel);
  assert.ok(world.populationCohorts.filter((item) => item.countryId === "us").reduce((sum, item) => sum + item.populationCount, 0) < population);
});

test("asset freeze жёстко запрещает передачу, не меняя ownership", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  world.geoeconomics.policies.push({ id: "freeze", actorCountryId: "us", targetCountryIds: ["ru"], kind: "asset-freeze", commodityIds: [], rateBps: 0, accessPenaltyBps: 1, startsAtMonth: 0, endsAtMonth: null, status: "active", retaliationOfId: null, transactionIds: [] });
  const holdingCount = world.equityHoldings.length;
  const access = evaluateEconomicPolicyAccess(world, { sourceCountryId: "ru", destinationCountryId: "us", kind: "asset" });
  assert.equal(access.allowed, false);
  assert.equal(world.equityHoldings.length, holdingCount);
});

test("SOE mandate существует только при подтверждённом государственном контроле", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const forbidden = world.companies.filter((item) => /Apple|Toyota|ASML|Samsung/i.test(item.name)).map((item) => item.id);
  assert.equal(world.geoeconomics.soeMandates.some((item) => forbidden.includes(item.companyId)), false);
  assert.equal(world.geoeconomics.soeMandates.every((mandate) => {
    const security = world.equitySecurities.find((item) => item.companyId === mandate.companyId)!;
    const governments = new Set(world.governments.map((item) => item.id));
    const shares = world.equityHoldings.filter((item) => item.securityId === security.id && governments.has(item.ownerId)).reduce((sum, item) => sum + item.shares, 0);
    return shares * 10_000 / security.sharesOutstanding >= 5_001;
  }), true);
});

test("обычный цикл способен автономно провести предложение, одобрение, мобилизацию и активацию", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  for (let index = 0; index < 3; index++) world.geoeconomics.policies.push({ id: `strategic-friction-${index}`, actorCountryId: index % 2 ? "ru" : "us", targetCountryIds: [index % 2 ? "us" : "ru"], kind: "sanction", commodityIds: [], rateBps: 1_000, accessPenaltyBps: 8_000, startsAtMonth: 0, endsAtMonth: null, status: "active", retaliationOfId: null, transactionIds: [] });
  runMonths(world, 10);
  const conflict = world.conflicts.conflicts.find((item) => item.participantCountryIds.includes("us") && item.participantCountryIds.includes("ru"));
  assert.ok(conflict);
  assert.ok(["mobilizing", "active", "ceasefire", "negotiation", "settled"].includes(conflict.status));
  assert.ok((conflict.mobilizationByCountry.us ?? 0) > 0 || (conflict.mobilizationByCountry.ru ?? 0) > 0);
});

test("мирный контроль не создаёт случайную войну", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  runMonths(world, 12);
  assert.equal(world.conflicts.conflicts.some((item) => ["active", "mobilizing", "ceasefire", "negotiation"].includes(item.status)), false);
});

test("ущерб маршрута не ретроактивен и применяется до следующей торговли", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const conflict = proposeConflict(world, "us", "ru", "coerce")!;
  activateConflict(world, conflict.id);
  const route = world.tradeRoutes.find((item) => item.originCountryId === "us")!;
  route.usedCapacityMilliUnits = route.capacityMilliUnits;
  runConflictPostEconomy(world);
  assert.equal(route.usedCapacityMilliUnits <= route.capacityMilliUnits, true);
  runConflictPreEconomy(world);
  assert.equal(route.usedCapacityMilliUnits <= route.capacityMilliUnits, true);
  assert.ok((route.reconstructionBacklogMinor ?? 0) > 0);
});

test("НИОКР накапливается и лишь затем повышает технологию домена", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const state = world.defenseEconomy.countries.find((item) => item.countryId === "us")!;
  const domain = state.domainStates![0];
  const before = domain.technologyBps;
  const gdp = world.countryScaleReconciliations.find((item) => item.countryId === "us")!.targetMonthlyNominalGdpMinor;
  state.researchProgressMinor = gdp * 2 - 1;
  runDefenseEconomyMonth(world);
  assert.ok(state.researchSpendingMinor > 0);
  assert.ok(domain.technologyBps > before);
});

test("атакованный союзник проходит реальную оценку и получает поддержку", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const conflict = proposeConflict(world, "ru", "de", "coerce")!;
  activateConflict(world, conflict.id);
  conflict.monthsInStatus = 1;
  runConflictPostEconomy(world);
  assert.ok(world.defenseEconomy.aidTransfers.some((item) => item.recipientCountryId === "de"));
  assert.ok(conflict.causeCodes.some((item) => item.startsWith("alliance-aid:")));
});

test("ceasefire переходит в переговоры и settlement", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  const conflict = proposeConflict(world, "us", "ru", "coerce")!;
  activateConflict(world, conflict.id);
  for (let month = 0; month < 75 && conflict.status !== "settled"; month++) { runConflictPreEconomy(world); runConflictPostEconomy(world); world.clock.elapsedMonths += 1; }
  assert.equal(conflict.status, "settled");
});

test("автономная геоэкономика инициирует ограничение при сильном стимуле", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  world.clock.elapsedMonths = 12;
  world.geoeconomics.directionalDependencies = [{ sourceCountryId: "us", targetCountryId: "ru", tradeDependencyBps: 7_000, importDependencyBps: 7_000, financeDependencyBps: 500, strategicDependencyBps: 5_000, updatedAtMonth: 12 }];
  runGeoeconomicMonth(world);
  assert.ok(world.geoeconomics.policies.some((item) => item.actorCountryId === "us" && item.targetCountryIds.includes("ru")));
  assert.ok(world.geoeconomics.decisionTraces.some((item) => item.decision.startsWith("initial-")));
});

test("теневой сектор создаёт ресурсные output/income/consumption flows", () => {
  const world = createWorld("baseline", { mode: "REAL_WORLD" });
  runMonths(world, 3);
  refreshPoliticalEconomyAccounts(world);
  const shadow = world.politicalEconomy.shadowEconomy.find((item) => item.countryId === "ru" && item.elapsedMonth === world.clock.elapsedMonths)!;
  assert.ok(shadow.intermediateInputsMinor! > 0);
  assert.equal(shadow.informalWagesMinor! + shadow.undeclaredProfitMinor!, shadow.hiddenOutputMinor);
  assert.ok(shadow.informalConsumptionMinor! > shadow.hiddenOutputMinor);
  assert.equal(shadow.transactionIds?.length, 1);
});

test("миграция ограниченно восстанавливает readiness и удаляет fake SOE metadata", () => {
  const legacy = structuredClone(createWorld("baseline", { mode: "REAL_WORLD" }));
  const defense = legacy.defenseEconomy.countries.find((item) => item.countryId === "de")!;
  defense.readinessBps = 0;
  const company = legacy.companies.find((item) => item.headquartersCountryId === "de")!;
  legacy.geoeconomics.soeMandates.push({ companyId: company.id, countryId: "de", stateOwnershipBps: 5_100, mandate: "technology", softBudgetConstraintBps: 4_000 });
  const migrated = migrateWorldState(legacy);
  const reconciled = migrated.defenseEconomy.countries.find((item) => item.countryId === "de")!;
  assert.ok(reconciled.readinessBps >= 1_500 && reconciled.readinessBps < 9_000);
  assert.equal(migrated.geoeconomics.soeMandates.some((item) => item.companyId === company.id), false);
});
