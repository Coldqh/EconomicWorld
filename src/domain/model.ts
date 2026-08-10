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
  | "EDUCATION";

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
  | "SkillChanged";

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
  reason: "GENESIS" | "PRODUCTION" | "INPUT" | "CONSUMPTION" | "CAPITAL" | "LIQUIDATION";
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
  educationLevel: "basic" | "secondary" | "bachelor";
  skills: Record<SkillId, number>;
  practicalExperience: Record<SkillId, number>;
  reputationBps: number;
  occupationId: string | null;
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
}

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
  type: "identity" | "job" | "salary" | "course" | "skill";
  title: string;
  detail: string;
}

export interface PlayerCommandRecord {
  id: string;
  elapsedMonth: number;
  type: "SET_PROFILE" | "APPLY_JOB" | "ACCEPT_JOB" | "RESIGN_JOB" | "ENROLL_COURSE" | "SET_SAVINGS";
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
}

export type SimulationScenario = "baseline" | "high-demand" | "supply-constraint" | "high-rates" | "bank-liquidity-stress";

export interface WorldState {
  schemaVersion: 2;
  saveVersion: 2;
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
}

export interface InvariantResult {
  id: string;
  section: "Национальные счета" | "Бухгалтерия" | "Товары" | "Деньги" | "Кредит" | "Ликвидность банков" | "Игрок";
  title: string;
  ok: boolean;
  detail: string;
  differenceCents?: number;
}
