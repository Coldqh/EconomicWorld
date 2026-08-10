import { emitSimpleEvent, recordGoodsMovement } from "../core/events.ts";
import {
  accountIds,
  createLedger,
  seedBankCapital,
  seedDeposit,
  seedNonCashAsset,
} from "../core/ledger.ts";
import { emptyAccountingPeriod } from "../accounting/national-accounts.ts";
import type {
  Bank,
  Company,
  GoodDefinition,
  Household,
  Occupation,
  Person,
  SimulationScenario,
  SkillId,
  WorldState,
} from "../domain/model.ts";

export const GOODS: GoodDefinition[] = [
  { id: "food", name: "Продовольствие", shortName: "Еда", unit: "корзина", basePriceCents: 78_000, consumptionWeightBps: 3_100, essential: true, recipe: { energy: 0.08 } },
  { id: "energy", name: "Энергия", shortName: "Энергия", unit: "МВт·ч", basePriceCents: 46_000, consumptionWeightBps: 1_600, essential: true, recipe: { services: 0.03 } },
  { id: "materials", name: "Базовые материалы", shortName: "Материалы", unit: "партия", basePriceCents: 165_000, consumptionWeightBps: 700, essential: false, recipe: { energy: 0.14 } },
  { id: "goods", name: "Потребительские товары", shortName: "Товары", unit: "единица", basePriceCents: 465_000, consumptionWeightBps: 2_650, essential: false, recipe: { materials: 0.22, energy: 0.06 } },
  { id: "services", name: "Услуги", shortName: "Услуги", unit: "час", basePriceCents: 225_000, consumptionWeightBps: 1_950, essential: false, recipe: {} },
];

const COMPANY_BLUEPRINTS = [
  ["Северные поля", "food", 10_050, 35_500_00, 78_500, 500_000],
  ["Городская ферма", "food", 9_250, 34_000_00, 75_800, 450_000],
  ["ЭнергоСеть", "energy", 10_600, 42_000_00, 47_200, 550_000],
  ["Вольт", "energy", 9_550, 39_500_00, 44_800, 480_000],
  ["Сплав", "materials", 10_200, 38_500_00, 167_000, 250_000],
  ["Базальт", "materials", 9_350, 39_000_00, 158_000, 210_000],
  ["Маяк", "goods", 10_400, 41_500_00, 472_000, 155_000],
  ["ДомТех", "goods", 9_200, 38_500_00, 452_000, 145_000],
  ["Вектор", "services", 10_700, 43_000_00, 228_000, 230_000],
  ["Практика", "services", 9_000, 37_500_00, 214_000, 205_000],
] as const;

const FIRST_NAMES = ["Алексей", "Мария", "Илья", "Анна", "Максим", "Елена", "Никита", "София", "Даниил", "Ольга"];
const LAST_NAMES = ["Волковы", "Соколовы", "Орловы", "Лебедевы", "Морозовы", "Кузнецовы", "Романовы", "Павловы", "Новиковы", "Беловы"];
const SKILLS: SkillId[] = ["economics", "accounting", "finance", "statistics", "programming", "dataAnalysis", "communication", "management"];

function createPeople(): Person[] {
  return Array.from({ length: 100 }, (_, index) => ({
    id: index === 0 ? "person-player" : `person-${String(index + 1).padStart(3, "0")}`,
    householdId: `household-${String(index + 1).padStart(3, "0")}`,
    displayName: index === 0 ? "Игрок" : `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / 10)].slice(0, -1)}`,
    ageAtStart: 19 + ((index * 7) % 39),
    educationLevel: index % 7 === 0 ? "bachelor" : index % 3 === 0 ? "secondary" : "basic",
    skills: Object.fromEntries(SKILLS.map((skill, skillIndex) => [skill, 600 + ((index * 173 + skillIndex * 271) % 2_500)])) as Record<SkillId, number>,
    practicalExperience: Object.fromEntries(SKILLS.map((skill, skillIndex) => [skill, (index * 91 + skillIndex * 41) % 1_500])) as Record<SkillId, number>,
    reputationBps: 4_500 + ((index * 59) % 2_500),
    occupationId: null,
  }));
}

function createHouseholds(people: Person[]): Household[] {
  return Array.from({ length: 100 }, (_, index) => {
    const id = `household-${String(index + 1).padStart(3, "0")}`;
    const weights = Object.fromEntries(GOODS.map((good) => [good.id, Math.max(350, good.consumptionWeightBps + ((index * 53 + good.id.length * 89) % 500) - 250)]));
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    return {
      id,
      displayName: index === 0 ? "Игрок" : `${FIRST_NAMES[index % FIRST_NAMES.length]} — ${LAST_NAMES[Math.floor(index / 10)]}`,
      personIds: [people[index].id],
      bankId: index % 2 === 0 ? "bank-north" : "bank-civic",
      employerId: null,
      skillBps: 7_200 + ((index * 379) % 5_400),
      productivityBps: 7_800 + ((index * 173) % 4_600),
      consumptionPropensityBps: 7_600 + ((index * 211) % 1_600),
      savingsPreferenceBps: 1_800 + ((index * 113) % 1_500),
      liquidityPreferenceBps: 1_200 + ((index * 71) % 1_700),
      essentialBudgetBps: 4_400 + ((index * 37) % 1_200),
      priceSensitivityBps: 7_500 + ((index * 97) % 3_000),
      preferenceWeightsBps: Object.fromEntries(Object.entries(weights).map(([goodId, value]) => [goodId, Math.round((value * 10_000) / total)])),
      preferredSellerByGoodId: {},
      reservationWageCents: 25_000_00 + ((index * 137_00) % 14_000_00),
      monthsUnemployed: 0,
      expectedInflationBps: 400,
      consumptionMilliUnits: Object.fromEntries(GOODS.map((good) => [good.id, 0])),
      foundedCompanyIds: [],
    };
  });
}

function createCompanies(): Company[] {
  return COMPANY_BLUEPRINTS.map((blueprint, index) => {
    const [name, goodId, productivityBps, wageCents, priceCents, capacityMilliUnits] = blueprint;
    const inventoryMilliUnits = Math.floor(capacityMilliUnits * (0.45 + (index % 3) * 0.08));
    const good = GOODS.find((item) => item.id === goodId)!;
    return {
      id: `company-${String(index + 1).padStart(3, "0")}`, name, goodId,
      ownerHouseholdId: `household-${String(index + 1).padStart(3, "0")}`,
      bankId: index % 2 === 0 ? "bank-north" : "bank-civic", active: true, employees: [], wageCents, priceCents,
      capacityMilliUnits, productivityBps, inventoryMilliUnits,
      inventoryValueCents: Math.round((inventoryMilliUnits * good.basePriceCents * 0.66) / 1_000),
      inputInventoryMilliUnits: Object.fromEntries(GOODS.map((item) => [item.id, 0])),
      inputInventoryValueCents: Object.fromEntries(GOODS.map((item) => [item.id, 0])),
      productiveCapital: { acquisitionCostCents: 8_000_000_00 + index * 350_000_00, bookValueCents: 8_000_000_00 + index * 350_000_00, accumulatedDepreciationCents: 0, usefulLifeMonths: 240, capacityMilliUnits },
      retainedEarningsCents: 0, financialReports: [],
      lastProductionMilliUnits: 0, lastSalesMilliUnits: 0, lastGrossRevenueCents: 0, lastOperatingExpenseCents: 0,
      lastCogsCents: 0, lastIntermediateConsumptionCents: 0, lastIntermediateConsumptionBaseCents: 0, lastWagesCents: 0,
      lastDepreciationCents: 0, lastInterestCents: 0, lastTaxCents: 0, lastCapitalInvestmentCents: 0,
      lastHouseholdSalesCents: 0, lastGovernmentSalesCents: 0,
      distressMonths: 0, missedPayrollMonths: 0, foundedAtMonth: 0, closedAtMonth: null, closureReason: null,
    };
  });
}

export const OCCUPATIONS: Occupation[] = [
  { id: "worker", name: "Специалист производства", level: 1, requiredSkills: { communication: 500 }, productivityMultiplierBps: 9_500, minimumExperienceMonths: 0, nextOccupationIds: ["manager"] },
  { id: "admin", name: "Администратор", level: 1, requiredSkills: { communication: 800, accounting: 500 }, productivityMultiplierBps: 9_800, minimumExperienceMonths: 0, nextOccupationIds: ["analyst", "manager"] },
  { id: "analyst", name: "Экономический аналитик", level: 2, requiredSkills: { economics: 1_000, statistics: 900, dataAnalysis: 750 }, productivityMultiplierBps: 10_800, minimumExperienceMonths: 6, nextOccupationIds: ["manager"] },
  { id: "developer", name: "Разработчик", level: 2, requiredSkills: { programming: 1_100, dataAnalysis: 650 }, productivityMultiplierBps: 11_200, minimumExperienceMonths: 6, nextOccupationIds: ["manager"] },
  { id: "manager", name: "Руководитель", level: 3, requiredSkills: { management: 1_500, communication: 1_400, finance: 900 }, productivityMultiplierBps: 11_800, minimumExperienceMonths: 24, nextOccupationIds: [] },
];

function assignInitialEmployment(world: WorldState): void {
  const candidates = world.households.filter((item) => item.id !== world.player.householdId).sort((a, b) => b.productivityBps + b.skillBps - (a.productivityBps + a.skillBps));
  for (let index = 0; index < 82; index += 1) {
    const household = candidates[index];
    const company = world.companies[index % world.companies.length];
    household.employerId = company.id;
    company.employees.push(household.id);
  }
}

export function createWorld(scenario: SimulationScenario = "baseline"): WorldState {
  const banks: Bank[] = [
    { id: "bank-north", name: "Северный банк", baseSpreadBps: 260, minimumCapitalRatioBps: 900, minimumLiquidityRatioBps: 1_200 },
    { id: "bank-civic", name: "Городской банк", baseSpreadBps: 310, minimumCapitalRatioBps: 950, minimumLiquidityRatioBps: 1_250 },
  ];
  const people = createPeople();
  const households = createHouseholds(people);
  const companies = createCompanies();
  if (scenario === "supply-constraint") companies.forEach((company) => { company.capacityMilliUnits = Math.round(company.capacityMilliUnits * 0.72); company.productiveCapital.capacityMilliUnits = company.capacityMilliUnits; });
  if (scenario === "high-demand") households.forEach((household) => { household.consumptionPropensityBps = Math.min(9_800, household.consumptionPropensityBps + 900); });
  const policyRateBps = scenario === "high-rates" ? 1_600 : 700;
  const world: WorldState = {
    schemaVersion: 2, saveVersion: 2, seed: "economic-world-v2", scenario,
    clock: { startYear: 2026, startMonth: 1, elapsedMonths: 0 }, ledger: createLedger(), goods: structuredClone(GOODS), goodsMovements: [], people, households, companies, banks,
    government: { id: "government", incomeTaxBps: 1_200, salesTaxBps: 800, corporateTaxBps: 1_800, monthlyUnemploymentBenefitCents: 12_500_00 },
    centralBank: { id: "central-bank", name: "Центральный банк", policyRateBps, inflationTargetBps: 400, policyRateHistory: [{ elapsedMonth: 0, rateBps: policyRateBps }] },
    loans: [], bankFunding: [],
    nationalAccounts: { baseYear: 2026, cpiWeightsBps: Object.fromEntries(GOODS.map((good) => [good.id, good.consumptionWeightBps])), current: emptyAccountingPeriod({ goods: GOODS }) },
    occupations: structuredClone(OCCUPATIONS),
    player: { personId: "person-player", householdId: "household-001", profileId: "student", automaticBasicSpending: true, consumptionBudgetBps: 7_500, savingsTargetBps: 2_500, pendingJobOffer: null, activeEnrollment: null, completedCourseIds: [], completedLessonIds: [], monthlyHistory: [], timeline: [], commandLog: [], nextCommandId: 1, nextTimelineId: 1 },
    events: [], metricsHistory: [], nextEventId: 1, nextGoodsMovementId: 1, nextLoanId: 1, nextFundingId: 1, nextCompanyId: 11,
  };

  for (const bank of banks) seedBankCapital(world, bank.id, scenario === "bank-liquidity-stress" ? 8_000_000_00 : 20_000_000_00);
  households.forEach((household, index) => seedDeposit(world, household.id, household.bankId, index === 0 ? 120_000_00 : 85_000_00 + ((index * 1_937_00) % 130_000_00)));
  companies.forEach((company, index) => {
    seedDeposit(world, company.id, company.bankId, 5_500_000_00 + index * 270_000_00);
    seedNonCashAsset(world, company.id, accountIds.finishedInventory(company.id), "Готовая продукция", company.inventoryValueCents);
    seedNonCashAsset(world, company.id, accountIds.productiveCapital(company.id), "Производственный капитал", company.productiveCapital.bookValueCents);
    recordGoodsMovement(world, { goodId: company.goodId, fromId: "genesis", toId: company.id, quantityMilliUnits: company.inventoryMilliUnits, reason: "GENESIS", causeIds: [] });
    const recipe = world.goods.find((item) => item.id === company.goodId)!.recipe;
    for (const inputId of Object.keys(recipe)) {
      const quantity = 35_000 + (index % 4) * 8_000;
      const inputGood = world.goods.find((item) => item.id === inputId)!;
      const value = Math.round((quantity * inputGood.basePriceCents * 0.7) / 1_000);
      company.inputInventoryMilliUnits[inputId] = quantity;
      company.inputInventoryValueCents[inputId] = value;
      seedNonCashAsset(world, company.id, accountIds.inputInventory(company.id, inputId), `Сырьё: ${inputGood.name}`, value);
      recordGoodsMovement(world, { goodId: inputId, fromId: "genesis", toId: company.id, quantityMilliUnits: quantity, reason: "GENESIS", causeIds: [] });
    }
  });
  seedDeposit(world, world.government.id, world.banks[0].id, 45_000_000_00);
  seedDeposit(world, "academy-provider", world.banks[0].id, 1);
  assignInitialEmployment(world);
  emitSimpleEvent(world, "WorldCreated", "Экономика запущена", "100 домохозяйств · 10 компаний · 2 банка", [world.government.id, world.centralBank.id], "positive");
  return world;
}
