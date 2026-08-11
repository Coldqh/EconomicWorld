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
  Broker,
  CentralBank,
  Company,
  CorporateBoard,
  EquityHolding,
  EquitySecurity,
  Exchange,
  GoodDefinition,
  Government,
  Household,
  Listing,
  MarketIndex,
  Occupation,
  Person,
  SimulationScenario,
  SkillId,
  WorldState,
} from "../domain/model.ts";
import { COUNTRY_ECONOMY_PACKS } from "../data/country-economies.ts";
import { CURRENCIES, MONETARY_AREAS, createFxPairs } from "../finance/currencies.ts";
import { seedInstitutionalFinance } from "../finance/institutional.ts";
import { seedLeverageFinance } from "../finance/leverage.ts";
import { seedClearingHouses } from "../finance/clearing.ts";
import { seedDerivativeMarkets } from "../finance/derivatives.ts";
import { seedMacroeconomics } from "./macroeconomics.ts";
import { createFirmCohorts, createPopulationCohorts } from "../world/cohorts.ts";
import { createCities, createCountries, createHousingCohorts, createProducts, createUniversities } from "../world/catalog.ts";
import { updateWorldDiagnostics } from "../world/systems.ts";

export const GOODS: GoodDefinition[] = [
  { id: "food", name: "Продовольствие", shortName: "Еда", unit: "корзина", basePriceCents: 78_000, consumptionWeightBps: 3_100, essential: true, recipe: { energy: 0.08 } },
  { id: "energy", name: "Энергия", shortName: "Энергия", unit: "МВт·ч", basePriceCents: 46_000, consumptionWeightBps: 1_600, essential: true, recipe: { services: 0.03 } },
  { id: "materials", name: "Базовые материалы", shortName: "Материалы", unit: "партия", basePriceCents: 165_000, consumptionWeightBps: 700, essential: false, recipe: { energy: 0.14 } },
  { id: "goods", name: "Потребительские товары", shortName: "Товары", unit: "единица", basePriceCents: 465_000, consumptionWeightBps: 2_650, essential: false, recipe: { materials: 0.22, energy: 0.06 } },
  { id: "services", name: "Услуги", shortName: "Услуги", unit: "час", basePriceCents: 225_000, consumptionWeightBps: 1_950, essential: false, recipe: {} },
];

const FIRST_NAMES = ["Алексей", "Мария", "Илья", "Анна", "Максим", "Елена", "Никита", "София", "Даниил", "Ольга"];
const LAST_NAMES = ["Волковы", "Соколовы", "Орловы", "Лебедевы", "Морозовы", "Кузнецовы", "Романовы", "Павловы", "Новиковы", "Беловы"];
const SKILLS: SkillId[] = ["economics", "accounting", "finance", "statistics", "programming", "dataAnalysis", "communication", "management"];

function createPeople(cityIds: readonly string[]): Person[] {
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
    cityId: index === 0 ? "moscow" : cityIds[index % cityIds.length],
    fidelityTier: index === 0 ? 2 : 1,
    sourceCohortId: null,
    important: index === 0,
  }));
}

function createHouseholds(people: Person[], banks: readonly Bank[]): Household[] {
  return Array.from({ length: 100 }, (_, index) => {
    const id = `household-${String(index + 1).padStart(3, "0")}`;
    const weights = Object.fromEntries(GOODS.map((good) => [good.id, Math.max(350, good.consumptionWeightBps + ((index * 53 + good.id.length * 89) % 500) - 250)]));
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    return {
      id,
      displayName: index === 0 ? "Игрок" : `${FIRST_NAMES[index % FIRST_NAMES.length]} — ${LAST_NAMES[Math.floor(index / 10)]}`,
      personIds: [people[index].id],
      bankId: banks.find((bank) => bank.countryId === COUNTRY_ECONOMY_PACKS.find((pack) => pack.companies.some((company) => company.cityId === people[index].cityId))?.countryId)?.id ?? banks[0].id,
      primaryBankAccountId: "",
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
      cityId: people[index].cityId,
      utilityPreferencesBps: {
        food: 2_400, housing: 2_200, energy: 900, transport: 900, services: 1_000,
        goods: 900, education: 600, entertainment: 750, luxury: 350,
      },
      lastDisposableIncomeCents: 0,
      lastSpendingByCategoryCents: {
        food: 0, housing: 0, energy: 0, transport: 0, services: 0,
        goods: 0, education: 0, entertainment: 0, luxury: 0,
      },
    };
  });
}

function createCompanies(): Company[] {
  return COUNTRY_ECONOMY_PACKS.flatMap((pack) => pack.companies.map((blueprint, localIndex) => ({ pack, blueprint, localIndex }))).map(({ pack, blueprint, localIndex }, index) => {
    const { name, goodId } = blueprint;
    const productivityBps = 9_100 + (index % 9) * 210;
    const wageCents = 32_000_00 + (index % 8) * 175_000;
    const good = GOODS.find((item) => item.id === goodId)!;
    const priceCents = Math.round(good.basePriceCents * (0.93 + (index % 5) * 0.035));
    const capacityMilliUnits = 190_000 + (index % 7) * 47_000;
    const inventoryMilliUnits = Math.floor(capacityMilliUnits * (0.45 + (index % 3) * 0.08));
    const companyId = `company-${String(index + 1).padStart(3, "0")}`;
    return {
      id: companyId, name, goodId,
      ownerHouseholdId: `household-${String(index + 1).padStart(3, "0")}`,
      bankId: pack.banks[localIndex % pack.banks.length].id, active: true, employees: [], wageCents, priceCents,
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
      cityId: blueprint.cityId,
      productId: `product-${goodId}-${index + 1}`,
      technologyBps: 8_200 + index * 170,
      managementBps: 7_700 + (index % 4) * 350,
      learningByDoingBps: 0,
      qualityBps: 7_300 + (index % 5) * 420,
      brandReputationBps: 5_800 + index * 270,
      marketShareBps: 5_000,
      marginalCostCents: Math.round(priceCents * 0.72),
      capacityUtilizationBps: 0,
      occupationFamilyNeeds: { production: 5, engineering: 2, management: 1, sales: 2 },
      headquartersCountryId: pack.countryId,
      headquartersCityId: blueprint.cityId,
      industry: blueprint.industry,
      representationTier: blueprint.representationTier,
      sizeClass: blueprint.sizeClass,
      corporateStatus: blueprint.listed ? "public" : "private",
      equitySecurityId: `security-${companyId}`,
      boardId: `board-${companyId}`,
      parentCompanyId: null,
      subsidiaryIds: [],
      goodwillCents: 0,
    };
  });
}

function createInstitutions(policyRateBps: number): {
  banks: Bank[];
  governments: Government[];
  centralBanks: CentralBank[];
  exchanges: Exchange[];
  brokers: Broker[];
} {
  const centralBanks: CentralBank[] = COUNTRY_ECONOMY_PACKS.map((pack) => ({
    id: `central-bank-${pack.countryId}`,
    name: pack.centralBankName,
    countryId: pack.countryId,
    currencyId: pack.currencyId,
    monetaryAreaId: `money-area-${pack.currencyId.toLowerCase()}`,
    setsPolicyRate: pack.currencyId !== "EUR",
    policyRateBps: policyRateBps + (pack.countryId.charCodeAt(0) % 5) * 35,
    inflationTargetBps: 400,
    policyRateHistory: [{ elapsedMonth: 0, rateBps: policyRateBps }],
  }));
  centralBanks.push({
    id: "monetary-authority-eur",
    name: "Европейский центральный банк",
    countryId: "eu",
    currencyId: "EUR",
    monetaryAreaId: "money-area-eur",
    setsPolicyRate: true,
    policyRateBps,
    inflationTargetBps: 200,
    policyRateHistory: [{ elapsedMonth: 0, rateBps: policyRateBps }],
  });
  const banks: Bank[] = COUNTRY_ECONOMY_PACKS.flatMap((pack) => pack.banks.map((bank) => ({
    id: bank.id,
    name: bank.name,
    baseSpreadBps: bank.spreadBps,
    minimumCapitalRatioBps: bank.capitalRatioBps,
    minimumLiquidityRatioBps: bank.liquidityRatioBps,
    countryId: pack.countryId,
    baseCurrency: pack.currencyId,
    centralBankId: pack.currencyId === "EUR" ? "monetary-authority-eur" : `central-bank-${pack.countryId}`,
    representationTier: "A" as const,
  })));
  const governments: Government[] = COUNTRY_ECONOMY_PACKS.map((pack, index) => ({
    id: `government-${pack.countryId}`,
    countryId: pack.countryId,
    currencyId: pack.currencyId,
    incomeTaxBps: 1_050 + (index % 5) * 95,
    salesTaxBps: 700 + (index % 4) * 75,
    corporateTaxBps: 1_550 + (index % 5) * 90,
    monthlyUnemploymentBenefitCents: 10_500_00 + (index % 4) * 125_000,
  }));
  const exchanges: Exchange[] = COUNTRY_ECONOMY_PACKS.map((pack) => ({
    id: `exchange-${pack.countryId}`,
    name: pack.exchangeName,
    shortName: pack.exchangeShortName,
    countryId: pack.countryId,
    currencyId: pack.currencyId,
    bankId: pack.banks[0].id,
    listedSecurityIds: [],
    brokerFeeBps: 18,
    exchangeFeeBps: 4,
  }));
  const brokers: Broker[] = COUNTRY_ECONOMY_PACKS.map((pack) => ({
    id: `broker-${pack.countryId}`,
    name: pack.brokerName,
    countryId: pack.countryId,
    bankId: pack.banks[0].id,
    exchangeIds: [`exchange-${pack.countryId}`],
    supportedCurrencyIds: [pack.currencyId],
    marginAvailable: true,
  }));
  return { banks, governments, centralBanks, exchanges, brokers };
}

function createOwnershipAndMarkets(companies: readonly Company[], exchanges: Exchange[]): {
  equitySecurities: EquitySecurity[];
  equityHoldings: EquityHolding[];
  corporateBoards: CorporateBoard[];
  listings: Listing[];
  marketIndices: MarketIndex[];
} {
  const equitySecurities: EquitySecurity[] = companies.map((company) => ({
    id: company.equitySecurityId,
    companyId: company.id,
    className: "Обыкновенные акции",
    currencyId: COUNTRY_ECONOMY_PACKS.find((pack) => pack.countryId === company.headquartersCountryId)!.currencyId,
    sharesOutstanding: 100_000,
    votesPerShare: 1,
    status: company.corporateStatus === "public" ? "listed" : "private",
  }));
  let holdingSequence = 1;
  const equityHoldings: EquityHolding[] = companies.flatMap((company) => {
    if (company.corporateStatus !== "public") return [{
      id: `holding-${holdingSequence++}`, securityId: company.equitySecurityId, ownerId: company.ownerHouseholdId,
      shares: 100_000, costBasisCents: 100_000_000, dividendsReceivedCents: 0,
    }];
    return [
      { id: `holding-${holdingSequence++}`, securityId: company.equitySecurityId, ownerId: company.ownerHouseholdId, shares: 80_000, costBasisCents: 80_000_000, dividendsReceivedCents: 0 },
      { id: `holding-${holdingSequence++}`, securityId: company.equitySecurityId, ownerId: `population-${company.headquartersCityId}-1`, shares: 20_000, costBasisCents: 20_000_000, dividendsReceivedCents: 0 },
    ];
  });
  const corporateBoards: CorporateBoard[] = companies.map((company) => ({
    id: company.boardId,
    companyId: company.id,
    directorOwnerIds: [company.ownerHouseholdId],
    approvalThresholdBps: 5_001,
  }));
  const listingCountByCountry: Record<string, number> = {};
  const listings: Listing[] = companies.filter((company) => company.corporateStatus === "public").map((company) => {
    const exchange = exchanges.find((item) => item.countryId === company.headquartersCountryId)!;
    const localIndex = (listingCountByCountry[company.headquartersCountryId] ?? 0) + 1;
    listingCountByCountry[company.headquartersCountryId] = localIndex;
    exchange.listedSecurityIds.push(company.equitySecurityId);
    return {
      id: `listing-${company.headquartersCountryId}-${String(localIndex).padStart(2, "0")}`,
      exchangeId: exchange.id,
      companyId: company.id,
      securityId: company.equitySecurityId,
      ticker: `${company.headquartersCountryId.toUpperCase()}${String(localIndex).padStart(2, "0")}`,
      currencyId: exchange.currencyId,
      listedAtMonth: 0,
      lastPriceCents: 1_000,
      previousCloseCents: 1_000,
    };
  });
  const marketIndices: MarketIndex[] = exchanges.map((exchange) => ({
    id: `index-${exchange.countryId}`,
    name: `${exchange.shortName} Композит`,
    exchangeId: exchange.id,
    constituentSecurityIds: [...exchange.listedSecurityIds],
    methodology: "market-cap",
    levelBps: 100_000,
    history: [{ elapsedMonth: 0, levelBps: 100_000 }],
  }));
  return { equitySecurities, equityHoldings, corporateBoards, listings, marketIndices };
}

export const OCCUPATIONS: Occupation[] = [
  { id: "worker", name: "Специалист производства", level: 1, requiredSkills: { communication: 500 }, productivityMultiplierBps: 9_500, minimumExperienceMonths: 0, nextOccupationIds: ["manager"], family: "production" },
  { id: "admin", name: "Администратор", level: 1, requiredSkills: { communication: 800, accounting: 500 }, productivityMultiplierBps: 9_800, minimumExperienceMonths: 0, nextOccupationIds: ["analyst", "manager"], family: "services" },
  { id: "analyst", name: "Экономический аналитик", level: 2, requiredSkills: { economics: 1_000, statistics: 900, dataAnalysis: 750 }, productivityMultiplierBps: 10_800, minimumExperienceMonths: 6, nextOccupationIds: ["manager"], family: "finance" },
  { id: "developer", name: "Разработчик", level: 2, requiredSkills: { programming: 1_100, dataAnalysis: 650 }, productivityMultiplierBps: 11_200, minimumExperienceMonths: 6, nextOccupationIds: ["manager"], family: "software" },
  { id: "manager", name: "Руководитель", level: 3, requiredSkills: { management: 1_500, communication: 1_400, finance: 900 }, productivityMultiplierBps: 11_800, minimumExperienceMonths: 24, nextOccupationIds: [], family: "management" },
  { id: "investment-analyst", name: "Инвестиционный аналитик", level: 2, requiredSkills: { finance: 1_250, accounting: 950, dataAnalysis: 900 }, productivityMultiplierBps: 11_000, minimumExperienceMonths: 6, nextOccupationIds: ["portfolio-manager", "fund-manager"], family: "finance" },
  { id: "risk-analyst", name: "Риск-аналитик", level: 2, requiredSkills: { finance: 1_150, statistics: 1_150, dataAnalysis: 850 }, productivityMultiplierBps: 10_900, minimumExperienceMonths: 6, nextOccupationIds: ["portfolio-manager"], family: "finance" },
  { id: "investment-banker", name: "Инвестиционный банкир", level: 3, requiredSkills: { finance: 1_650, accounting: 1_250, communication: 1_350 }, productivityMultiplierBps: 12_000, minimumExperienceMonths: 18, nextOccupationIds: ["fund-manager"], family: "finance" },
  { id: "portfolio-manager", name: "Управляющий портфелем", level: 3, requiredSkills: { finance: 1_750, statistics: 1_300, management: 1_100 }, productivityMultiplierBps: 12_200, minimumExperienceMonths: 24, nextOccupationIds: ["fund-manager"], family: "finance" },
  { id: "fund-manager", name: "Управляющий фондом", level: 4, requiredSkills: { finance: 2_100, management: 1_700, communication: 1_400 }, productivityMultiplierBps: 12_800, minimumExperienceMonths: 48, nextOccupationIds: [], family: "finance" },
];

function assignInitialEmployment(world: WorldState): void {
  const candidates = world.households.filter((item) => item.id !== world.player.householdId).sort((a, b) => b.productivityBps + b.skillBps - (a.productivityBps + a.skillBps));
  for (let index = 0; index < 82; index += 1) {
    const household = candidates[index];
    const countryId = world.cities.find((city) => city.id === household.cityId)?.countryId;
    const localCompanies = world.companies.filter((company) => company.headquartersCountryId === countryId);
    const company = localCompanies[index % Math.max(1, localCompanies.length)] ?? world.companies[index % world.companies.length];
    household.employerId = company.id;
    household.cityId = company.cityId;
    household.bankId = company.bankId;
    const person = world.people.find((item) => item.householdId === household.id);
    if (person) person.cityId = company.cityId;
    company.employees.push(household.id);
  }
}

export function createWorld(scenario: SimulationScenario = "baseline"): WorldState {
  const policyRateBps = scenario === "high-rates" ? 1_600 : 700;
  const { banks, governments, centralBanks, exchanges, brokers } = createInstitutions(policyRateBps);
  const cities = createCities(GOODS);
  const people = createPeople(cities.map((city) => city.id));
  const households = createHouseholds(people, banks);
  const companies = createCompanies();
  if (scenario === "supply-constraint") companies.forEach((company) => { company.capacityMilliUnits = Math.round(company.capacityMilliUnits * 0.72); company.productiveCapital.capacityMilliUnits = company.capacityMilliUnits; });
  if (scenario === "high-demand") households.forEach((household) => { household.consumptionPropensityBps = Math.min(9_800, household.consumptionPropensityBps + 900); });
  const countries = createCountries();
  const { universities, programs: universityPrograms } = createUniversities(banks.map((bank) => bank.id));
  const housingCohorts = createHousingCohorts(cities);
  const populationCohorts = createPopulationCohorts(cities, banks.map((bank) => bank.id));
  const firmCohorts = createFirmCohorts(cities, banks.map((bank) => bank.id));
  const localBankId = (countryId: string, offset = 0) => {
    const options = banks.filter((bank) => bank.countryId === countryId);
    return options[offset % options.length].id;
  };
  for (const university of universities) {
    const city = cities.find((item) => item.id === university.cityId)!;
    university.bankId = localBankId(city.countryId, universities.indexOf(university));
  }
  for (const cohort of populationCohorts) cohort.bankId = localBankId(cohort.countryId, populationCohorts.indexOf(cohort));
  for (const cohort of firmCohorts) cohort.bankId = localBankId(cohort.countryId, firmCohorts.indexOf(cohort));
  for (const country of countries) {
    country.companyIds = companies.filter((company) => company.headquartersCountryId === country.id).map((company) => company.id);
    country.bankIds = banks.filter((bank) => bank.countryId === country.id).map((bank) => bank.id);
    country.universityIds = universities.filter((university) => cities.find((city) => city.id === university.cityId)?.countryId === country.id).map((university) => university.id);
  }
  const ownership = createOwnershipAndMarkets(companies, exchanges);
  for (const company of companies) {
    const founder = households.find((household) => household.id === company.ownerHouseholdId);
    if (founder) {
      founder.cityId = company.cityId;
      founder.bankId = company.bankId;
      const person = people.find((item) => item.householdId === founder.id);
      if (person) person.cityId = company.cityId;
    }
  }
  const world: WorldState = {
    schemaVersion: 6, saveVersion: 6, seed: "economic-world-v6", scenario,
    clock: { startYear: 2026, startMonth: 1, elapsedMonths: 0 }, ledger: createLedger(), goods: structuredClone(GOODS), goodsMovements: [], people, households, companies, banks,
    government: governments.find((item) => item.countryId === "ru")!,
    centralBank: centralBanks.find((item) => item.countryId === "ru")!,
    governments,
    centralBanks,
    currencies: structuredClone(CURRENCIES),
    monetaryAreas: structuredClone(MONETARY_AREAS),
    bankAccounts: [],
    loans: [], bankFunding: [],
    nationalAccounts: { baseYear: 2026, cpiWeightsBps: Object.fromEntries(GOODS.map((good) => [good.id, good.consumptionWeightBps])), current: emptyAccountingPeriod({ goods: GOODS }) },
    occupations: structuredClone(OCCUPATIONS),
    player: { personId: "person-player", householdId: "household-001", profileId: "student", automaticBasicSpending: false, consumptionBudgetBps: 7_500, savingsTargetBps: 2_500, pendingJobOffer: null, jobApplications: [], activeEnrollment: null, completedCourseIds: [], completedLessonIds: [], monthlyHistory: [], timeline: [], commandLog: [], nextCommandId: 1, nextTimelineId: 1, currentCityId: "moscow", residencePropertyId: null, activeTravel: null, universityApplications: [], activeUniversityEnrollment: null, completedProgramIds: [], educationHistory: [], visitedCityIds: ["moscow"], visitedCountryIds: ["ru"], residenceHistory: [{ cityId: "moscow", fromMonth: 0, toMonth: null }], durableAssetIds: [], propertyIds: [], brokerageAccountIds: [], bankAccountIds: [], reportingCurrencyId: "RUB", foodPlanId: "basic" },
    events: [], metricsHistory: [], countryMetricsHistory: [], nextEventId: 1, nextGoodsMovementId: 1, nextLoanId: 1, nextFundingId: 1, nextCompanyId: companies.length + 1,
    countries, cities, universities, universityPrograms, housingCohorts, properties: [], products: createProducts(), durableAssets: [], populationCohorts, firmCohorts,
    fidelity: { tierByEntityId: Object.fromEntries(people.map((person) => [person.id, person.fidelityTier])), relevanceByEntityId: { "person-player": 10_000 }, materializedPersonIds: [], budgets: { maxNamedPersons: 500, maxActivePersons: 200, maxFullCompanies: 120, maxActiveProperties: 300 }, activeCityIds: ["moscow"] },
    ledgerArchives: [],
    diagnostics: { populationRepresented: 0, businessesRepresented: 0, highFidelityPersons: 0, materializedPersons: 0, explicitFirms: 0, firmCohorts: 0, materializedProperties: 0, housingUnitsRepresented: 0, ledgerHotTransactions: 0, ledgerArchivedTransactions: 0, estimatedSaveBytes: 0, deterministicWorkUnits: 0 },
    nextMaterializedPersonId: 1, nextPropertyId: 1, nextDurableAssetId: 1, nextApplicationId: 1,
    equitySecurities: ownership.equitySecurities,
    equityHoldings: ownership.equityHoldings,
    corporateBonds: [], bondHoldings: [], corporateBoards: ownership.corporateBoards, corporateActions: [], acquisitions: [],
    exchanges, listings: ownership.listings, brokers, brokerageAccounts: [], marketOrders: [], archivedMarketOrders: [], marketTrades: [], ohlcvBars: [], marketIndices: ownership.marketIndices,
    fxPairs: createFxPairs(), fxOrders: [], fxTrades: [], fxDealers: [],
    assetManagers: [], funds: [], fundUnitHoldings: [], investmentBankMandates: [],
    marginAccounts: [], marginCalls: [], collateralPledges: [], securitiesLoans: [], shortPositions: [], repoAgreements: [], primeBrokerExposures: [],
    derivativeContracts: [], optionMarketSeries: [], nettingSets: [], clearingHouses: [], clearingMemberAccounts: [], clearedPositions: [], derivativeMarginCalls: [], derivativeExposureHistory: [],
    sovereignBonds: [], sovereignBondHoldings: [], sovereignAuctions: [], yieldCurveHistory: [], governmentBudgets: [], centralBankBalanceSheets: [], monetaryPolicyDecisions: [], depositInsuranceSchemes: [], countryMacroStates: [], macroHistory: [],
    nextSecurityId: companies.length + 1, nextHoldingId: ownership.equityHoldings.length + 1, nextBondId: 1, nextCorporateActionId: 1,
    nextAcquisitionId: 1, nextBrokerageAccountId: 1, nextOrderId: 1, nextTradeId: 1, nextOrderSequence: 1,
    nextBankAccountId: 1, nextFxOrderId: 1, nextFxTradeId: 1, nextFundUnitHoldingId: 1,
    nextMarginAccountId: 1, nextMarginCallId: 1, nextCollateralId: 1, nextSecuritiesLoanId: 1,
    nextShortPositionId: 1, nextRepoId: 1,
    nextDerivativeId: 1, nextDerivativeMarginCallId: 1, nextNettingSetId: 1, nextClearingPositionId: 1,
    nextSovereignBondId: 1, nextSovereignHoldingId: 1, nextSovereignAuctionId: 1, nextMonetaryDecisionId: 1,
  };

  for (const bank of banks) seedBankCapital(world, bank.id, scenario === "bank-liquidity-stress" ? 8_000_000_00 : 20_000_000_00);
  const dealer = { id: "fx-dealer-global", name: "Global FX Liquidity", bankAccountIds: [] as string[], targetInventoryByCurrency: {} as Record<string, number>, spreadBps: 20 };
  world.fxDealers.push(dealer);
  for (const currency of world.currencies) {
    const bank = world.banks.find((item) => item.baseCurrency === currency.id)!;
    seedDeposit(world, dealer.id, bank.id, 50_000_000_00);
    const account = world.bankAccounts.find((item) => item.ownerId === dealer.id && item.bankId === bank.id && item.currencyId === currency.id)!;
    dealer.bankAccountIds.push(account.id);
    dealer.targetInventoryByCurrency[currency.id] = 50_000_000_00;
  }
  households.forEach((household, index) => seedDeposit(world, household.id, household.bankId, index === 0 ? 850_000_00 : 85_000_00 + ((index * 1_937_00) % 130_000_00)));
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
  for (const holding of world.equityHoldings) {
    seedNonCashAsset(world, holding.ownerId, accountIds.security(holding.ownerId, holding.securityId), `Акции ${holding.securityId}`, holding.costBasisCents);
  }
  for (const broker of world.brokers) seedDeposit(world, broker.id, broker.bankId, 1);
  for (const exchange of world.exchanges) seedDeposit(world, exchange.id, exchange.bankId, 1);
  for (const government of world.governments) seedDeposit(world, government.id, localBankId(government.countryId), 45_000_000_00);
  seedDeposit(world, "academy-provider", world.banks[0].id, 1);
  for (const cohort of world.populationCohorts) seedDeposit(world, cohort.id, cohort.bankId, Math.max(20_000_000, cohort.averageMonthlyIncomeCents * 12));
  for (const cohort of world.firmCohorts) seedDeposit(world, cohort.id, cohort.bankId, Math.max(50_000_000, cohort.revenueCents * 24));
  for (const university of world.universities) seedDeposit(world, university.id, university.bankId, 100_000_000);
  for (const city of world.cities) {
    const bankId = localBankId(city.countryId, world.cities.indexOf(city));
    seedDeposit(world, `housing-sector:${city.id}`, bankId, 100_000_000);
    seedDeposit(world, `transport-sector:${city.id}`, bankId, 30_000_000);
  }
  assignInitialEmployment(world);
  seedInstitutionalFinance(world);
  seedLeverageFinance(world);
  seedMacroeconomics(world);
  seedClearingHouses(world);
  seedDerivativeMarkets(world);
  updateWorldDiagnostics(world);
  emitSimpleEvent(world, "WorldCreated", "Экономика запущена", `${world.diagnostics.populationRepresented.toLocaleString("ru-RU")} жителей · ${world.cities.length} городов · ${world.universities.length} вузов`, [world.government.id, world.centralBank.id], "positive");
  return world;
}
