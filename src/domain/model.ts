export type AccountCategory = "asset" | "liability" | "equity" | "income" | "expense";
export type EntrySide = "debit" | "credit";

export interface LedgerAccount {
  id: string;
  ownerId: string;
  name: string;
  category: AccountCategory;
  instrument:
    | "deposit"
    | "reserve"
    | "loan"
    | "equity"
    | "income"
    | "expense"
    | "investment"
    | "inventory"
    | "productive-capital"
    | "interbank"
    | "central-bank-facility"
    | "property"
    | "durable"
    | "cohort-capital"
    | "monetary-base";
  currency: "RUB";
}

export interface LedgerEntry {
  accountId: string;
  side: EntrySide;
  amountCents: number;
}

export type TransactionKind =
  | "GENESIS"
  | "TRANSFER"
  | "WAGE"
  | "INCOME_TAX"
  | "SALES_TAX"
  | "CORPORATE_TAX"
  | "SOCIAL_TRANSFER"
  | "GOODS_CLEARING"
  | "INPUT_PURCHASE"
  | "CAPITAL_CONTRIBUTION"
  | "LOAN_ISSUED"
  | "LOAN_INTEREST"
  | "LOAN_PRINCIPAL"
  | "LOAN_DEFAULT"
  | "INVENTORY_SEED"
  | "INVENTORY_TRANSFER"
  | "COGS"
  | "PRODUCTION"
  | "DEPRECIATION"
  | "CAPITAL_INVESTMENT"
  | "ACCOUNTING_CLOSE"
  | "INTERBANK_LOAN"
  | "CENTRAL_BANK_FACILITY"
  | "EDUCATION"
  | "UNIVERSITY_TUITION"
  | "COHORT_INCOME"
  | "COHORT_CONSUMPTION"
  | "MATERIALIZATION"
  | "DEMATERIALIZATION"
  | "TRAVEL"
  | "RENT"
  | "PROPERTY_PURCHASE"
  | "DURABLE_PURCHASE"
  | "USED_ASSET"
  | "LOGISTICS";

export interface LedgerTransaction {
  id: string;
  elapsedMonth: number;
  kind: TransactionKind;
  memo: string;
  causeIds: string[];
  entries: LedgerEntry[];
}

export interface LedgerState {
  accounts: Record<string, LedgerAccount>;
  balances: Record<string, number>;
  transactions: LedgerTransaction[];
  nextTransactionId: number;
}

export interface LedgerArchiveSegment {
  id: string;
  fromMonth: number;
  toMonth: number;
  transactionCount: number;
  debitCents: number;
  creditCents: number;
  kindCounts: Partial<Record<TransactionKind, number>>;
}

export interface SimulationClock {
  startYear: number;
  startMonth: number;
  elapsedMonths: number;
}

export type EventType =
  | "WorldCreated"
  | "MonthClosed"
  | "AccountingPeriodClosed"
  | "EmployeeHired"
  | "EmployeeLeft"
  | "LoanIssued"
  | "LoanRejected"
  | "LoanPaymentMissed"
  | "LoanRepaid"
  | "PriceChanged"
  | "CompanyDistressed"
  | "CompanyBankrupt"
  | "CompanyFounded"
  | "CapitalInvested"
  | "InterestRateChanged"
  | "MarketShortage"
  | "BankLiquidityFunded"
  | "PlayerCreated"
  | "JobApplied"
  | "JobOfferCreated"
  | "JobStarted"
  | "JobEnded"
  | "SalaryChanged"
  | "CourseEnrolled"
  | "CourseCompleted"
  | "SkillChanged"
  | "UniversityApplied"
  | "UniversityAdmitted"
  | "UniversityRejected"
  | "UniversityEnrolled"
  | "UniversityGraduated"
  | "TravelStarted"
  | "TravelCompleted"
  | "PlayerRelocated"
  | "PropertyRented"
  | "PropertyPurchased"
  | "DurablePurchased"
  | "DurableResold"
  | "PersonMaterialized"
  | "PersonDematerialized"
  | "CohortMigrated";

export interface DomainEvent {
  id: string;
  type: EventType;
  elapsedMonth: number;
  title: string;
  detail: string;
  actorIds: string[];
  causeIds: string[];
  severity: "info" | "attention" | "critical" | "positive";
  data: Record<string, number | string | boolean>;
}

export interface GoodDefinition {
  id: string;
  name: string;
  shortName: string;
  unit: string;
  basePriceCents: number;
  consumptionWeightBps: number;
  essential: boolean;
  recipe: Record<string, number>;
}

export interface GoodsMovement {
  id: string;
  elapsedMonth: number;
  goodId: string;
  fromId: string;
  toId: string;
  quantityMilliUnits: number;
  reason: "GENESIS" | "PRODUCTION" | "INPUT" | "CONSUMPTION" | "CAPITAL" | "LIQUIDATION" | "TRANSPORT" | "USED";
  causeIds: string[];
}

export type SkillId =
  | "economics"
  | "accounting"
  | "finance"
  | "statistics"
  | "programming"
  | "dataAnalysis"
  | "communication"
  | "management";

export interface Person {
  id: string;
  householdId: string;
  displayName: string;
  ageAtStart: number;
  educationLevel: "basic" | "secondary" | "bachelor" | "master" | "doctorate";
  skills: Record<SkillId, number>;
  practicalExperience: Record<SkillId, number>;
  reputationBps: number;
  occupationId: string | null;
  cityId: string;
  fidelityTier: 0 | 1 | 2;
  sourceCohortId: string | null;
  important: boolean;
}

export interface Household {
  id: string;
  displayName: string;
  personIds: string[];
  bankId: string;
  employerId: string | null;
  skillBps: number;
  productivityBps: number;
  consumptionPropensityBps: number;
  savingsPreferenceBps: number;
  liquidityPreferenceBps: number;
  essentialBudgetBps: number;
  priceSensitivityBps: number;
  preferenceWeightsBps: Record<string, number>;
  preferredSellerByGoodId: Record<string, string>;
  reservationWageCents: number;
  monthsUnemployed: number;
  expectedInflationBps: number;
  consumptionMilliUnits: Record<string, number>;
  foundedCompanyIds: string[];
  cityId: string;
  utilityPreferencesBps: Record<ConsumptionCategory, number>;
  lastDisposableIncomeCents: number;
  lastSpendingByCategoryCents: Record<ConsumptionCategory, number>;
}

export type ConsumptionCategory = "food" | "housing" | "energy" | "transport" | "services" | "goods" | "education" | "entertainment" | "luxury";

export interface ProductiveCapital {
  acquisitionCostCents: number;
  bookValueCents: number;
  accumulatedDepreciationCents: number;
  usefulLifeMonths: number;
  capacityMilliUnits: number;
}

export interface CompanyFinancialReport {
  elapsedMonth: number;
  quarter: number;
  year: number;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  wagesCents: number;
  depreciationCents: number;
  interestCents: number;
  taxesCents: number;
  netIncomeCents: number;
  operatingCashFlowCents: number;
  investingCashFlowCents: number;
  financingCashFlowCents: number;
  assetsCents: number;
  liabilitiesCents: number;
  equityCents: number;
  inventoryCents: number;
  productiveCapitalCents: number;
}

export interface Company {
  id: string;
  name: string;
  goodId: string;
  ownerHouseholdId: string;
  bankId: string;
  active: boolean;
  employees: string[];
  wageCents: number;
  priceCents: number;
  capacityMilliUnits: number;
  productivityBps: number;
  inventoryMilliUnits: number;
  inventoryValueCents: number;
  inputInventoryMilliUnits: Record<string, number>;
  inputInventoryValueCents: Record<string, number>;
  productiveCapital: ProductiveCapital;
  retainedEarningsCents: number;
  financialReports: CompanyFinancialReport[];
  lastProductionMilliUnits: number;
  lastSalesMilliUnits: number;
  lastGrossRevenueCents: number;
  lastOperatingExpenseCents: number;
  lastCogsCents: number;
  lastIntermediateConsumptionCents: number;
  lastIntermediateConsumptionBaseCents: number;
  lastWagesCents: number;
  lastDepreciationCents: number;
  lastInterestCents: number;
  lastTaxCents: number;
  lastCapitalInvestmentCents: number;
  lastHouseholdSalesCents: number;
  lastGovernmentSalesCents: number;
  distressMonths: number;
  missedPayrollMonths: number;
  foundedAtMonth: number;
  closedAtMonth: number | null;
  closureReason: string | null;
  cityId: string;
  productId: string;
  technologyBps: number;
  managementBps: number;
  learningByDoingBps: number;
  qualityBps: number;
  brandReputationBps: number;
  marketShareBps: number;
  marginalCostCents: number;
  capacityUtilizationBps: number;
  occupationFamilyNeeds: Record<string, number>;
}

export interface Bank {
  id: string;
  name: string;
  baseSpreadBps: number;
  minimumCapitalRatioBps: number;
  minimumLiquidityRatioBps: number;
}

export interface Government {
  id: string;
  incomeTaxBps: number;
  salesTaxBps: number;
  corporateTaxBps: number;
  monthlyUnemploymentBenefitCents: number;
}

export interface PolicyRatePoint {
  elapsedMonth: number;
  rateBps: number;
}

export interface CentralBank {
  id: string;
  name: string;
  policyRateBps: number;
  inflationTargetBps: number;
  policyRateHistory: PolicyRatePoint[];
}

export interface Loan {
  id: string;
  lenderBankId: string;
  borrowerId: string;
  originalPrincipalCents: number;
  remainingPrincipalCents: number;
  annualRateBps: number;
  remainingMonths: number;
  missedPayments: number;
  status: "active" | "repaid" | "defaulted";
  issuedAtMonth: number;
}

export interface BankFunding {
  id: string;
  lenderId: string;
  borrowerBankId: string;
  principalCents: number;
  remainingCents: number;
  annualRateBps: number;
  issuedAtMonth: number;
  kind: "interbank" | "central-bank";
  status: "active" | "repaid";
}

export interface CompanyMetric {
  companyId: string;
  revenueCents: number;
  expenseCents: number;
  cogsCents: number;
  netIncomeCents: number;
  productionMilliUnits: number;
  salesMilliUnits: number;
}

export interface MetricPoint {
  elapsedMonth: number;
  nominalGdpCents: number;
  gdpValueAddedCents: number;
  gdpExpenditureCents: number;
  gdpReconciliationGapCents: number;
  realGdpCents: number;
  realGdpGrowthBps: number;
  gdpDeflatorBps: number;
  householdConsumptionCents: number;
  capitalFormationCents: number;
  governmentConsumptionCents: number;
  inventoryChangeCents: number;
  cpiBps: number;
  monthlyInflationBps: number;
  annualInflationBps: number;
  cpiContributionBpsByGood: Record<string, number>;
  unemploymentBps: number;
  depositMoneyCents: number;
  loanStockCents: number;
  activeCompanies: number;
  employedHouseholds: number;
  policyRateBps: number;
  priceByGoodCents: Record<string, number>;
  productionByGoodMilliUnits: Record<string, number>;
  salesByGoodMilliUnits: Record<string, number>;
  companyMetrics: CompanyMetric[];
  marketConcentrationBpsByGood: Record<string, number>;
  priceElasticityBpsByGood: Record<string, number>;
  marketShareBpsByCompany: Record<string, number>;
}

export interface CurrentAccountingPeriod {
  openingInventoryValueCents: number;
  householdConsumptionCents: number;
  governmentConsumptionCents: number;
  capitalFormationCents: number;
  householdConsumptionByGoodCents: Record<string, number>;
  governmentConsumptionByGoodCents: Record<string, number>;
}

export interface NationalAccountsState {
  baseYear: number;
  cpiWeightsBps: Record<string, number>;
  current: CurrentAccountingPeriod;
}

export interface Occupation {
  id: string;
  name: string;
  level: number;
  requiredSkills: Partial<Record<SkillId, number>>;
  productivityMultiplierBps: number;
  minimumExperienceMonths: number;
  nextOccupationIds: string[];
  family: "production" | "engineering" | "software" | "finance" | "management" | "sales" | "services" | "research" | "education";
}

export interface JobOffer {
  companyId: string;
  occupationId: string;
  salaryCents: number;
  createdAtMonth: number;
  expiresAtMonth: number;
  scoreBps: number;
}

export interface CourseEnrollment {
  courseId: string;
  enrolledAtMonth: number;
  completedMonths: number;
  durationMonths: number;
  status: "active" | "completed";
}

export interface Country {
  id: string;
  name: string;
  currencyReference: string;
  legalProfile: string;
  taxContext: string;
  cityIds: string[];
}

export interface City {
  id: string;
  countryId: string;
  name: string;
  latitude: number;
  longitude: number;
  population: number;
  baseMonthlyWageCents: number;
  transportCostPerKmCents: number;
  logisticsCapacityMilliUnits: number;
  localPriceByGoodCents: Record<string, number>;
  medianIncomeCents: number;
  employmentBps: number;
  costOfLivingCents: number;
  housingVacancyBps: number;
  majorIndustries: string[];
  universityIds: string[];
}

export type TransportMode = "air" | "rail" | "road";

export interface TravelOption {
  originCityId: string;
  destinationCityId: string;
  mode: TransportMode;
  distanceKm: number;
  durationDays: number;
  priceCents: number;
  providerId: string;
}

export interface PlayerTravelPlan extends TravelOption {
  startedAtMonth: number;
  remainingDays: number;
  relocation: boolean;
}

export interface UniversityProgram {
  id: string;
  universityId: string;
  name: string;
  degree: "bachelor" | "master" | "doctorate";
  durationMonths: number;
  tuitionPerYearCents: number;
  capacity: number;
  occupiedSeats: number;
  minimumEducation: Person["educationLevel"];
  requiredSkills: Partial<Record<SkillId, number>>;
  skillOutcomes: Partial<Record<SkillId, number>>;
  specialization: string;
}

export interface University {
  id: string;
  name: string;
  shortName: string;
  type: "university" | "institute";
  cityId: string;
  bankId: string;
  reputationBps: number;
  teachingQualityBps: number;
  programIds: string[];
  studentPopulation: number;
}

export interface UniversityApplication {
  id: string;
  universityId: string;
  programId: string;
  submittedAtMonth: number;
  scoreBps: number;
  status: "admitted" | "rejected" | "enrolled";
  reason: string;
}

export interface UniversityEnrollment {
  universityId: string;
  programId: string;
  startedAtMonth: number;
  completedMonths: number;
  durationMonths: number;
  nextTuitionMonth: number;
  status: "active" | "completed" | "paused";
}

export interface HousingCohort {
  id: string;
  cityId: string;
  type: "rental-apartment" | "owned-apartment" | "house" | "luxury-apartment" | "villa";
  qualityBps: number;
  averageSizeSqm: number;
  totalUnits: number;
  availableUnits: number;
  monthlyRentCents: number;
  salePriceCents: number;
  constructionCostCents: number;
  ownerSectorId: string;
}

export interface OwnershipRecord {
  ownerId: string;
  acquiredAtMonth: number;
  priceCents: number;
}

export interface PropertyInstance {
  id: string;
  sourceCohortId: string;
  cityId: string;
  type: HousingCohort["type"];
  sizeSqm: number;
  qualityBps: number;
  conditionBps: number;
  purchasePriceCents: number;
  currentValueCents: number;
  ownerId: string;
  tenantId: string | null;
  monthlyRentCents: number;
  maintenanceCents: number;
  ownershipHistory: OwnershipRecord[];
}

export interface ProductDefinition {
  id: string;
  category: "phone" | "computer" | "furniture" | "car" | "watch";
  name: string;
  brand: string;
  priceCents: number;
  qualityBps: number;
  durabilityMonths: number;
  prestigeBps: number;
  operatingCostCents: number;
  energyEfficiencyBps: number;
  originCountryId: string;
  sellerId: string;
}

export interface DurableAsset {
  id: string;
  productId: string;
  ownerId: string;
  sellerId: string;
  purchasedAtMonth: number;
  purchasePriceCents: number;
  ageMonths: number;
  conditionBps: number;
  maintenanceCents: number;
  resaleValueCents: number;
  ownershipHistory: OwnershipRecord[];
}

export interface PopulationCohort {
  id: string;
  countryId: string;
  cityId: string;
  bankId: string;
  ageBand: "18-24" | "25-34" | "35-49" | "50-64" | "65+";
  education: Person["educationLevel"];
  occupationFamily: Occupation["family"];
  incomeBand: "low" | "middle" | "high";
  householdType: "single" | "couple" | "family";
  populationCount: number;
  employedCount: number;
  averageMonthlyIncomeCents: number;
  wealthDistribution: { medianCents: number; p90Cents: number };
  skillDistribution: Record<SkillId, { mean: number; spread: number }>;
  consumptionPreferencesBps: Record<ConsumptionCategory, number>;
  housingDistributionBps: Record<string, number>;
  bankingDistributionBps: Record<string, number>;
  lastConsumptionCents: number;
  lastIncomeCents: number;
}

export interface FirmCohort {
  id: string;
  cityId: string;
  bankId: string;
  industry: string;
  sizeBucket: "micro" | "small" | "medium";
  firmCount: number;
  employment: number;
  revenueCents: number;
  capitalCents: number;
  debtCents: number;
  productionMilliUnits: number;
  inventoryMilliUnits: number;
  profitsCents: number;
  productivityBps: number;
}

export interface FidelityState {
  tierByEntityId: Record<string, 0 | 1 | 2 | 3>;
  relevanceByEntityId: Record<string, number>;
  materializedPersonIds: string[];
  budgets: {
    maxNamedPersons: number;
    maxActivePersons: number;
    maxFullCompanies: number;
    maxActiveProperties: number;
  };
  activeCityIds: string[];
}

export interface WorldDiagnostics {
  populationRepresented: number;
  businessesRepresented: number;
  highFidelityPersons: number;
  materializedPersons: number;
  explicitFirms: number;
  firmCohorts: number;
  materializedProperties: number;
  housingUnitsRepresented: number;
  ledgerHotTransactions: number;
  ledgerArchivedTransactions: number;
  estimatedSaveBytes: number;
  deterministicWorkUnits: number;
}

export interface PlayerMonthlySnapshot {
  elapsedMonth: number;
  age: number;
  employerId: string | null;
  occupationId: string | null;
  netWorthCents: number;
  incomeCents: number;
  expensesCents: number;
  savingsCents: number;
  debtCents: number;
  skills: Record<SkillId, number>;
}

export interface PlayerTimelineEvent {
  id: string;
  elapsedMonth: number;
  type: "identity" | "job" | "salary" | "course" | "skill" | "education" | "travel" | "housing" | "asset";
  title: string;
  detail: string;
}

export interface PlayerCommandRecord {
  id: string;
  elapsedMonth: number;
  type: "SET_PROFILE" | "APPLY_JOB" | "ACCEPT_JOB" | "RESIGN_JOB" | "ENROLL_COURSE" | "SET_SAVINGS" | "APPLY_UNIVERSITY" | "ENROLL_UNIVERSITY" | "START_TRAVEL" | "RELOCATE" | "RENT_PROPERTY" | "BUY_PROPERTY" | "BUY_DURABLE" | "SELL_DURABLE";
  payload: Record<string, string | number | boolean>;
}

export interface PlayerState {
  personId: string;
  householdId: string;
  profileId: string;
  automaticBasicSpending: boolean;
  consumptionBudgetBps: number;
  savingsTargetBps: number;
  pendingJobOffer: JobOffer | null;
  activeEnrollment: CourseEnrollment | null;
  completedCourseIds: string[];
  completedLessonIds: string[];
  monthlyHistory: PlayerMonthlySnapshot[];
  timeline: PlayerTimelineEvent[];
  commandLog: PlayerCommandRecord[];
  nextCommandId: number;
  nextTimelineId: number;
  currentCityId: string;
  residencePropertyId: string | null;
  activeTravel: PlayerTravelPlan | null;
  universityApplications: UniversityApplication[];
  activeUniversityEnrollment: UniversityEnrollment | null;
  completedProgramIds: string[];
  educationHistory: Array<{ universityId: string; programId: string; startedAtMonth: number; completedAtMonth: number | null }>;
  visitedCityIds: string[];
  visitedCountryIds: string[];
  residenceHistory: Array<{ cityId: string; fromMonth: number; toMonth: number | null }>;
  durableAssetIds: string[];
  propertyIds: string[];
}

export type SimulationScenario = "baseline" | "high-demand" | "supply-constraint" | "high-rates" | "bank-liquidity-stress";

export interface WorldState {
  schemaVersion: 3;
  saveVersion: 3;
  seed: string;
  scenario: SimulationScenario;
  clock: SimulationClock;
  ledger: LedgerState;
  goods: GoodDefinition[];
  goodsMovements: GoodsMovement[];
  people: Person[];
  households: Household[];
  companies: Company[];
  banks: Bank[];
  government: Government;
  centralBank: CentralBank;
  loans: Loan[];
  bankFunding: BankFunding[];
  nationalAccounts: NationalAccountsState;
  occupations: Occupation[];
  player: PlayerState;
  events: DomainEvent[];
  metricsHistory: MetricPoint[];
  nextEventId: number;
  nextGoodsMovementId: number;
  nextLoanId: number;
  nextFundingId: number;
  nextCompanyId: number;
  countries: Country[];
  cities: City[];
  universities: University[];
  universityPrograms: UniversityProgram[];
  housingCohorts: HousingCohort[];
  properties: PropertyInstance[];
  products: ProductDefinition[];
  durableAssets: DurableAsset[];
  populationCohorts: PopulationCohort[];
  firmCohorts: FirmCohort[];
  fidelity: FidelityState;
  ledgerArchives: LedgerArchiveSegment[];
  diagnostics: WorldDiagnostics;
  nextMaterializedPersonId: number;
  nextPropertyId: number;
  nextDurableAssetId: number;
  nextApplicationId: number;
}

export interface InvariantResult {
  id: string;
  section: "Национальные счета" | "Бухгалтерия" | "Товары" | "Деньги" | "Кредит" | "Ликвидность банков" | "Игрок" | "Население" | "География" | "Жильё" | "Образование" | "Производительность";
  title: string;
  ok: boolean;
  detail: string;
  differenceCents?: number;
}
