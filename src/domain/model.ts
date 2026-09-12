import type {
  AcquisitionVehicle, ArbitrageRecord, BankAlmState, CapitalProject, CausalExplanation, CircuitBreakerState, CompanyDecisionState,
  CreditOffer, DataCoverageSnapshot, EconomicAuction, EtfArbitrageEvent, EtfBasket, ExecutionQuality, FundFlow, GovernanceProposal,
  FundPerformance, FundRedemptionRequest, InsuranceClaim, InsuranceLossEvent, InsurancePolicy, InsurerState, IPOProcess, MAndADeal, MarketAgentState,
  LockupRestriction, MarketMakerQuote, PrivateEquityDeal, PrivateEquityFundState, RealBankProfile, RealCompanyProfile, ReinsuranceTreaty, RestructuringCase,
} from "./economic-markets.ts";
export type * from "./economic-markets.ts";

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

export type BaselineSourceType = "CALIBRATED" | "REAL_DATA" | "ESTIMATED" | "SYNTHETIC_FALLBACK";

export interface BaselineMetadata {
  sourceType: BaselineSourceType;
  baseYear: number;
  sourceNote?: string;
  fieldSources?: Record<string, BaselineSourceType>;
}

export interface MonetaryAreaEconomicProfile {
  monetaryAreaId: string;
  policyRateBps: number;
  inflationTargetBps: number;
  reserveRequirementBps: number;
  metadata: BaselineMetadata;
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
  | "ASSET_IMPAIRMENT"
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
  | "TARIFF"
  | "SUBSIDY"
  | "FOREIGN_AID"
  | "SOVEREIGN_LOAN"
  | "PROCUREMENT"
  | "CORRUPTION_LEAKAGE"
  | "LOBBYING"
  | "OPEN_MARKET_PURCHASE"
  | "OPEN_MARKET_SALE"
  | "QE"
  | "QT"
  | "DEPOSIT_INSURANCE"
  | "INSURANCE_PREMIUM"
  | "INSURANCE_CLAIM"
  | "REINSURANCE_PREMIUM"
  | "AUCTION_SETTLEMENT";

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

export interface CompactedLedgerRecord {
  id: string;
  fromMonth: number;
  toMonth: number;
  sourceAccountGroup: string;
  destinationAccountGroup: string;
  currencyId: string;
  totalDebitMinor: number;
  totalCreditMinor: number;
  transactionCount: number;
  category: TransactionKind;
  accountGroupNetFlows: Record<string, number>;
  checksum: string;
}

export interface CompactedDerivativeRecord {
  id: string;
  type: DerivativeContract["type"];
  counterpartyGroups: [string, string];
  notionalMinor: number;
  currencyId: string;
  openedAtMonth: number;
  closedAtMonth: number;
  realizedPnlMinor: number;
  motive: DerivativeMotive | null;
  defaulted: boolean;
  rolledToId: string | null;
}

export interface CompactedMarketRecord {
  elapsedMonth: number;
  securityId: string;
  orderCount: number;
  tradeCount: number;
  volume: number;
  turnoverMinor: number;
}

export interface CompactCompanyAnnualRecord {
  companyId: string;
  year: number;
  revenueMinor: number;
  netIncomeMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  equityMinor: number;
}

export interface CompactEventRecord {
  elapsedMonth: number;
  type: EventType;
  count: number;
}

export interface CompactNumericSeries {
  months: number[];
  columns: Record<string, number[]>;
}

export interface HistoryRetentionPolicy {
  hotLedgerMonths: number;
  detailedArchiveMonths: number;
  playerDetailMonths: number;
  marketDetailMonths: number;
  companyReportMonths: number;
  detailedMetricMonths: number;
  derivativeDetailMonths: number;
  tradeDetailMonths: number;
}

export interface CompactedTradeRecord {
  elapsedMonth: number;
  exporterCountryId: string;
  importerCountryId: string;
  commodityId: string;
  quantityMilliUnits: number;
  valueUsdMinor: number;
  flowCount: number;
}

export interface CompactedAuctionRecord {
  id: string;
  objectType: "sovereign-bond" | "procurement" | "privatization" | "bankruptcy-asset" | "license" | "company";
  objectId: string;
  mechanism: "english" | "dutch" | "first-price" | "reverse-first-price" | "vickrey" | "uniform-price" | "pay-as-bid";
  status: "settled" | "failed";
  openedAtMonth: number;
  closedAtMonth: number;
  reserveMinor: number;
  offeredQuantity: number;
  allocatedQuantity: number;
  proceedsMinor: number;
  winnerCount: number;
}

export interface HistoryState {
  policy: HistoryRetentionPolicy;
  importantLedgerTransactions: LedgerTransaction[];
  compactedLedgerRecords: CompactedLedgerRecord[];
  compactedDerivativeRecords: CompactedDerivativeRecord[];
  compactedMarketRecords: CompactedMarketRecord[];
  companyAnnualRecords: CompactCompanyAnnualRecord[];
  compactedEventRecords: CompactEventRecord[];
  compactedTradeRecords: CompactedTradeRecord[];
  compactedAuctionRecords: CompactedAuctionRecord[];
  globalSeries: CompactNumericSeries;
  countrySeries: Record<string, CompactNumericSeries>;
  lastCompactedMonth: number;
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

export type WorldMode = "REAL_WORLD" | "SYNTHETIC";
export type GlobalCommodityCategory = "energy" | "metals" | "agriculture" | "industrial" | "final";

export interface WorldBaselineReference {
  mode: WorldMode;
  baselineDate: string;
  referenceYear: number;
  countryPackVersion: string;
  calibrationSetId: string;
  replayObservedExternalShocks: boolean;
}

export type BaselineCoverageStatus = "OBSERVED" | "ESTIMATED" | "CALIBRATED" | "MISSING";

export interface CountryScaleReconciliation {
  countryId: string;
  targetAnnualNominalGdpMinor: number;
  targetMonthlyNominalGdpMinor: number;
  explicitCompanyValueAddedMinor: number;
  sectorCohortValueAddedMinor: number;
  publicOtherValueAddedMinor: number;
  logisticsValueAddedMinor: number;
  productionApproachMinor: number;
  incomeApproachMinor: number;
  expenditureApproachMinor: number;
  householdConsumptionMinor: number;
  investmentMinor: number;
  governmentConsumptionMinor: number;
  inventoryChangeMinor: number;
  netExportsMinor: number;
  reconciliationGapMinor: number;
  targetUnemploymentBps: number;
  currentUnemploymentBps: number;
  targetTradeToGdpBps: number;
  actualTradeToGdpBps: number;
  targetDebtToGdpBps: number;
  actualDebtToGdpBps: number;
  bankAssetsToGdpBps: number;
  creditToGdpBps: number;
  initializedAtMonth: number;
  withinTolerance: boolean;
  warning: string | null;
  coverage: Record<string, BaselineCoverageStatus>;
}

export interface TradeSectorState {
  id: string;
  countryId: string;
  bankId: string;
  firmCountEquivalent: number;
  exportCapacityUsdMinor: number;
  importBudgetUsdMinor: number;
  reliabilityBps: number;
  lastExportRevenueUsdMinor: number;
  lastImportCostUsdMinor: number;
  tradeFinanceLiabilityUsdMinor: number;
  tradeCalibrationFactorBps: number;
}

export interface LogisticsSectorState {
  id: string;
  countryId: string;
  bankId: string;
  capacityMilliUnits: number;
  revenueUsdMinor: number;
  profitUsdMinor: number;
  employmentEquivalent: number;
  fuelDemandMilliUnits: number;
}

export interface BankingSectorCohort {
  id: string;
  countryId: string;
  bankId: string;
  bankCountEquivalent: number;
  assetsMinor: number;
  loansMinor: number;
  depositsMinor: number;
  capitalMinor: number;
  liquidityMinor: number;
}

export type SovereignHolderType = "DOMESTIC_BANKS" | "DOMESTIC_FUNDS" | "HOUSEHOLDS" | "FOREIGN_INVESTORS" | "CENTRAL_BANK" | "OTHER_INSTITUTIONS";

export interface SovereignHolderCohort {
  id: string;
  countryId: string;
  bankId: string;
  holderType: SovereignHolderType;
  targetShareBps: number;
}

export interface RealWorldInitializationReport extends CountryScaleReconciliation {
  baselineYear: number;
  sourceDate: string;
}

export interface GlobalCommodityDefinition {
  id: string;
  name: string;
  category: GlobalCommodityCategory;
  unit: string;
  linkedGoodId: string | null;
  benchmarkCurrencyId: string;
  baseSpotPriceMinor: number;
  storable: boolean;
  energyContentBps: number;
}

export interface CommodityMarketState {
  commodityId: string;
  spotPriceUsdMinor: number;
  previousSpotPriceUsdMinor: number;
  globalProductionMilliUnits: number;
  globalConsumptionMilliUnits: number;
  globalInventoryMilliUnits: number;
  monthlyVolumeMilliUnits: number;
  shortageBps: number;
}

export interface ResourceDeposit {
  id: string;
  countryId: string;
  commodityId: string;
  provenReservesMilliUnits: number;
  extractableReservesMilliUnits: number;
  monthlyCapacityMilliUnits: number;
  extractionCostUsdMinor: number;
  infrastructureBps: number;
  technologyBps: number;
  depletionBps: number;
  active: boolean;
  sourceType: BaselineSourceType;
}

export interface CountryCommodityState {
  countryId: string;
  commodityId: string;
  productionMilliUnits: number;
  consumptionMilliUnits: number;
  inventoryMilliUnits: number;
  domesticDemandMilliUnits: number;
  importDemandMilliUnits: number;
  exportSupplyMilliUnits: number;
  marginalCostUsdMinor: number;
  householdDemandMilliUnits: number;
  industrialDemandMilliUnits: number;
  investmentDemandMilliUnits: number;
  resourceDemandMilliUnits: number;
}

export interface EnergyBalance {
  countryId: string;
  elapsedMonth: number;
  productionBySourceMilliUnits: Record<string, number>;
  consumptionBySourceMilliUnits: Record<string, number>;
  importsMilliUnits: number;
  exportsMilliUnits: number;
  strategicReserveMilliUnits: number;
  unmetDemandMilliUnits: number;
}

export type FreightMode = "sea" | "rail" | "road" | "air";

export interface TradeRoute {
  id: string;
  originCountryId: string;
  destinationCountryId: string;
  mode: FreightMode;
  capacityMilliUnits: number;
  usedCapacityMilliUnits: number;
  costUsdMinorPerUnit: number;
  transitDays: number;
  active: boolean;
  conflictDamageBps?: number;
  reconstructionBacklogMinor?: number;
}

export interface PortNode {
  id: string;
  countryId: string;
  name: string;
  annualCapacityMilliUnits: number;
  congestionBps: number;
}

export interface TradeFlow {
  id: string;
  elapsedMonth: number;
  exporterCountryId: string;
  importerCountryId: string;
  exporterId: string;
  importerId: string;
  commodityId: string;
  quantityMilliUnits: number;
  unitPriceUsdMinor: number;
  invoiceCurrencyId: string;
  invoiceValueMinor: number;
  routeId: string;
  transportCostUsdMinor: number;
  tradeCostUsdMinor: number;
  landedUnitCostUsdMinor: number;
  logisticsProviderId: string;
  logisticsPaymentTransactionId: string | null;
  tariffUsdMinor: number;
  paymentTransactionIds: string[];
  fxTradeId: string | null;
  status: "settled" | "unpaid" | "capacity-constrained";
}

export interface PhysicalCommodityFlow {
  countryId: string;
  commodityId: string;
  elapsedMonth: number;
  openingStockMilliUnits: number;
  productionMilliUnits: number;
  importsMilliUnits: number;
  householdConsumptionMilliUnits: number;
  industrialUseMilliUnits: number;
  exportsMilliUnits: number;
  closingStockMilliUnits: number;
  conservationGapMilliUnits: number;
}

export interface StrategicReserve {
  id: string;
  countryId: string;
  commodityId: string;
  inventoryMilliUnits: number;
  targetMonthsOfConsumptionBps: number;
  lastAction: "buy" | "release" | "hold";
}

export interface InputOutputCoefficient {
  outputSectorId: string;
  inputCommodityId: string;
  requiredMilliUnitsPerOutputUnit: number;
}

export interface CountrySectorInventory {
  countryId: string;
  sectorId: string;
  inputCommodityId: string;
  inventoryMilliUnits: number;
  requiredMilliUnits: number;
  shortageBps: number;
}

export interface BalanceOfPaymentsRecord {
  countryId: string;
  elapsedMonth: number;
  goodsExportsUsdMinor: number;
  goodsImportsUsdMinor: number;
  servicesBalanceUsdMinor: number;
  primaryIncomeBalanceUsdMinor: number;
  secondaryIncomeBalanceUsdMinor: number;
  currentAccountUsdMinor: number;
  capitalAccountUsdMinor: number;
  directInvestmentNetInflowUsdMinor: number;
  portfolioNetInflowUsdMinor: number;
  otherInvestmentNetInflowUsdMinor: number;
  tradeFinanceNetInflowUsdMinor: number;
  financialAccountUsdMinor: number;
  reserveChangeUsdMinor: number;
  errorsAndOmissionsUsdMinor: number;
  reconciliationGapUsdMinor: number;
  reconciliationWarning: boolean;
  causeFlowIds: string[];
}

export interface ExternalClaim {
  id: string;
  creditorCountryId: string;
  debtorCountryId: string;
  ownerId: string;
  obligorId: string;
  currencyId: string;
  valueUsdMinor: number;
  sourceFlowId: string;
  createdAtMonth: number;
  kind: "TRADE_RECEIVABLE" | "DEPOSIT" | "SECURITY" | "BANK_CLAIM";
}

export interface InternationalInvestmentPosition {
  countryId: string;
  elapsedMonth: number;
  directInvestmentAssetsUsdMinor: number;
  directInvestmentLiabilitiesUsdMinor: number;
  portfolioAssetsUsdMinor: number;
  portfolioLiabilitiesUsdMinor: number;
  otherInvestmentAssetsUsdMinor: number;
  otherInvestmentLiabilitiesUsdMinor: number;
  reserveAssetsUsdMinor: number;
  netInternationalInvestmentPositionUsdMinor: number;
  publicExternalDebtUsdMinor: number;
  privateExternalDebtUsdMinor: number;
  shortTermExternalDebtUsdMinor: number;
}

export interface ForeignDirectInvestment {
  id: string;
  investorCountryId: string;
  destinationCountryId: string;
  parentCompanyId: string;
  subsidiaryCompanyId: string;
  currencyId: string;
  investedAmountMinor: number;
  votingShareBps: number;
  openedAtMonth: number;
  transactionIds: string[];
  status: "active" | "divested";
}

export interface InternationalPortfolioPosition {
  id: string;
  ownerId: string;
  ownerCountryId: string;
  issuerCountryId: string;
  instrumentType: "equity" | "corporate-bond" | "sovereign-bond";
  instrumentId: string;
  quantity: number;
  acquisitionValueMinor: number;
  currencyId: string;
  openedAtMonth: number;
}

export interface CrossBorderLoanExposure {
  id: string;
  lenderId: string;
  lenderCountryId: string;
  borrowerId: string;
  borrowerCountryId: string;
  currencyId: string;
  originalPrincipalMinor: number;
  remainingPrincipalMinor: number;
  annualRateBps: number;
  maturityMonth: number;
  reportingValueUsdMinor: number;
  borrowerCurrencyBurdenMinor: number;
  transactionIds: string[];
  openedAtMonth: number;
  lastServicedMonth: number;
  principalRepaidMinor: number;
  interestPaidMinor: number;
  accruedInterestMinor: number;
  arrearsMinor: number;
  missedPayments: number;
  rolloverCount: number;
  borrowerType: "bank" | "firm" | "trade-sector" | "government";
  status: "active" | "arrears" | "repaid" | "defaulted" | "restructured";
}

export interface SovereignArrear {
  id: string;
  bondId: string;
  governmentId: string;
  holderId: string;
  currencyId: string;
  unpaidCouponMinor: number;
  unpaidPrincipalMinor: number;
  openedAtMonth: number;
  monthsOutstanding: number;
  status: "outstanding" | "restructured" | "paid" | "written-down";
}

export interface SovereignDebtBridge {
  countryId: string;
  elapsedMonth: number;
  openingDebtMinor: number;
  primaryDeficitMinor: number;
  interestContributionMinor: number;
  newIssuanceMinor: number;
  principalRepaymentMinor: number;
  restructuringHaircutMinor: number;
  arrearsChangeMinor: number;
  otherAdjustmentMinor: number;
  closingDebtMinor: number;
}

export interface ReservePortfolio {
  centralBankId: string;
  countryId: string;
  accountIdsByCurrency: Record<string, string>;
  targetWeightsBps: Record<string, number>;
  goldUsdMinor: number;
  sdrUsdMinor: number;
  totalUsdMinor: number;
}

export interface FxRegimeState {
  countryId: string;
  regime: "FLOATING" | "MANAGED_FLOAT" | "PEG";
  anchorCurrencyId: string;
  targetRatePpm: number;
  bandBps: number;
  defenseCapacityUsdMinor: number;
  status: "stable" | "under-pressure" | "failed";
}

export interface FxPressurePoint {
  countryId: string;
  elapsedMonth: number;
  tradePressureUsdMinor: number;
  capitalFlowPressureUsdMinor: number;
  rateDifferentialBps: number;
  interventionUsdMinor: number;
  netPressureUsdMinor: number;
  causeIds: string[];
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
  globalInputConstraintBps: number;
  baselineFinancials?: {
    revenueMinor: number;
    profitMinor: number;
    assetsMinor: number;
    debtMinor: number;
    cashMinor: number;
    employees: number;
    marketCapMinor: number | null;
    sourceType: BaselineCoverageStatus;
  } | null;
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
  baselineFinancials?: {
    assetsMinor: number;
    loansMinor: number;
    depositsMinor: number;
    capitalMinor: number;
    liquidityMinor: number;
    sourceType: BaselineCoverageStatus;
  } | null;
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
  structuralNominalGdpMinor: number;
  gdpDeflatorBps: number;
}

export interface LongRunCountryPoint {
  countryId: string;
  elapsedMonth: number;
  structuralNominalGdpMinor: number;
  actualNominalGdpMinor: number;
  actualRealGdpMinor: number;
  gdpDeflatorBps: number;
  nominalGdpGrowthBps: number;
  realGdpGrowthBps: number;
  population: number;
  householdIncomeMinor: number;
  householdConsumptionMinor: number;
  householdSavingsMinor: number;
  householdTaxesMinor: number;
  firmRevenueMinor: number;
  firmWagesMinor: number;
  firmProfitMinor: number;
  corporateTaxesMinor: number;
  investmentMinor: number;
  governmentRevenueMinor: number;
  governmentPrimarySpendingMinor: number;
  governmentInterestMinor: number;
  debtMinor: number;
  effectiveDebtRateBps: number;
  marginalDebtRateBps: number;
  averageMaturityMonths: number;
  wagesToGdpBps: number;
  profitsToGdpBps: number;
  consumptionToGdpBps: number;
  investmentToGdpBps: number;
  revenueToGdpBps: number;
  primarySpendingToGdpBps: number;
  interestToGdpBps: number;
  debtToGdpBps: number;
  creditToGdpBps: number;
  bankCapitalMinor: number;
  unemploymentBps: number;
  inflationBps: number;
  activeCompanies: number;
  representedFirms: number;
}

export interface LongRunWarning {
  id: string;
  countryId: string;
  elapsedMonth: number;
  severity: "warning" | "failure";
  code: string;
  reason: string;
  evidence: Record<string, number>;
}

export interface LongRunDiagnosticsState {
  points: LongRunCountryPoint[];
  warnings: LongRunWarning[];
  lastRecordedMonth: number;
}

export type DefenseIndustryCategory = "ground" | "aerospace" | "naval" | "electronics" | "munitions" | "logistics" | "communications";
export type DefenseCapabilityDomain = "land" | "air" | "naval" | "airDefense" | "logistics" | "cyberCommunications";
export interface DefenseIndustrySector {
  id: string; countryId: string; category: DefenseIndustryCategory; supplierCohortId: string;
  capacityMinor: number; utilizedCapacityBps: number; technologyBps: number; inputAvailabilityBps: number; importDependencyBps: number; expansionMonthsRemaining: number;
  civilianCapacityTransferredMinor?: number;
  researchProgressMinor?: number;
}
export interface DefenseDomainState {
  domain: DefenseCapabilityDomain; grossCapitalMinor: number; serviceableCapitalMinor: number; unavailableCapitalMinor: number;
  personnelShareBps: number; maintenanceRequirementMinor: number; technologyBps: number; readinessBps: number; supplyDependencyBps: number;
}
export interface DefenseCountryState {
  countryId: string; targetSpendingToGdpBps: number;
  personnelSpendingMinor: number; procurementSpendingMinor: number; operationsMaintenanceMinor: number; researchSpendingMinor: number; infrastructureSpendingMinor: number;
  activePersonnel: number; reservePersonnel: number; supportPersonnel: number; reserveActivationCapacity: number; industrialConversionCapacityBps: number;
  equipmentStockMinor: number; munitionsStockMinor: number; fuelStockMinor: number; sparePartsStockMinor: number; medicalLogisticsStockMinor: number;
  readinessBps: number; equipmentConditionBps: number; trainingBps: number; logisticsReadinessBps: number; importDependencyBps: number;
  capabilitiesBps: Record<DefenseCapabilityDomain, number>; lastCauseCodes: string[];
  mobilizedPersonnel?: number; personnelRequiredCostMinor?: number; payrollCoverageBps?: number;
  requiredMaintenanceMinor?: number; maintenanceCoverageBps?: number; maintenanceBacklogMinor?: number;
  serviceableEquipmentMinor?: number; unavailableEquipmentMinor?: number; retiredEquipmentMinor?: number; averageEquipmentAgeMonths?: number;
  infrastructureStockMinor?: number; infrastructureConditionBps?: number; researchProgressMinor?: number;
  domainStates?: DefenseDomainState[]; baselineTargetSpendingToGdpBps?: number;
}
export interface DefenseAidTransfer { id: string; donorCountryId: string; recipientCountryId: string; elapsedMonth: number; equipmentMinor: number; suppliesMinor: number; fundingMinor: number; transactionId: string | null; }
export interface SecurityAlliance { id: string; memberCountryIds: string[]; defenseCooperationBps: number; accessBps: number; mutualSupportCommitmentBps: number; }
export interface DefenseEconomyState { countries: DefenseCountryState[]; industries: DefenseIndustrySector[]; aidTransfers: DefenseAidTransfer[]; alliances: SecurityAlliance[]; nextAidId: number; }

export type ConflictStatus = "proposed" | "approved" | "rejected" | "mobilizing" | "active" | "ceasefire" | "negotiation" | "settled" | "terminated";
export interface ArmedConflict {
  id: string; participantCountryIds: string[]; initiatorCountryId: string; defenderCountryId: string; startMonth: number; endMonth: number | null;
  objective: "defend" | "coerce" | "secure-access" | "limited-political"; scope: string; intensityBps: number; status: ConflictStatus;
  mobilizationByCountry: Record<string, number>; industrialConversionBpsByCountry: Record<string, number>; militaryLossesByCountry: Record<string, number>;
  equipmentLossMinorByCountry: Record<string, number>; capitalDamageMinorByCountry: Record<string, number>; tradeDisruptionBpsByCountry: Record<string, number>;
  fiscalCostMinorByCountry: Record<string, number>; civilianConsumptionLossMinorByCountry: Record<string, number>; continuationPressureBpsByCountry: Record<string, number>; causeCodes: string[];
  proposalMonth?: number; approvedMonth?: number | null; ceasefireMonth?: number | null; negotiationMonth?: number | null;
  decisionScoreBps?: number; expectedCostBps?: number; allianceRiskBps?: number; monthsInStatus?: number;
}
export interface ConflictState { conflicts: ArmedConflict[]; nextConflictId: number; }

export interface CountryEconomicPeriod {
  countryId: string;
  currencyId: string;
  elapsedMonth: number;
  status: "open" | "closed";
  production: { grossOutputMinor: number; intermediateConsumptionMinor: number; valueAddedMinor: number; explicitValueAddedMinor: number; cohortValueAddedMinor: number; publicOtherValueAddedMinor: number };
  expenditure: { householdConsumptionMinor: number; privateInvestmentMinor: number; governmentConsumptionMinor: number; governmentInvestmentMinor: number; exportsMinor: number; importsMinor: number; inventoryChangeMinor: number; gdpMinor: number };
  income: { employeeCompensationMinor: number; operatingSurplusMinor: number; mixedIncomeMinor: number; taxesOnProductionNetMinor: number; propertyIncomeMinor: number; gdpMinor: number };
  fiscal: { openingCashMinor: number; personalTaxMinor: number; corporateTaxMinor: number; consumptionTaxMinor: number; tariffsMinor: number; propertyOtherTaxMinor: number; otherRevenueMinor: number; soeDividendsMinor: number; consumptionMinor: number; investmentMinor: number; transfersMinor: number; subsidiesMinor: number; interestMinor: number; bondIssuanceMinor: number; loanFinancingMinor: number; otherFinancingMinor: number; principalRepaymentMinor: number; closingCashMinor: number; primaryBalanceMinor: number; overallBalanceMinor: number; cashGapMinor: number; cashGapBps: number };
  external: { reportingCurrencyId: "USD"; goodsExportsMinor: number; goodsImportsMinor: number; servicesExportsMinor: number; servicesImportsMinor: number; primaryIncomeReceivedMinor: number; primaryIncomePaidMinor: number; transfersReceivedMinor: number; transfersPaidMinor: number; fdiAssetsMinor: number; fdiLiabilitiesMinor: number; portfolioAssetsMinor: number; portfolioLiabilitiesMinor: number; crossBorderLoanAssetsMinor: number; crossBorderLoanLiabilitiesMinor: number; bankFlowsMinor: number; reserveChangeMinor: number; currentAccountMinor: number; financialAccountMinor: number; reconciliationGapMinor: number };
  financial: { openingGrossDebtMinor: number; newIssuanceMinor: number; newArrearsMinor: number; principalRepaymentMinor: number; haircutsMinor: number; writeOffsMinor: number; closingGrossDebtMinor: number; debtBridgeGapMinor: number; debtBridgeGapBps: number };
  labour: { explicitEmployment: number; cohortEmployment: number; labourForce: number; employeeCompensationPaidMinor: number; employeeCompensationReceivedMinor: number; wageGapMinor: number };
  reconciliation: { productionGdpMinor: number; expenditureGdpMinor: number; incomeGdpMinor: number; productionExpenditureGapMinor: number; productionIncomeGapMinor: number; productionExpenditureGapBps: number; productionIncomeGapBps: number };
}

export interface HouseholdCohortMonthlyAccount {
  cohortId: string; countryId: string; elapsedMonth: number; status: "open" | "closed";
  openingFinancialPositionMinor: number; labourIncomeMinor: number; capitalIncomeMinor: number; transfersReceivedMinor: number; personalTaxesMinor: number; otherTaxesMinor: number; disposableIncomeMinor: number; consumptionMinor: number; savingsMinor: number; debtBorrowingMinor: number; debtRepaymentMinor: number; financialInvestmentMinor: number; budgetGapMinor: number; budgetGapBps: number;
}

export interface FirmCohortMonthlyAccount {
  cohortId: string; countryId: string; elapsedMonth: number; status: "open" | "closed";
  revenueMinor: number; intermediateInputExpenseMinor: number; wagesMinor: number; interestMinor: number; taxesMinor: number; otherOperatingExpenseMinor: number; profitMinor: number; investmentMinor: number; borrowingMinor: number; debtRepaymentMinor: number; dividendsMinor: number; pnlGapMinor: number; pnlGapBps: number;
}

export interface SectorRepresentation {
  countryId: string; sectorId: string; baselineTargetMinor: number; explicitRepresentationMinor: number; explicitCarveOutMinor: number; residualTargetMinor: number; representedTotalMinor: number; representedShareBps: number;
}

export interface CountryEconomicAccountsState {
  currentByCountry: Record<string, CountryEconomicPeriod>;
  closedByCountry: Record<string, CountryEconomicPeriod>;
  history: CountryEconomicPeriod[];
  hotHistoryMonths: number;
  householdAccounts: HouseholdCohortMonthlyAccount[];
  firmAccounts: FirmCohortMonthlyAccount[];
  representations: SectorRepresentation[];
}

export type GeoeconomicPolicyKind =
  | "tariff"
  | "trade-agreement"
  | "export-control"
  | "sanction"
  | "financial-restriction"
  | "asset-freeze"
  | "foreign-aid"
  | "sovereign-lending"
  | "investment-screening"
  | "industrial-policy"
  | "capital-control";

export interface StrategicInterest {
  countryId: string;
  energySecurityBps: number;
  exportAccessBps: number;
  technologyAccessBps: number;
  financialStabilityBps: number;
  fiscalSpaceBps: number;
  updatedAtMonth: number;
}

export interface DirectionalDependency {
  sourceCountryId: string;
  targetCountryId: string;
  tradeDependencyBps: number;
  importDependencyBps: number;
  financeDependencyBps: number;
  strategicDependencyBps: number;
  updatedAtMonth: number;
}

export interface GeoeconomicPolicy {
  id: string;
  actorCountryId: string;
  targetCountryIds: string[];
  kind: GeoeconomicPolicyKind;
  commodityIds: string[];
  rateBps: number;
  accessPenaltyBps: number;
  startsAtMonth: number;
  endsAtMonth: number | null;
  status: "active" | "expired" | "revoked";
  retaliationOfId: string | null;
  transactionIds: string[];
}

export interface TradeAgreement {
  id: string;
  name: string;
  memberCountryIds: string[];
  tariffReductionBps: number;
  investmentAccessBonusBps: number;
  startsAtMonth: number;
  endsAtMonth: number | null;
  status: "active" | "suspended" | "expired";
}

export interface EconomicBloc {
  id: string;
  name: string;
  memberCountryIds: string[];
  coordinationBps: number;
}

export interface StateOwnedEnterpriseMandate {
  companyId: string;
  countryId: string;
  stateOwnershipBps: number;
  mandate: "energy-security" | "infrastructure" | "finance" | "technology";
  softBudgetConstraintBps: number;
}

export interface IndustrialPolicyProgram {
  id: string;
  countryId: string;
  beneficiaryCompanyId: string;
  commodityId: string;
  monthlyBudgetMinor: number;
  startsAtMonth: number;
  endsAtMonth: number | null;
  status: "active" | "paused" | "completed";
  transactionIds: string[];
}

export interface SovereignLendingFacility {
  id: string;
  lenderCountryId: string;
  borrowerCountryId: string;
  currencyId: string;
  limitMinor: number;
  drawnMinor: number;
  annualRateBps: number;
  maturityMonths: number;
  status: "open" | "suspended" | "closed";
  transactionIds: string[];
}

export interface GeoeconomicDecisionTrace {
  id: string;
  actorCountryId: string;
  elapsedMonth: number;
  decision: string;
  targetCountryIds: string[];
  inputs: Record<string, number | string | boolean>;
  reasons: string[];
  evidenceIds: string[];
  outcome: "adopted" | "rejected" | "retaliated" | "expired";
}

export interface GeoeconomicsState {
  strategicInterests: StrategicInterest[];
  directionalDependencies: DirectionalDependency[];
  policies: GeoeconomicPolicy[];
  tradeAgreements: TradeAgreement[];
  blocs: EconomicBloc[];
  soeMandates: StateOwnedEnterpriseMandate[];
  industrialPolicyPrograms: IndustrialPolicyProgram[];
  sovereignLendingFacilities: SovereignLendingFacility[];
  decisionTraces: GeoeconomicDecisionTrace[];
  nextPolicyId: number;
  nextDecisionTraceId: number;
  nextProgramId: number;
  nextFacilityId: number;
}

export type InstitutionType = "executive" | "legislature" | "judiciary" | "regulator" | "tax-authority" | "procurement-authority";

export interface InstitutionalActor {
  id: string;
  countryId: string;
  type: InstitutionType;
  capacityBps: number;
  independenceBps: number;
  integrityBps: number;
  accountabilityBps: number;
}

export interface StateCapacityProfile {
  countryId: string;
  administrativeCapacityBps: number;
  fiscalCapacityBps: number;
  enforcementCapacityBps: number;
  procurementCapacityBps: number;
  policyCredibilityBps: number;
  politicalRiskBps: number;
  updatedAtMonth: number;
}

export interface InterestGroup {
  id: string;
  countryId: string;
  type: "labour" | "business" | "finance" | "regional" | "state-enterprise";
  memberEntityIds: string[];
  resourcesMinor: number;
  influenceBps: number;
  preferredPolicy: string;
  lobbyingTransactionIds: string[];
}

export interface PolicyProposal {
  id: string;
  countryId: string;
  sponsorInstitutionId: string;
  topic: "tax-compliance" | "procurement" | "banking" | "industrial-policy" | "labour-formalization";
  proposedAtMonth: number;
  supportBps: number;
  captureRiskBps: number;
  status: "proposed" | "adopted" | "rejected" | "expired";
  coalitionId: string | null;
}

export interface PoliticalCoalition {
  id: string;
  countryId: string;
  proposalId: string;
  supporterIds: string[];
  opponentIds: string[];
  supportBps: number;
  formedAtMonth: number;
}

export interface ProcurementContract {
  id: string;
  countryId: string;
  authorityId: string;
  supplierId: string;
  corruptionNetworkId: string | null;
  grossAmountMinor: number;
  deliveredValueMinor: number;
  leakageMinor: number;
  elapsedMonth: number;
  transactionIds: string[];
  status: "awarded" | "paid" | "cancelled";
}

export interface CorruptionNetwork {
  id: string;
  countryId: string;
  memberEntityIds: string[];
  captureBps: number;
  hiddenBalanceMinor: number;
  detectedLossMinor: number;
  transactionIds: string[];
}

export interface ShadowEconomyAccount {
  countryId: string;
  elapsedMonth: number;
  trueOutputMinor: number;
  officialOutputMinor: number;
  hiddenOutputMinor: number;
  trueEmployment: number;
  officialEmployment: number;
  informalEmployment: number;
  assessedTaxMinor: number;
  collectedTaxMinor: number;
  taxGapMinor: number;
  intermediateInputsMinor?: number;
  informalWagesMinor?: number;
  undeclaredProfitMinor?: number;
  informalConsumptionMinor?: number;
  transactionIds?: string[];
}

export interface ComplianceProfile {
  countryId: string;
  taxComplianceBps: number;
  labourComplianceBps: number;
  financialComplianceBps: number;
  beneficialOwnershipTransparencyBps: number;
  updatedAtMonth: number;
}

export interface ConnectedLendingRelationship {
  id: string;
  countryId: string;
  bankId: string;
  borrowerCompanyId: string;
  connectionBps: number;
  preferentialSpreadBps: number;
  loanIds: string[];
  status: "active" | "exposed" | "closed";
}

export interface SoeGovernanceRecord {
  companyId: string;
  countryId: string;
  boardIndependenceBps: number;
  disclosureBps: number;
  politicalAppointmentsBps: number;
  softBudgetConstraintBps: number;
  subsidyTransactionIds: string[];
}

export interface ZombieFirmRecord {
  companyId: string;
  countryId: string;
  lossMonths: number;
  debtServiceCoverageBps: number;
  supportDependencyBps: number;
  recognizedAtMonth: number;
  status: "watch" | "zombie" | "restructured" | "resolved";
}

export interface PoliticalEconomyDecisionTrace {
  id: string;
  countryId: string;
  elapsedMonth: number;
  decision: string;
  actorIds: string[];
  inputs: Record<string, number | string | boolean>;
  reasons: string[];
  transactionIds: string[];
  outcome: string;
}

export interface PoliticalEconomyState {
  institutions: InstitutionalActor[];
  stateCapacity: StateCapacityProfile[];
  interestGroups: InterestGroup[];
  policyProposals: PolicyProposal[];
  coalitions: PoliticalCoalition[];
  procurementContracts: ProcurementContract[];
  corruptionNetworks: CorruptionNetwork[];
  shadowEconomy: ShadowEconomyAccount[];
  compliance: ComplianceProfile[];
  connectedLending: ConnectedLendingRelationship[];
  soeGovernance: SoeGovernanceRecord[];
  zombieFirms: ZombieFirmRecord[];
  decisionTraces: PoliticalEconomyDecisionTrace[];
  nextProposalId: number;
  nextCoalitionId: number;
  nextProcurementId: number;
  nextDecisionTraceId: number;
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

export interface CountryEconomicProfile {
  countryId: string;
  baseYear: number;
  population: number;
  workingAgeShareBps: number;
  populationGrowthBps: number;
  dependencyRatioBps: number;
  baselineNominalGdpMinor: number;
  baselineRealGdpIndexBps: number;
  inflationBps: number;
  unemploymentBps: number;
  governmentDebtToGdpBps: number;
  budgetBalanceToGdpBps: number;
  averageDebtMaturityMonths: number;
  monetaryAreaId: string;
  incomeLevel: "upper-middle" | "high";
  householdDebtToGdpBps: number;
  privateCreditToGdpBps: number;
  industryWeightsBps: Record<string, number>;
  taxProfile: {
    incomeTaxBps: number;
    consumptionTaxBps: number;
    corporateTaxBps: number;
    propertyTaxBps: number;
  };
  governmentSpendingShareBps: number;
  publicInvestmentShareBps: number;
  educationSpendingShareBps: number;
  savingsRateBps: number;
  housingCostIndexBps: number;
  housingVacancyBps: number;
  productivityIndexBps: number;
  bankingDepthBps: number;
  bankConcentrationBps: number;
  depositInsuranceCoverageMinor: number;
  metadata: BaselineMetadata;
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
  incomeBand: "low" | "middle" | "affluent" | "wealthy";
  householdType: "single" | "couple" | "family";
  populationCount: number;
  employedCount: number;
  averageMonthlyIncomeCents: number;
  wealthDistribution: { medianCents: number; p90Cents: number };
  skillDistribution: Record<SkillId, { mean: number; spread: number }>;
  consumptionPreferencesBps: Record<ConsumptionCategory, number>;
  housingDistributionBps: Record<string, number>;
  bankingDistributionBps: Record<string, number>;
  aggregateWealthCents: number;
  aggregateDebtCents: number;
  creditAccessBps: number;
  savingsRateBps: number;
  priceSensitivityBps: number;
  durableStock: { installedUnits: number; averageAgeMonths: number; replacementRateBps: number; premiumShareBps: number };
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
  populationEquivalent: number;
  firmCountEquivalent: number;
  outputScaleBps: number;
  valueAddedMinor: number;
  intermediateConsumptionMinor: number;
}

export interface CalibratedParameterSet {
  consumptionIncomeElasticityBps: number;
  investmentRateSensitivityBps: number;
  priceAdjustmentSpeedBps: number;
  wageAdjustmentSpeedBps: number;
  creditDemandSensitivityBps: number;
  employmentAdjustmentSpeedBps: number;
  firmEntryExitSpeedBps: number;
  governmentCommitmentAdjustmentBps: number;
  taxComplianceResponseBps: number;
  productivityGrowthResponseBps: number;
}

export type PolicyInterventionMode = "RATE_SHOCK" | "RATE_PATH" | "POLICY_RULE_SHIFT";

export interface PolicyIntervention {
  id: string;
  countryId: string;
  targetCentralBankId: string;
  startMonth: number;
  durationMonths: number;
  mode: PolicyInterventionMode;
  valueBps: number;
  ratePathBps: number[];
  baselineRateBps: number;
}

export interface MacroContributionEvent {
  id: string;
  countryId: string;
  elapsedMonth: number;
  channel: "POLICY_TO_FUNDING" | "FUNDING_TO_CREDIT" | "CREDIT_TO_INVESTMENT" | "INVESTMENT_TO_DEMAND" | "DEMAND_TO_GDP" | "TRADE_TO_GDP" | "FX_TO_PRICES";
  fromMetric: string;
  toMetric: string;
  contribution: number;
  evidenceIds: string[];
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
  ledgerCompactedTransactions: number;
  estimatedSaveBytes: number;
  activeDerivativeContracts: number;
  activeMarketOrders: number;
  historyRecordCount: number;
  memoryPressure: "normal" | "elevated" | "high";
  saveBreakdown: SaveSizeBreakdown;
  deterministicWorkUnits: number;
}

export interface SaveSizeBreakdown {
  totalBytes: number;
  ledgerBytes: number;
  marketsBytes: number;
  historyBytes: number;
  derivativesBytes: number;
  companiesBytes: number;
  populationBytes: number;
  sovereignBytes: number;
  otherBytes: number;
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
  experience: PlayerExperienceState;
  reputation: PlayerReputationState;
  interfacePreferences: PlayerInterfacePreferences;
}

export type FeatureAccessState = "UNDISCOVERED" | "DISCOVERED_LOCKED" | "VISIBLE" | "ACTIONABLE";

export interface PlayerExperienceEvent {
  id: string;
  elapsedMonth: number;
  actionId: string;
  xp: number;
  reason: string;
}

export interface PlayerExperienceState {
  level: number;
  currentXp: number;
  lifetimeXp: number;
  xpEvents: PlayerExperienceEvent[];
  unlockedFeatures: string[];
  discoveredFeatures: string[];
  actionCounts: Record<string, number>;
  completedMilestones: string[];
  pendingLevelUp: number | null;
}

export interface ReputationEvent {
  id: string;
  elapsedMonth: number;
  delta: number;
  event: string;
  reason: string;
}

export interface PlayerReputationState {
  score: number;
  history: ReputationEvent[];
}

export interface PlayerInterfacePreferences {
  progressiveInterface: boolean;
  showLockedSections: boolean;
  fullInterface: boolean;
  developerTrueState: boolean;
  completedTutorialIds: string[];
  skippedTutorials: boolean;
}

export type InformationSourceType = "PUBLIC_STATISTICS" | "COMPANY_REPORT" | "MARKET_PRICE" | "BANK_INTERNAL_DATA" | "COMPANY_INTERNAL_DATA" | "GOVERNMENT_INTERNAL_DATA" | "REGULATORY_DATA" | "TRADE_DATA" | "SATELLITE_SENSOR_ESTIMATE" | "INTELLIGENCE_ESTIMATE" | "NEWS_PUBLIC_REPORT";
export type InformationStatus = "OBSERVED" | "ESTIMATED" | "STALE" | "INTERNAL" | "PUBLIC" | "UNKNOWN" | "NO_ACCESS";
export type InformationConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface InformationSource {
  id: string;
  type: InformationSourceType;
  ownerId: string | null;
  delayMonths: number;
  accuracyBps: number;
  biasBps: number;
  reliabilityBps: number;
  costMinor: number;
  scope: string[];
  access: "PUBLIC" | "OWNER" | "GOVERNMENT" | "DILIGENCE";
}

export interface ObservedMetric {
  id: string;
  metricId: string;
  subjectId: string;
  observedValue: number;
  confidence: InformationConfidence;
  confidenceBps: number;
  observationMonth: number;
  releaseMonth: number;
  informationAge: number;
  sourceIds: string[];
  qualityBps: number;
  status: InformationStatus;
  lowerBound: number;
  upperBound: number;
  revisionOfId: string | null;
}

export interface BeliefMetric extends ObservedMetric {
  agentId: string;
  priorValue: number | null;
  updatedAtMonth: number;
}

export interface InformationSurprise {
  id: string;
  agentId: string;
  metricId: string;
  subjectId: string;
  expectedValue: number;
  realizedValue: number;
  magnitudeBps: number;
  elapsedMonth: number;
  cause: string;
}

export interface DecisionInformationTrace {
  id: string;
  agentId: string;
  decisionType: string;
  subjectId: string;
  elapsedMonth: number;
  observedInputIds: string[];
  beliefValues: Record<string, number>;
  confidenceBps: number;
  decision: string;
  realizedResult: number | null;
  realizedAtMonth: number | null;
}

export interface StrategicIntelligenceCapability {
  countryId: string;
  collectionBps: number;
  analysisBps: number;
  economicIntelligenceBps: number;
  militaryIntelligenceBps: number;
  counterintelligenceBps: number;
  opacityBps: number;
  monthlyCostMinor: number;
  focus: "MILITARY" | "ECONOMIC" | "FINANCIAL" | "TECHNOLOGY";
}

export interface InformationState {
  sources: InformationSource[];
  observations: ObservedMetric[];
  beliefs: BeliefMetric[];
  surprises: InformationSurprise[];
  decisionTraces: DecisionInformationTrace[];
  intelligence: StrategicIntelligenceCapability[];
  archivedSummaries: Array<{ key: string; count: number; averageSurpriseBps: number; throughMonth: number }>;
  nextObservationId: number;
  nextSurpriseId: number;
  nextTraceId: number;
  lastReleaseMonth: number;
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
  type: "founded" | "equity-raise" | "share-transfer" | "dividend" | "buyback" | "bond-issue" | "bond-repaid" | "acquisition" | "ipo" | "bankruptcy";
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
  exchangeId: string;
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
  strategyProfileId: InstitutionStrategyProfileId;
  primeBrokerIds: string[];
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
  | { kind: "credit"; obligationId: string }
  | { kind: "commodity"; commodityId: string };

export type DerivativeMotive = "FX_HEDGE" | "RATE_HEDGE" | "EQUITY_HEDGE" | "COVERED_INCOME" | "SPECULATION" | "RELATIVE_VALUE" | "FUNDING" | "SYNTHETIC_EXPOSURE" | "CREDIT_HEDGE" | "RISK_TRANSFER";

export type InstitutionStrategyProfileId = "PENSION_CONSERVATIVE" | "INDEX_FUND" | "ACTIVE_LONG_ONLY" | "HEDGE_RELATIVE_VALUE" | "HEDGE_MACRO" | "BANK_ALM" | "CORPORATE_TREASURY";

export interface DerivativeDecisionMetadata {
  motive: DerivativeMotive;
  initiatedById: string;
  strategyProfileId: InstitutionStrategyProfileId;
  targetExposureMinor: number;
  expectedBenefitMinor: number;
  expectedCostMinor: number;
  hedgeRatioBps: number;
  decisionInputs: Record<string, number | string | boolean>;
  rolledFromId?: string;
  rolledToId?: string;
}

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
  decision?: DerivativeDecisionMetadata;
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
  legacy: boolean;
  arrearsPrincipalMinor: number;
  arrearsCouponMinor: number;
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
  effectiveTaxCollectionBps: number;
  cashFinancingMinor: number;
  debtFinancingMinor: number;
  publicAdministrationTargetBps: number;
  healthcareServicesTargetBps: number;
  infrastructureMaintenanceTargetBps: number;
  socialTransferTargetBps: number;
  otherMandatoryTargetBps: number;
  mandatoryPrimarySpendingMinor: number;
  discretionaryPrimarySpendingMinor: number;
  effectiveAverageDebtRateBps: number;
  marginalNewIssueYieldBps: number;
  debtArrearsMinor: number;
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
  schemaVersion: 16;
  saveVersion: 16;
  initializationComplete: boolean;
  seed: string;
  scenario: SimulationScenario;
  baselineReference: WorldBaselineReference;
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
  countryEconomicAccounts: CountryEconomicAccountsState;
  geoeconomics: GeoeconomicsState;
  politicalEconomy: PoliticalEconomyState;
  longRunDiagnostics: LongRunDiagnosticsState;
  defenseEconomy: DefenseEconomyState;
  conflicts: ConflictState;
  occupations: Occupation[];
  player: PlayerState;
  information: InformationState;
  events: DomainEvent[];
  metricsHistory: MetricPoint[];
  countryMetricsHistory: CountryMetricPoint[];
  nextEventId: number;
  nextGoodsMovementId: number;
  nextLoanId: number;
  nextFundingId: number;
  nextCompanyId: number;
  countries: Country[];
  countryEconomicProfiles: CountryEconomicProfile[];
  monetaryAreaProfiles: MonetaryAreaEconomicProfile[];
  cities: City[];
  universities: University[];
  universityPrograms: UniversityProgram[];
  housingCohorts: HousingCohort[];
  properties: PropertyInstance[];
  products: ProductDefinition[];
  durableAssets: DurableAsset[];
  populationCohorts: PopulationCohort[];
  firmCohorts: FirmCohort[];
  countryScaleReconciliations: CountryScaleReconciliation[];
  realWorldInitializationReports: RealWorldInitializationReport[];
  tradeSectors: TradeSectorState[];
  logisticsSectors: LogisticsSectorState[];
  bankingSectorCohorts: BankingSectorCohort[];
  sovereignHolderCohorts: SovereignHolderCohort[];
  calibratedParameters: CalibratedParameterSet;
  countryCalibratedParameters: Record<string, Partial<CalibratedParameterSet>>;
  policyInterventions: PolicyIntervention[];
  macroContributionEvents: MacroContributionEvent[];
  fidelity: FidelityState;
  ledgerArchives: LedgerArchiveSegment[];
  history: HistoryState;
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
  sovereignArrears: SovereignArrear[];
  sovereignDebtBridges: SovereignDebtBridge[];
  sovereignBondHoldings: SovereignBondHolding[];
  sovereignAuctions: SovereignAuction[];
  yieldCurveHistory: YieldCurveSnapshot[];
  governmentBudgets: GovernmentBudgetState[];
  centralBankBalanceSheets: CentralBankBalanceSheetState[];
  monetaryPolicyDecisions: MonetaryPolicyDecision[];
  depositInsuranceSchemes: DepositInsuranceScheme[];
  countryMacroStates: CountryMacroState[];
  macroHistory: MacroMonthlyPoint[];
  realCompanyProfiles: RealCompanyProfile[];
  realBankProfiles: RealBankProfile[];
  companyDecisionStates: CompanyDecisionState[];
  capitalProjects: CapitalProject[];
  bankAlmStates: BankAlmState[];
  creditOffers: CreditOffer[];
  marketAgents: MarketAgentState[];
  marketMakerQuotes: MarketMakerQuote[];
  executionQuality: ExecutionQuality[];
  circuitBreakers: CircuitBreakerState[];
  arbitrageRecords: ArbitrageRecord[];
  fundFlows: FundFlow[];
  fundRedemptionRequests: FundRedemptionRequest[];
  fundPerformanceHistory: FundPerformance[];
  etfBaskets: EtfBasket[];
  etfArbitrageEvents: EtfArbitrageEvent[];
  privateEquityFunds: PrivateEquityFundState[];
  privateEquityDeals: PrivateEquityDeal[];
  acquisitionVehicles: AcquisitionVehicle[];
  mAndADeals: MAndADeal[];
  ipoProcesses: IPOProcess[];
  lockupRestrictions: LockupRestriction[];
  economicAuctions: EconomicAuction[];
  insurers: InsurerState[];
  insurancePolicies: InsurancePolicy[];
  insuranceLossEvents: InsuranceLossEvent[];
  insuranceClaims: InsuranceClaim[];
  reinsuranceTreaties: ReinsuranceTreaty[];
  causalExplanations: CausalExplanation[];
  governanceProposals: GovernanceProposal[];
  restructuringCases: RestructuringCase[];
  dataCoverageHistory: DataCoverageSnapshot[];
  globalCommodities: GlobalCommodityDefinition[];
  commodityMarkets: CommodityMarketState[];
  resourceDeposits: ResourceDeposit[];
  countryCommodityStates: CountryCommodityState[];
  energyBalances: EnergyBalance[];
  tradeRoutes: TradeRoute[];
  ports: PortNode[];
  tradeFlows: TradeFlow[];
  strategicReserves: StrategicReserve[];
  inputOutputCoefficients: InputOutputCoefficient[];
  countrySectorInventories: CountrySectorInventory[];
  physicalCommodityFlows: PhysicalCommodityFlow[];
  balanceOfPayments: BalanceOfPaymentsRecord[];
  internationalInvestmentPositions: InternationalInvestmentPosition[];
  foreignDirectInvestments: ForeignDirectInvestment[];
  internationalPortfolioPositions: InternationalPortfolioPosition[];
  crossBorderLoans: CrossBorderLoanExposure[];
  externalClaims: ExternalClaim[];
  reservePortfolios: ReservePortfolio[];
  fxRegimes: FxRegimeState[];
  fxPressureHistory: FxPressurePoint[];
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
  nextTradeFlowId: number;
  nextFdiId: number;
  nextInternationalPositionId: number;
  nextCrossBorderLoanId: number;
}

export interface InvariantResult {
  id: string;
  section: "Национальные счета" | "Бухгалтерия" | "Товары" | "Деньги" | "Валюты" | "Кредит" | "Ликвидность банков" | "Игрок" | "Население" | "География" | "Жильё" | "Образование" | "Производительность" | "Собственность" | "Рынки" | "Фонды" | "Обеспечение" | "Деривативы" | "Клиринг" | "Государственный долг" | "Денежная политика" | "Страхование";
  title: string;
  ok: boolean;
  detail: string;
  differenceCents?: number;
}
