export type AccountCategory = "asset" | "liability" | "equity" | "income" | "expense";
export type EntrySide = "debit" | "credit";

export interface Currency {
  id: string;
  code: "RUB" | "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "KRW";
  displayName: string;
  symbol: string;
  minorUnitDigits: number;
  monetaryAreaId: string;
}

export interface MonetaryArea {
  id: string;
  name: string;
  currencyId: Currency["id"];
  monetaryAuthorityId: string;
  memberCountryIds: string[];
}

export interface BankAccount {
  id: string;
  ownerId: string;
  bankId: string;
  currencyId: Currency["id"];
  ledgerDepositAccountId: string;
  ledgerBankLiabilityAccountId: string;
  openedAtMonth: number;
  status: "active" | "closed";
  isPrimary: boolean;
}

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
    | "security"
    | "bond"
    | "goodwill"
  | "intercentral"
    | "monetary-base"
    | "fund-unit"
    | "margin-loan"
    | "collateral"
    | "repo"
    | "derivative"
    | "sovereign-bond"
    | "infrastructure";
  currency: string;
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
  | "PROPERTY_TAX"
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
  | "LOGISTICS"
  | "EQUITY_ISSUE"
  | "EQUITY_SECONDARY"
  | "DIVIDEND"
  | "BOND_ISSUE"
  | "BOND_COUPON"
  | "BOND_REPAYMENT"
  | "ACQUISITION"
  | "IPO"
  | "BROKER_DEPOSIT"
  | "MARKET_TRADE"
  | "BROKER_FEE"
  | "EXCHANGE_FEE"
  | "BANKRUPTCY_DISTRIBUTION"
  | "SECURITY_REVALUATION"
  | "FX_TRADE"
  | "FUND_SUBSCRIPTION"
  | "FUND_REDEMPTION"
  | "MANAGEMENT_FEE"
  | "PERFORMANCE_FEE"
  | "PENSION_CONTRIBUTION"
  | "ETF_CREATION"
  | "ETF_REDEMPTION"
  | "UNDERWRITING_FEE"
  | "MARGIN_FINANCE"
  | "MARGIN_REPAYMENT"
  | "SECURITIES_BORROW"
  | "BORROW_FEE"
  | "DIVIDEND_COMPENSATION"
  | "REPO_OPEN"
  | "REPO_REPAYMENT"
  | "COLLATERAL_PLEDGE"
  | "PRIME_BROKER_LOSS"
  | "DERIVATIVE_PREMIUM"
  | "DERIVATIVE_SETTLEMENT"
  | "FUTURES_INITIAL_MARGIN"
  | "FUTURES_VARIATION_MARGIN"
  | "SWAP_SETTLEMENT"
  | "TRS_SETTLEMENT"
  | "CDS_PREMIUM"
  | "CDS_SETTLEMENT"
  | "FX_FORWARD_SETTLEMENT"
  | "DERIVATIVE_DEFAULT"
  | "SOVEREIGN_ISSUE"
  | "SOVEREIGN_COUPON"
  | "SOVEREIGN_REPAYMENT"
  | "SOVEREIGN_RESTRUCTURE"
  | "SOVEREIGN_WRITE_DOWN"
  | "PUBLIC_INVESTMENT"
  | "OPEN_MARKET_PURCHASE"
  | "OPEN_MARKET_SALE"
  | "QE"
  | "QT"
  | "DEPOSIT_INSURANCE";

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
  | "CohortMigrated"
  | "EquityIssued"
  | "SharesTransferred"
  | "DividendDeclared"
  | "BondIssued"
  | "BondCouponPaid"
  | "BondRepaid"
  | "AcquisitionClosed"
  | "CompanyListed"
  | "OrderPlaced"
  | "OrderCancelled"
  | "TradeExecuted"
  | "BrokerageOpened"
  | "BankAccountOpened"
  | "FxTradeExecuted"
  | "FundSubscribed"
  | "FundRedeemed"
  | "FundFeeCharged"
  | "MarginCallIssued"
  | "ForcedLiquidation"
  | "SecuritiesBorrowed"
  | "ShortOpened"
  | "ShortCovered"
  | "RepoOpened"
  | "RepoRepaid"
  | "PrimeBrokerLoss"
  | "DerivativeCollateralPledged"
  | "ForwardCreated"
  | "FutureNovated"
  | "DerivativeMarginCall"
  | "ClearingMemberDefault"
  | "TrsForcedUnwind"
  | "SovereignAuctionFailed"
  | "SovereignBondIssued"
  | "SovereignDefault"
  | "LenderOfLastResort";

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
  primaryBankAccountId: string;
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
  headquartersCountryId: string;
  headquartersCityId: string;
  industry: string;
  representationTier: "A" | "B" | "C";
  sizeClass: "small" | "medium" | "large";
  corporateStatus: "private" | "public" | "subsidiary" | "bankrupt";
  equitySecurityId: string;
  boardId: string;
  parentCompanyId: string | null;
  subsidiaryIds: string[];
  goodwillCents: number;
}

export interface Bank {
  id: string;
  name: string;
  baseSpreadBps: number;
  minimumCapitalRatioBps: number;
  minimumLiquidityRatioBps: number;
  countryId: string;
  baseCurrency: string;
  centralBankId: string;
  representationTier: "A" | "B";
}

export interface Government {
  id: string;
  incomeTaxBps: number;
  salesTaxBps: number;
  corporateTaxBps: number;
  monthlyUnemploymentBenefitCents: number;
  countryId: string;
  currencyId: string;
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
  countryId: string;
  currencyId: string;
  monetaryAreaId: string;
  setsPolicyRate: boolean;
}

export interface Loan {
  id: string;
  lenderBankId: string;
  borrowerId: string;
  currencyId: string;
  settlementBankAccountId: string;
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
  collateralPledgeId?: string | null;
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

export interface CountryMetricPoint {
  countryId: string;
  currencyId: string;
  elapsedMonth: number;
  nominalGdpMinor: number;
  realGdpMinor: number;
  gdpGrowthBps: number;
  cpiBps: number;
  inflationBps: number;
  unemploymentBps: number;
  employment: number;
  depositMoneyMinor: number;
  creditMinor: number;
  activeCompanies: number;
  productionMilliUnits: number;
  consumptionMinor: number;
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

export interface JobApplication {
  id: string;
  companyId: string;
  occupationId: string;
  submittedAtMonth: number;
  status: "submitted" | "offered" | "rejected" | "accepted";
  reason: string;
  offerId: string | null;
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
  monetaryAreaId: string;
  legalProfile: string;
  taxContext: string;
  cityIds: string[];
  companyIds: string[];
  bankIds: string[];
  universityIds: string[];
  governmentId: string;
  centralBankId: string;
  exchangeIds: string[];
  industries: string[];
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
  attendanceMode: "ON_CAMPUS" | "REMOTE" | "HYBRID";
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
  countryId: string;
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
  type: "identity" | "job" | "salary" | "course" | "skill" | "education" | "travel" | "housing" | "asset" | "company" | "market";
  title: string;
  detail: string;
}

export interface PlayerCommandRecord {
  id: string;
  elapsedMonth: number;
  type: "SET_PROFILE" | "APPLY_JOB" | "ACCEPT_JOB" | "RESIGN_JOB" | "ENROLL_COURSE" | "SET_SAVINGS" | "APPLY_UNIVERSITY" | "ENROLL_UNIVERSITY" | "START_TRAVEL" | "RELOCATE" | "RENT_PROPERTY" | "BUY_PROPERTY" | "BUY_DURABLE" | "SELL_DURABLE" | "FOUND_COMPANY" | "RAISE_EQUITY" | "TRANSFER_SHARES" | "DECLARE_DIVIDEND" | "ISSUE_BOND" | "ACQUIRE_COMPANY" | "IPO" | "OPEN_BROKERAGE" | "PLACE_ORDER" | "CANCEL_ORDER";
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
  jobApplications: JobApplication[];
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
  brokerageAccountIds: string[];
  bankAccountIds: string[];
  reportingCurrencyId: string;
  foodPlanId: "minimal" | "basic" | "good" | "premium";
}

export interface EquitySecurity {
  id: string;
  companyId: string;
  className: string;
  currencyId: string;
  sharesOutstanding: number;
  votesPerShare: number;
  status: "private" | "listed" | "cancelled";
}

export interface EquityHolding {
  id: string;
  securityId: string;
  ownerId: string;
  shares: number;
  costBasisCents: number;
  dividendsReceivedCents: number;
}

export interface CorporateBond {
  id: string;
  issuerCompanyId: string;
  currencyId: string;
  faceValueCents: number;
  couponBps: number;
  maturityMonth: number;
  issuedAtMonth: number;
  outstandingFaceValueCents: number;
  seniority: "senior" | "subordinated";
  status: "active" | "repaid" | "defaulted";
}

export interface BondHolding {
  id: string;
  bondId: string;
  holderId: string;
  faceValueCents: number;
  costBasisCents: number;
  couponsReceivedCents: number;
}

export interface CorporateBoard {
  id: string;
  companyId: string;
  directorOwnerIds: string[];
  approvalThresholdBps: number;
}

export interface CorporateAction {
  id: string;
  companyId: string;
  elapsedMonth: number;
  type: "founded" | "equity-raise" | "share-transfer" | "dividend" | "bond-issue" | "bond-repaid" | "acquisition" | "ipo" | "bankruptcy";
  title: string;
  amountCents: number;
  relatedEntityIds: string[];
}

export interface Acquisition {
  id: string;
  acquirerCompanyId: string;
  targetCompanyId: string;
  offerValueCents: number;
  debtFinancedCents: number;
  goodwillCents: number;
  status: "proposed" | "closed" | "rejected";
  closedAtMonth: number | null;
}

export interface Exchange {
  id: string;
  name: string;
  shortName: string;
  countryId: string;
  currencyId: string;
  bankId: string;
  listedSecurityIds: string[];
  brokerFeeBps: number;
  exchangeFeeBps: number;
}

export interface Listing {
  id: string;
  exchangeId: string;
  companyId: string;
  securityId: string;
  ticker: string;
  currencyId: string;
  listedAtMonth: number;
  lastPriceCents: number;
  previousCloseCents: number;
}

export interface Broker {
  id: string;
  name: string;
  countryId: string;
  bankId: string;
  exchangeIds: string[];
  supportedCurrencyIds: string[];
  marginAvailable: boolean;
}

export interface BrokerageAccount {
  id: string;
  brokerId: string;
  ownerId: string;
  currencyId: string;
  jurisdictionCountryId: string;
  settlementBankAccountIds: string[];
  openedAtMonth: number;
  status: "active" | "closed";
}

export interface MarketOrder {
  id: string;
  brokerageAccountId: string;
  securityId: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  quantity: number;
  remainingQuantity: number;
  limitPriceCents: number | null;
  placedAtMonth: number;
  sequence: number;
  status: "open" | "partially-filled" | "filled" | "cancelled" | "rejected";
}

export interface MarketTrade {
  id: string;
  securityId: string;
  exchangeId: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  quantity: number;
  priceCents: number;
  elapsedMonth: number;
}

export interface OhlcvBar {
  securityId: string;
  elapsedMonth: number;
  openCents: number;
  highCents: number;
  lowCents: number;
  closeCents: number;
  volume: number;
}

export interface MarketIndex {
  id: string;
  name: string;
  exchangeId: string;
  constituentSecurityIds: string[];
  methodology: "market-cap";
  levelBps: number;
  history: Array<{ elapsedMonth: number; levelBps: number }>;
}

export interface FxPair {
  id: string;
  baseCurrencyId: string;
  quoteCurrencyId: string;
  referenceRatePpm: number;
  lastRatePpm: number;
  previousRatePpm: number;
  bidRatePpm: number;
  askRatePpm: number;
  spreadBps: number;
  volumeBaseMinor: number;
}

export interface FxOrder {
  id: string;
  pairId: string;
  ownerId: string;
  side: "buy-base" | "sell-base";
  baseAmountMinor: number;
  remainingBaseMinor: number;
  limitRatePpm: number | null;
  type: "market" | "limit";
  placedAtMonth: number;
  sequence: number;
  status: "open" | "partially-filled" | "filled" | "cancelled" | "rejected";
}

export interface FxTrade {
  id: string;
  pairId: string;
  buyerId: string;
  sellerId: string;
  baseAmountMinor: number;
  quoteAmountMinor: number;
  ratePpm: number;
  feeQuoteMinor: number;
  elapsedMonth: number;
  transactionGroupId: string;
  baseLegTransactionId: string;
  quoteLegTransactionId: string;
}

export interface FxDealer {
  id: string;
  name: string;
  bankAccountIds: string[];
  targetInventoryByCurrency: Record<string, number>;
  spreadBps: number;
}

export interface FundMandate {
  assetClasses: Array<"equity" | "bond" | "cash" | "private-equity" | "derivative" | "sovereign-bond">;
  countryIds: string[];
  benchmarkIndexId: string | null;
  cashBufferBps: number;
  maxPositionBps: number;
  riskTargetBps: number;
}

export interface AssetManager {
  id: string;
  name: string;
  countryId: string;
  ownerId: string;
  bankAccountId: string;
  fundIds: string[];
  employeeCount: number;
  revenueMinor: number;
  expensesMinor: number;
}

export interface Fund {
  id: string;
  name: string;
  type: "open-end" | "etf" | "hedge" | "pension" | "private-capital";
  managerId: string;
  currencyId: string;
  bankAccountId: string;
  unitSecurityId: string | null;
  unitsOutstandingMicros: number;
  navMinor: number;
  highWaterMarkMinorPerUnit: number;
  managementFeeBps: number;
  performanceFeeBps: number;
  mandate: FundMandate;
  status: "active" | "liquidating" | "closed";
}

export interface FundUnitHolding {
  id: string;
  fundId: string;
  investorId: string;
  unitsMicros: number;
  costBasisMinor: number;
}

export interface InvestmentBankMandate {
  id: string;
  investmentBankId: string;
  clientCompanyId: string;
  type: "ipo" | "bond" | "ma";
  feeBps: number;
  targetAmountMinor: number;
  placedAmountMinor: number;
  status: "proposed" | "active" | "closed" | "failed";
}

export interface CollateralPledge {
  id: string;
  referenceId?: string | null;
  ownerId: string;
  securedPartyId: string;
  assetType: "security" | "cash" | "sovereign-bond";
  assetId: string;
  quantity: number;
  currencyId: string;
  haircutBps: number;
  markedValueMinor: number;
  purpose: "margin" | "repo" | "prime-brokerage" | "derivative-margin" | "central-bank";
  status: "active" | "released" | "liquidated";
}

export interface MarginAccount {
  id: string;
  ownerId: string;
  primeBrokerId: string;
  brokerageAccountId: string;
  currencyId: string;
  cashMinor: number;
  borrowedMinor: number;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  maxLeverageBps: number;
  status: "active" | "margin-call" | "defaulted" | "closed";
}

export interface MarginCall {
  id: string;
  marginAccountId: string;
  requiredEquityMinor: number;
  currentEquityMinor: number;
  issuedAtMonth: number;
  deadlineMonth: number;
  status: "open" | "met" | "liquidating" | "defaulted";
  reason: string;
}

export interface SecuritiesLoan {
  id: string;
  securityId: string;
  quantity: number;
  lenderId: string;
  borrowerId: string;
  collateralPledgeId: string;
  borrowFeeBps: number;
  openedAtMonth: number;
  status: "active" | "returned" | "defaulted";
}

export interface ShortPosition {
  id: string;
  marginAccountId: string;
  securityId: string;
  securitiesLoanId: string;
  quantity: number;
  entryPriceMinor: number;
  accruedBorrowFeeMinor: number;
  status: "open" | "covered" | "defaulted";
}

export interface RepoAgreement {
  id: string;
  cashLenderId: string;
  cashBorrowerId: string;
  currencyId: string;
  cashAmountMinor: number;
  collateralPledgeId: string;
  repoRateBps: number;
  openedAtMonth: number;
  maturityMonth: number;
  status: "active" | "repaid" | "defaulted";
}

export interface PrimeBrokerExposure {
  id: string;
  primeBrokerId: string;
  clientId: string;
  marginAccountId: string;
  loanMinor: number;
  collateralValueMinor: number;
  unrealizedExposureMinor: number;
  liquidationShortfallMinor: number;
  status: "active" | "liquidating" | "closed" | "loss";
}

export type UnderlyingReference =
  | { kind: "equity"; securityId: string }
  | { kind: "bond"; bondId: string }
  | { kind: "index"; indexId: string }
  | { kind: "currency-pair"; pairId: string }
  | { kind: "interest-rate"; monetaryAreaId: string }
  | { kind: "credit"; obligationId: string };

export interface DerivativeCollateralTerms {
  initialMarginBps: number;
  maintenanceMarginBps: number;
  variationMargin: boolean;
  collateralCurrencyId: string;
}

export interface DerivativeSettlementTerms {
  mode: "cash" | "physical";
  frequencyMonths: number;
  nettingEnabled: boolean;
}

interface DerivativeContractBase {
  id: string;
  counterpartyIds: [string, string];
  underlying: UnderlyingReference;
  notionalMinor: number;
  currencyId: string;
  startMonth: number;
  maturityMonth: number;
  status: "active" | "margin-call" | "matured" | "exercised" | "expired" | "defaulted" | "terminated";
  collateralTerms: DerivativeCollateralTerms;
  settlementTerms: DerivativeSettlementTerms;
  nettingSetId: string | null;
  ccpId: string | null;
  lastMarkMinor: number;
  transactionIds: string[];
}

export interface ForwardContract extends DerivativeContractBase {
  type: "forward" | "fx-forward";
  buyerId: string;
  sellerId: string;
  quantity: number;
  forwardPriceMinor: number;
}

export interface FuturesContract extends DerivativeContractBase {
  type: "future";
  exchangeId: string;
  longId: string;
  shortId: string;
  contractSize: number;
  quantity: number;
  initialPriceMinor: number;
  lastSettlementPriceMinor: number;
  initialMarginMinor: number;
}

export interface OptionContract extends DerivativeContractBase {
  type: "option";
  seriesId: string;
  holderId: string;
  writerId: string;
  optionType: "call" | "put";
  exerciseStyle: "european" | "american";
  strikeMinor: number;
  contractMultiplier: number;
  quantity: number;
  premiumPerContractMinor: number;
  carryingValueMinor: number;
}

export interface InterestRateSwapContract extends DerivativeContractBase {
  type: "interest-rate-swap";
  fixedPayerId: string;
  floatingPayerId: string;
  fixedRateBps: number;
  referenceMonetaryAreaId: string;
  paymentFrequencyMonths: number;
  lastPaymentMonth: number;
}

export interface TotalReturnSwapContract extends DerivativeContractBase {
  type: "total-return-swap";
  receiverId: string;
  payerId: string;
  securityId: string;
  quantity: number;
  referencePriceMinor: number;
  lastReferencePriceMinor: number;
  financingSpreadBps: number;
  accruedDividendMinor: number;
  hedgeBrokerageAccountId: string | null;
  hedgeQuantity: number;
}

export interface CreditDefaultSwapContract extends DerivativeContractBase {
  type: "credit-default-swap";
  protectionBuyerId: string;
  protectionSellerId: string;
  referenceObligationId: string;
  premiumBps: number;
  recoveryBps: number;
  paymentFrequencyMonths: number;
  lastPremiumMonth: number;
  creditEvents: Array<"default" | "failure-to-pay" | "bankruptcy">;
  speculative: boolean;
}

export interface FxSwapContract extends DerivativeContractBase {
  type: "fx-swap";
  partyAId: string;
  partyBId: string;
  pairId: string;
  baseAmountMinor: number;
  spotRatePpm: number;
  forwardRatePpm: number;
  nearLegSettled: boolean;
}

export type DerivativeContract = ForwardContract | FuturesContract | OptionContract | InterestRateSwapContract | TotalReturnSwapContract | CreditDefaultSwapContract | FxSwapContract;

export interface OptionMarketSeries {
  id: string;
  exchangeId: string;
  underlyingSecurityId: string;
  currencyId: string;
  expirationMonth: number;
  strikeMinor: number;
  optionType: "call" | "put";
  exerciseStyle: "european" | "american";
  contractMultiplier: number;
  bidMinor: number | null;
  askMinor: number | null;
  lastMinor: number | null;
  impliedVolatilityBps: number | null;
  volume: number;
  openInterest: number;
}

export interface NettingSet {
  id: string;
  partyAId: string;
  partyBId: string;
  currencyId: string;
  contractIds: string[];
  collateralPledgeIds: string[];
  closeOutNetting: boolean;
  status: "active" | "closed" | "defaulted";
}

export interface ClearingHouse {
  id: string;
  name: string;
  countryId: string;
  currencyId: string;
  exchangeIds: string[];
  bankAccountId: string;
  defaultFundMinor: number;
  ownCapitalMinor: number;
  status: "active" | "recovery" | "defaulted";
}

export interface ClearingMemberAccount {
  id: string;
  clearingHouseId: string;
  memberId: string;
  initialMarginMinor: number;
  variationMarginMinor: number;
  defaultFundContributionMinor: number;
  netExposureMinor: number;
  status: "active" | "margin-call" | "defaulted" | "closed";
}

export interface ClearedPosition {
  id: string;
  clearingHouseId: string;
  contractId: string;
  memberId: string;
  side: "long" | "short";
  quantity: number;
  netQuantity: number;
  lastSettlementPriceMinor: number;
  status: "open" | "closed" | "defaulted";
}

export interface DerivativeMarginCall {
  id: string;
  contractId: string;
  debtorId: string;
  creditorId: string;
  requiredMinor: number;
  collateralMinor: number;
  issuedAtMonth: number;
  deadlineMonth: number;
  status: "open" | "met" | "liquidating" | "defaulted";
}

export interface DerivativeExposureSnapshot {
  institutionId: string;
  elapsedMonth: number;
  grossNotionalMinor: number;
  grossMarketValueMinor: number;
  netExposureMinor: number;
  collateralPostedMinor: number;
  collateralReceivedMinor: number;
  potentialExposureMinor: number;
}

export type SovereignMaturityBucket = "short" | "2y" | "5y" | "10y" | "long";

export interface SovereignBond {
  id: string;
  governmentId: string;
  countryId: string;
  currencyId: string;
  maturityBucket: SovereignMaturityBucket;
  faceValueMinor: number;
  outstandingFaceValueMinor: number;
  couponBps: number;
  issuePriceMinor: number;
  marketPriceMinor: number;
  yieldBps: number;
  issuedAtMonth: number;
  maturityMonth: number;
  missedPayments: number;
  status: "active" | "matured" | "defaulted" | "restructured";
}

export interface SovereignBondHolding {
  id: string;
  bondId: string;
  holderId: string;
  faceValueMinor: number;
  bookValueMinor: number;
  couponsReceivedMinor: number;
}

export interface SovereignAuction {
  id: string;
  governmentId: string;
  countryId: string;
  currencyId: string;
  maturityBucket: SovereignMaturityBucket;
  targetFaceValueMinor: number;
  allocatedFaceValueMinor: number;
  clearingYieldBps: number | null;
  bidCount: number;
  announcedAtMonth: number;
  settledAtMonth: number | null;
  status: "announced" | "settled" | "failed" | "cancelled";
}

export interface YieldCurveSnapshot {
  countryId: string;
  elapsedMonth: number;
  points: Array<{ maturityMonths: number; yieldBps: number }>;
}

export interface GovernmentBudgetState {
  governmentId: string;
  countryId: string;
  currencyId: string;
  cashBankAccountId: string;
  propertyTaxBps: number;
  governmentConsumptionTargetBps: number;
  publicInvestmentTargetBps: number;
  educationFundingBps: number;
  personalTaxRevenueMinor: number;
  corporateTaxRevenueMinor: number;
  consumptionTaxRevenueMinor: number;
  propertyTaxRevenueMinor: number;
  totalRevenueMinor: number;
  governmentConsumptionMinor: number;
  publicInvestmentMinor: number;
  transfersMinor: number;
  educationSpendingMinor: number;
  interestSpendingMinor: number;
  totalSpendingMinor: number;
  primaryBalanceMinor: number;
  budgetBalanceMinor: number;
  publicDebtMinor: number;
  debtDueNext12MonthsMinor: number;
  averageMaturityMonths: number;
  infrastructureCapitalMinor: number;
  fiscalStressBps: number;
}

export interface CentralBankBalanceSheetState {
  centralBankId: string;
  currencyId: string;
  governmentSecuritiesMinor: number;
  bankLendingMinor: number;
  otherAssetsMinor: number;
  bankReservesMinor: number;
  currencyInCirculationMinor: number;
  governmentDepositsMinor: number;
  equityMinor: number;
  qePurchasesMinor: number;
  qtSalesMinor: number;
}

export interface MonetaryPolicyDecision {
  id: string;
  centralBankId: string;
  elapsedMonth: number;
  previousRateBps: number;
  newRateBps: number;
  observedInflationBps: number;
  outputGapBps: number;
  unemploymentBps: number;
  financialStressBps: number;
  neutralRateBps: number;
  reason: string;
}

export interface DepositInsuranceScheme {
  id: string;
  countryId: string;
  currencyId: string;
  coverageLimitMinor: number;
  fundBankAccountId: string;
  fundBalanceMinor: number;
  premiumBps: number;
}

export interface CountryMacroState {
  countryId: string;
  currencyId: string;
  potentialOutputMinor: number;
  outputGapBps: number;
  businessCycle: "expansion" | "slowdown" | "recession" | "recovery";
  inflationExpectationsBps: number;
  centralBankCredibilityBps: number;
  creditGrowthBps: number;
  creditToGdpBps: number;
  defaultRateBps: number;
  lendingStandardsBps: number;
  leverageBps: number;
  depositRateBps: number;
  averageLoanRateBps: number;
  sovereignRiskBps: number;
  tenYearYieldBps: number;
  demandPressureBps: number;
  wagePressureBps: number;
  inputPressureBps: number;
  housingServicesPressureBps: number;
}

export interface MacroMonthlyPoint extends CountryMacroState {
  elapsedMonth: number;
  nominalGdpMinor: number;
  realGdpMinor: number;
  gdpGrowthBps: number;
  inflationBps: number;
  unemploymentBps: number;
  policyRateBps: number;
  budgetBalanceMinor: number;
  primaryBalanceMinor: number;
  publicDebtMinor: number;
  debtToGdpBps: number;
  governmentConsumptionMinor: number;
  publicInvestmentMinor: number;
  consumptionContributionMinor: number;
  investmentContributionMinor: number;
  governmentContributionMinor: number;
  inventoryContributionMinor: number;
}

export type SimulationScenario = "baseline" | "high-demand" | "supply-constraint" | "high-rates" | "bank-liquidity-stress";

export interface WorldState {
  schemaVersion: 6;
  saveVersion: 6;
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
  governments: Government[];
  centralBanks: CentralBank[];
  currencies: Currency[];
  monetaryAreas: MonetaryArea[];
  bankAccounts: BankAccount[];
  loans: Loan[];
  bankFunding: BankFunding[];
  nationalAccounts: NationalAccountsState;
  occupations: Occupation[];
  player: PlayerState;
  events: DomainEvent[];
  metricsHistory: MetricPoint[];
  countryMetricsHistory: CountryMetricPoint[];
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
  equitySecurities: EquitySecurity[];
  equityHoldings: EquityHolding[];
  corporateBonds: CorporateBond[];
  bondHoldings: BondHolding[];
  corporateBoards: CorporateBoard[];
  corporateActions: CorporateAction[];
  acquisitions: Acquisition[];
  exchanges: Exchange[];
  listings: Listing[];
  brokers: Broker[];
  brokerageAccounts: BrokerageAccount[];
  marketOrders: MarketOrder[];
  archivedMarketOrders: MarketOrder[];
  marketTrades: MarketTrade[];
  ohlcvBars: OhlcvBar[];
  marketIndices: MarketIndex[];
  fxPairs: FxPair[];
  fxOrders: FxOrder[];
  fxTrades: FxTrade[];
  fxDealers: FxDealer[];
  assetManagers: AssetManager[];
  funds: Fund[];
  fundUnitHoldings: FundUnitHolding[];
  investmentBankMandates: InvestmentBankMandate[];
  marginAccounts: MarginAccount[];
  marginCalls: MarginCall[];
  collateralPledges: CollateralPledge[];
  securitiesLoans: SecuritiesLoan[];
  shortPositions: ShortPosition[];
  repoAgreements: RepoAgreement[];
  primeBrokerExposures: PrimeBrokerExposure[];
  derivativeContracts: DerivativeContract[];
  optionMarketSeries: OptionMarketSeries[];
  nettingSets: NettingSet[];
  clearingHouses: ClearingHouse[];
  clearingMemberAccounts: ClearingMemberAccount[];
  clearedPositions: ClearedPosition[];
  derivativeMarginCalls: DerivativeMarginCall[];
  derivativeExposureHistory: DerivativeExposureSnapshot[];
  sovereignBonds: SovereignBond[];
  sovereignBondHoldings: SovereignBondHolding[];
  sovereignAuctions: SovereignAuction[];
  yieldCurveHistory: YieldCurveSnapshot[];
  governmentBudgets: GovernmentBudgetState[];
  centralBankBalanceSheets: CentralBankBalanceSheetState[];
  monetaryPolicyDecisions: MonetaryPolicyDecision[];
  depositInsuranceSchemes: DepositInsuranceScheme[];
  countryMacroStates: CountryMacroState[];
  macroHistory: MacroMonthlyPoint[];
  nextSecurityId: number;
  nextHoldingId: number;
  nextBondId: number;
  nextCorporateActionId: number;
  nextAcquisitionId: number;
  nextBrokerageAccountId: number;
  nextOrderId: number;
  nextTradeId: number;
  nextOrderSequence: number;
  nextBankAccountId: number;
  nextFxOrderId: number;
  nextFxTradeId: number;
  nextFundUnitHoldingId: number;
  nextMarginAccountId: number;
  nextMarginCallId: number;
  nextCollateralId: number;
  nextSecuritiesLoanId: number;
  nextShortPositionId: number;
  nextRepoId: number;
  nextDerivativeId: number;
  nextDerivativeMarginCallId: number;
  nextNettingSetId: number;
  nextClearingPositionId: number;
  nextSovereignBondId: number;
  nextSovereignHoldingId: number;
  nextSovereignAuctionId: number;
  nextMonetaryDecisionId: number;
}

export interface InvariantResult {
  id: string;
  section: "Национальные счета" | "Бухгалтерия" | "Товары" | "Деньги" | "Валюты" | "Кредит" | "Ликвидность банков" | "Игрок" | "Население" | "География" | "Жильё" | "Образование" | "Производительность" | "Собственность" | "Рынки" | "Фонды" | "Обеспечение" | "Деривативы" | "Клиринг" | "Государственный долг" | "Денежная политика";
  title: string;
  ok: boolean;
  detail: string;
  differenceCents?: number;
}
