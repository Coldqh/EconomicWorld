export type AccountCategory =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "expense";

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
  | "LOAN_DEFAULT";

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
  | "EmployeeHired"
  | "EmployeeLeft"
  | "LoanIssued"
  | "LoanPaymentMissed"
  | "LoanRepaid"
  | "PriceChanged"
  | "CompanyDistressed"
  | "CompanyBankrupt"
  | "CompanyFounded"
  | "InterestRateChanged"
  | "MarketShortage";

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
  recipe: Record<string, number>;
}

export interface GoodsMovement {
  id: string;
  elapsedMonth: number;
  goodId: string;
  fromId: string;
  toId: string;
  quantityMilliUnits: number;
  reason: "GENESIS" | "PRODUCTION" | "INPUT" | "CONSUMPTION" | "LIQUIDATION";
  causeIds: string[];
}

export interface Household {
  id: string;
  displayName: string;
  bankId: string;
  employerId: string | null;
  skillBps: number;
  productivityBps: number;
  consumptionPropensityBps: number;
  priceSensitivityBps: number;
  reservationWageCents: number;
  monthsUnemployed: number;
  expectedInflationBps: number;
  consumptionMilliUnits: Record<string, number>;
  foundedCompanyIds: string[];
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
  inputInventoryMilliUnits: Record<string, number>;
  lastProductionMilliUnits: number;
  lastSalesMilliUnits: number;
  lastGrossRevenueCents: number;
  lastOperatingExpenseCents: number;
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
}

export interface Government {
  id: string;
  incomeTaxBps: number;
  salesTaxBps: number;
  corporateTaxBps: number;
  monthlyUnemploymentBenefitCents: number;
}

export interface CentralBank {
  id: string;
  name: string;
  policyRateBps: number;
  inflationTargetBps: number;
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

export interface CompanyMetric {
  companyId: string;
  revenueCents: number;
  expenseCents: number;
  productionMilliUnits: number;
  salesMilliUnits: number;
}

export interface MetricPoint {
  elapsedMonth: number;
  nominalGdpCents: number;
  cpiBps: number;
  annualInflationBps: number;
  unemploymentBps: number;
  depositMoneyCents: number;
  loanStockCents: number;
  activeCompanies: number;
  employedHouseholds: number;
  priceByGoodCents: Record<string, number>;
  productionByGoodMilliUnits: Record<string, number>;
  salesByGoodMilliUnits: Record<string, number>;
  companyMetrics: CompanyMetric[];
}

export interface WorldState {
  schemaVersion: 1;
  seed: string;
  clock: SimulationClock;
  ledger: LedgerState;
  goods: GoodDefinition[];
  goodsMovements: GoodsMovement[];
  households: Household[];
  companies: Company[];
  banks: Bank[];
  government: Government;
  centralBank: CentralBank;
  loans: Loan[];
  events: DomainEvent[];
  metricsHistory: MetricPoint[];
  nextEventId: number;
  nextGoodsMovementId: number;
  nextLoanId: number;
  nextCompanyId: number;
}

export interface InvariantResult {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  differenceCents?: number;
}
