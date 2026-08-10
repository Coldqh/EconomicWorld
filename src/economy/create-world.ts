import { emitSimpleEvent, recordGoodsMovement } from "../core/events.ts";
import {
  createLedger,
  seedBankCapital,
  seedDeposit,
} from "../core/ledger.ts";
import type {
  Bank,
  Company,
  GoodDefinition,
  Household,
  WorldState,
} from "../domain/model.ts";

const GOODS: GoodDefinition[] = [
  {
    id: "food",
    name: "Продовольствие",
    shortName: "Еда",
    unit: "корзина",
    basePriceCents: 78_000,
    consumptionWeightBps: 3_100,
    recipe: { energy: 0.08 },
  },
  {
    id: "energy",
    name: "Энергия",
    shortName: "Энергия",
    unit: "МВт·ч",
    basePriceCents: 46_000,
    consumptionWeightBps: 1_600,
    recipe: { services: 0.03 },
  },
  {
    id: "materials",
    name: "Базовые материалы",
    shortName: "Материалы",
    unit: "партия",
    basePriceCents: 165_000,
    consumptionWeightBps: 700,
    recipe: { energy: 0.14 },
  },
  {
    id: "goods",
    name: "Потребительские товары",
    shortName: "Товары",
    unit: "единица",
    basePriceCents: 465_000,
    consumptionWeightBps: 2_650,
    recipe: { materials: 0.22, energy: 0.06 },
  },
  {
    id: "services",
    name: "Услуги",
    shortName: "Услуги",
    unit: "час",
    basePriceCents: 225_000,
    consumptionWeightBps: 1_950,
    recipe: {},
  },
];

const COMPANY_BLUEPRINTS = [
  ["Северные поля", "food", 10_050, 35_500_00, 78_500, 500_000],
  ["Городская ферма", "food", 9_250, 34_000_00, 75_800, 450_000],
  ["ЭнергоСеть", "energy", 10_600, 42_000_00, 47_200, 550_000],
  ["Вольт", "energy", 9_550, 39_500_00, 44_800, 480_000],
  ["Сплав", "materials", 10_200, 38_500_00, 167_000, 250_000],
  ["Базальт", "materials", 6_350, 49_000_00, 148_000, 210_000],
  ["Маяк", "goods", 10_400, 41_500_00, 472_000, 155_000],
  ["ДомТех", "goods", 9_200, 38_500_00, 452_000, 145_000],
  ["Вектор", "services", 10_700, 43_000_00, 228_000, 230_000],
  ["Практика", "services", 9_000, 37_500_00, 214_000, 205_000],
] as const;

const FIRST_NAMES = [
  "Алексей", "Мария", "Илья", "Анна", "Максим", "Елена", "Никита", "София", "Даниил", "Ольга",
];
const LAST_NAMES = [
  "Волковы", "Соколовы", "Орловы", "Лебедевы", "Морозовы", "Кузнецовы", "Романовы", "Павловы", "Новиковы", "Беловы",
];

function createHouseholds(): Household[] {
  return Array.from({ length: 100 }, (_, index) => {
    const id = `household-${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      displayName: `${FIRST_NAMES[index % FIRST_NAMES.length]} — ${LAST_NAMES[Math.floor(index / 10)]}`,
      bankId: index % 2 === 0 ? "bank-north" : "bank-civic",
      employerId: null,
      skillBps: 7_200 + ((index * 379) % 5_400),
      productivityBps: 7_800 + ((index * 173) % 4_600),
      consumptionPropensityBps: 8_300 + ((index * 211) % 1_400),
      priceSensitivityBps: 7_500 + ((index * 97) % 3_000),
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
    return {
      id: `company-${String(index + 1).padStart(3, "0")}`,
      name,
      goodId,
      ownerHouseholdId: `household-${String(index + 1).padStart(3, "0")}`,
      bankId: index % 2 === 0 ? "bank-north" : "bank-civic",
      active: true,
      employees: [],
      wageCents,
      priceCents,
      capacityMilliUnits,
      productivityBps,
      inventoryMilliUnits: Math.floor(capacityMilliUnits * (0.8 + (index % 3) * 0.2)),
      inputInventoryMilliUnits: Object.fromEntries(GOODS.map((good) => [good.id, 0])),
      lastProductionMilliUnits: 0,
      lastSalesMilliUnits: 0,
      lastGrossRevenueCents: 0,
      lastOperatingExpenseCents: 0,
      distressMonths: 0,
      missedPayrollMonths: 0,
      foundedAtMonth: 0,
      closedAtMonth: null,
      closureReason: null,
    };
  });
}

function assignInitialEmployment(world: WorldState): void {
  const candidates = [...world.households].sort(
    (a, b) => b.productivityBps + b.skillBps - (a.productivityBps + a.skillBps),
  );
  const targetEmployment = 82;
  for (let index = 0; index < targetEmployment; index += 1) {
    const household = candidates[index];
    const company = world.companies[index % world.companies.length];
    household.employerId = company.id;
    company.employees.push(household.id);
  }
}

export function createWorld(): WorldState {
  const banks: Bank[] = [
    { id: "bank-north", name: "Северный банк", baseSpreadBps: 260, minimumCapitalRatioBps: 900 },
    { id: "bank-civic", name: "Городской банк", baseSpreadBps: 310, minimumCapitalRatioBps: 950 },
  ];
  const households = createHouseholds();
  const companies = createCompanies();
  const world: WorldState = {
    schemaVersion: 1,
    seed: "heterogeneity-v1",
    clock: { startYear: 2026, startMonth: 1, elapsedMonths: 0 },
    ledger: createLedger(),
    goods: structuredClone(GOODS),
    goodsMovements: [],
    households,
    companies,
    banks,
    government: {
      id: "government",
      incomeTaxBps: 1_200,
      salesTaxBps: 800,
      corporateTaxBps: 1_800,
      monthlyUnemploymentBenefitCents: 12_500_00,
    },
    centralBank: {
      id: "central-bank",
      name: "Центральный банк",
      policyRateBps: 700,
      inflationTargetBps: 400,
    },
    loans: [],
    events: [],
    metricsHistory: [],
    nextEventId: 1,
    nextGoodsMovementId: 1,
    nextLoanId: 1,
    nextCompanyId: 11,
  };

  for (const bank of banks) seedBankCapital(world, bank.id, 20_000_000_00);
  households.forEach((household, index) => {
    const initialDeposit = 85_000_00 + ((index * 1_937_00) % 130_000_00);
    seedDeposit(world, household.id, household.bankId, initialDeposit);
  });
  companies.forEach((company, index) => {
    seedDeposit(world, company.id, company.bankId, 5_500_000_00 + index * 270_000_00);
    recordGoodsMovement(world, {
      goodId: company.goodId,
      fromId: "genesis",
      toId: company.id,
      quantityMilliUnits: company.inventoryMilliUnits,
      reason: "GENESIS",
      causeIds: [],
    });
    const good = world.goods.find((item) => item.id === company.goodId)!;
    for (const inputId of Object.keys(good.recipe)) {
      company.inputInventoryMilliUnits[inputId] = 35_000 + (index % 4) * 8_000;
      recordGoodsMovement(world, {
        goodId: inputId,
        fromId: "genesis",
        toId: company.id,
        quantityMilliUnits: company.inputInventoryMilliUnits[inputId],
        reason: "GENESIS",
        causeIds: [],
      });
    }
  });
  seedDeposit(world, world.government.id, world.banks[0].id, 45_000_000_00);
  assignInitialEmployment(world);
  emitSimpleEvent(
    world,
    "WorldCreated",
    "Экономика запущена",
    "100 домохозяйств, 10 компаний и две банковские книги начали автономную работу.",
    [world.government.id, world.centralBank.id],
    "positive",
  );
  return world;
}
