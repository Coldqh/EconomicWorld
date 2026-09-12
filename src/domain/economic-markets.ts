export type DataFieldStatus = "OBSERVED" | "ESTIMATED" | "CALIBRATED" | "MISSING";

export interface ProfileField { valueMinor: number | null; status: DataFieldStatus }
export interface RealCompanyProfile {
  companyId: string; industry: string; homeCountryId: string; currencyId: string; baselineYear: number; sourceId: string;
  revenue: ProfileField; operatingProfit: ProfileField; netIncome: ProfileField; assets: ProfileField; debt: ProfileField;
  cash: ProfileField; employees: ProfileField; marketCapitalization: ProfileField; sharesOutstanding: ProfileField;
}
export interface RealBankProfile {
  bankId: string; homeCountryId: string; currencyId: string; baselineYear: number; sourceId: string;
  assets: ProfileField; loans: ProfileField; deposits: ProfileField; equity: ProfileField; liquidity: ProfileField;
  employees: ProfileField; marketCapitalization: ProfileField;
}

export interface CompanyDecisionState {
  companyId: string; expectedDemandMilliUnits: number; desiredInventoryMilliUnits: number; productionTargetMilliUnits: number;
  procurementBudgetMinor: number; labourDemand: number; targetPriceMinor: number; targetLeverageBps: number; liquidityBufferMinor: number;
  financingChoice: "cash" | "credit" | "bond" | "equity" | "none"; distressAction: "none" | "cut-capex" | "asset-sale" | "refinance" | "equity-raise";
  confidenceBps: number; lastDecisionMonth: number; reasons: string[];
}
export interface CapitalProject {
  id: string; companyId: string; title: string; status: "proposed" | "approved" | "construction" | "commissioned" | "cancelled";
  costMinor: number; spentMinor: number; expectedMonthlyCashFlowMinor: number; capacityAddedMilliUnits: number; constructionMonths: number;
  monthsRemaining: number; financing: "cash" | "credit" | "bond" | "equity"; proposedAtMonth: number;
}

export interface BankAlmState {
  bankId: string; reserveAssetsMinor: number; householdLoansMinor: number; corporateLoansMinor: number; interbankAssetsMinor: number;
  sovereignBondsMinor: number; corporateBondsMinor: number; securitiesMinor: number; depositsMinor: number; wholesaleFundingMinor: number;
  interbankFundingMinor: number; centralBankFundingMinor: number; issuedBondsMinor: number; liquidityGapMinor: number; maturityGapMonths: number;
  rateSensitivityMinorPer100Bps: number; currencyMismatchMinor: number; depositRateBps: number; averageAssetYieldBps: number;
  fundingCostBps: number; netInterestMarginBps: number; expectedCreditLossBps: number; profitMinor: number; lastDecisionMonth: number;
  maturityBuckets: { shortAssetsMinor: number; mediumAssetsMinor: number; longAssetsMinor: number; shortFundingMinor: number; mediumFundingMinor: number; longFundingMinor: number };
  assetsByCurrency: Record<string, number>; liabilitiesByCurrency: Record<string, number>; hedgeContractIds: string[];
}
export interface CreditOffer {
  id: string; bankId: string; borrowerId: string; amountMinor: number; annualRateBps: number; termMonths: number; riskScoreBps: number;
  expectedLossBps: number; capitalCostBps: number; status: "offered" | "accepted" | "expired" | "rejected"; createdAtMonth: number;
}

export type MarketAgentKind = "retail" | "fundamental" | "passive" | "momentum" | "market-maker" | "arbitrageur" | "hedge" | "pension" | "forced-seller";
export interface MarketAgentState { id: string; ownerId: string; kind: MarketAgentKind; exchangeIds: string[]; capitalMinor: number; riskLimitMinor: number; latencyBps: number; active: boolean }
export interface MarketMakerQuote {
  id: string; agentId: string; securityId: string; exchangeId: string; bidMinor: number; askMinor: number; bidSize: number; askSize: number;
  inventory: number; inventoryLimit: number; volatilityBps: number; adverseSelectionBps: number; elapsedMonth: number;
}
export interface ExecutionQuality { orderId: string; expectedPriceMinor: number; averagePriceMinor: number; slippageBps: number; marketImpactBps: number; filledQuantity: number }
export interface CircuitBreakerState { exchangeId: string; securityId: string; thresholdBps: number; haltedUntilMonth: number | null; referencePriceMinor: number }
export interface ArbitrageRecord { id: string; type: "cross-venue" | "fx-triangle" | "cash-and-carry" | "etf" | "merger"; agentId: string; legs: string[]; expectedProfitMinor: number; realizedProfitMinor: number; costsMinor: number; elapsedMonth: number; status: "executed" | "rejected" | "partial" }

export interface FundFlow { id: string; fundId: string; investorId: string; type: "subscription" | "redemption" | "capital-call" | "distribution"; amountMinor: number; elapsedMonth: number; transactionIds: string[] }
export interface FundRedemptionRequest { id: string; fundId: string; investorId: string; unitsMicros: number; amountDueMinor: number; status: "requested" | "liquidating" | "paid" | "failed"; sellOrderIds: string[]; requestedAtMonth: number }
export interface FundPerformance { fundId: string; elapsedMonth: number; navReturnBps: number; benchmarkReturnBps: number | null; activeReturnBps: number | null; drawdownBps: number; volatilityBps: number | null; betaBps: number | null }
export interface EtfBasket { fundId: string; creationUnitSize: number; components: Array<{ securityId: string; quantity: number }>; authorizedParticipantIds: string[] }
export interface EtfArbitrageEvent { id: string; fundId: string; authorizedParticipantId: string; type: "creation" | "redemption"; units: number; navMinor: number; marketValueMinor: number; costsMinor: number; transactionIds: string[]; elapsedMonth: number }

export interface PrivateEquityFundState {
  fundId: string; vintageYear: number; committedCapitalMinor: number; calledCapitalMinor: number; investedCapitalMinor: number; dryPowderMinor: number;
  distributedCapitalMinor: number; navMinor: number; managementFeeBps: number; carryBps: number; gpId: string; lpCommitments: Array<{ lpId: string; committedMinor: number; calledMinor: number; distributedMinor: number }>;
}
export interface AcquisitionVehicle {
  id: string; dealId: string | null; fundId: string; targetCompanyId: string; currencyId: string; bankAccountId: string;
  status: "funding" | "holding" | "exited" | "failed"; sponsorEquityMinor: number; debtMinor: number; targetShares: number;
  createdAtMonth: number; closedAtMonth: number | null; transactionIds: string[];
}
export interface PrivateEquityDeal {
  id: string; fundId: string; targetCompanyId: string; sponsorEquityMinor: number; seniorDebtMinor: number; subordinatedDebtMinor: number;
  purchaseConsiderationMinor: number; outstandingDebtMinor: number; entryMonth: number; exitMonth: number | null; exitProceedsMinor: number;
  leverageCovenantBps: number; interestCoverageCovenantBps: number; status: "sourcing" | "diligence" | "owned" | "covenant-breach" | "exited" | "failed";
  cashFlows: Array<{ elapsedMonth: number; amountMinor: number }>;
  acquisitionDealId?: string | null; acquisitionVehicleId?: string | null; acquisitionLoanIds?: string[]; investmentCommitteeScoreBps?: number;
  exitRoute?: "strategic" | "secondary" | "ipo" | null; exitProcessId?: string | null;
  covenantActions?: Array<{ elapsedMonth: number; action: "waiver" | "spread-step-up" | "dividend-restriction" | "mandatory-repayment"; amountMinor: number }>;
}

export interface MAndADeal {
  id: string; buyerId: string; targetCompanyId: string; type: "friendly" | "merger" | "hostile" | "pe-buyout" | "minority"; consideration: "cash" | "stock" | "debt" | "mixed";
  offerPriceMinor: number; premiumBps: number; financingMinor: number; status: "proposed" | "board-review" | "tender" | "diligence" | "shareholder-vote" | "regulatory-review" | "closing" | "closed" | "failed";
  boardSupport: boolean | null; shareholderApprovalBps: number; antitrustResult: "pending" | "approved" | "rejected" | "divestiture"; dueDiligenceRiskBps: number; competingBidIds: string[]; conditions: string[]; integrationProgressBps: number; announcedAtMonth: number; closedAtMonth: number | null;
  tenderElections: Array<{ holderId: string; shares: number; accepted: boolean }>;
}
export interface IPOProcess {
  id: string; companyId: string; underwriterBankId: string | null; stage: "preparation" | "underwriter-selection" | "due-diligence" | "indicative-range" | "bookbuilding" | "pricing" | "allocation" | "listing" | "completed" | "failed";
  primaryShares: number; secondaryShares: number; indicativeLowMinor: number; indicativeHighMinor: number; finalPriceMinor: number | null; feeBps: number; lockupUntilMonth: number | null;
  indications: Array<{ investorId: string; quantity: number; maxPriceMinor: number }>; allocations: Array<{ investorId: string; quantity: number; priceMinor: number }>; startedAtMonth: number;
}
export interface LockupRestriction { securityId: string; ownerId: string; shares: number; expiresAtMonth: number }

export type AuctionMechanism = "english" | "dutch" | "first-price" | "reverse-first-price" | "vickrey" | "uniform-price" | "pay-as-bid";
export interface EconomicAuction { id: string; sellerId: string; objectType: "sovereign-bond" | "procurement" | "privatization" | "bankruptcy-asset" | "license" | "company"; objectId: string; mechanism: AuctionMechanism; quantity: number; reserveMinor: number; eligibleBidderIds: string[]; status: "open" | "closed" | "settled" | "failed"; openedAtMonth: number; closesAtMonth: number; bids: AuctionBid[]; allocations: AuctionAllocation[] }
export interface AuctionBid { id: string; auctionId: string; bidderId: string; priceMinor: number; yieldBps: number | null; quantity: number; packageIds: string[]; sequence: number; submittedAtMonth: number }
export interface AuctionAllocation { bidderId: string; quantity: number; clearingPriceMinor: number; bidId: string }

export interface InsurerState { id: string; name: string; countryId: string; currencyId: string; bankAccountId: string; capitalMinor: number; reservesMinor: number; premiumIncomeMinor: number; claimsPaidMinor: number; operatingExpenseMinor: number; investmentAssetsMinor: number; reinsuranceRecoverableMinor: number }
export interface InsurancePolicy { id: string; insurerId: string; policyholderId: string; line: "property" | "consumer" | "corporate" | "cyber" | "life"; insuredValueMinor: number; annualPremiumMinor: number; deductibleMinor: number; limitMinor: number; expectedFrequencyBps: number; expectedSeverityBps: number; securityPostureBps: number; status: "active" | "expired" | "cancelled"; inceptionMonth: number; expiryMonth: number }
export interface InsuranceLossEvent { id: string; ownerId: string; assetId: string; line: InsurancePolicy["line"]; category: "property-damage" | "equipment-damage" | "cyber-incident" | "conflict-damage" | "other-covered"; sourceSystem: string; economicLossMinor: number; claimedAmountMinor: number; occurredAtMonth: number; description: string; causeIds: string[]; claimedByPolicyId: string | null }
export interface InsuranceClaim { id: string; policyId: string; lossEventId: string; economicLossMinor: number; reservedMinor: number; paidMinor: number; status: "reported" | "reserved" | "paid" | "denied"; reportedAtMonth: number; transactionIds: string[] }
export interface ReinsuranceTreaty { id: string; cedentId: string; reinsurerId: string; attachmentMinor: number; limitMinor: number; cededPremiumBps: number; status: "active" | "expired" }

export interface CausalExplanation { id: string; entityType: "price" | "liquidity" | "company" | "bank" | "etf" | "pe" | "ma" | "ipo" | "auction" | "insurance"; entityId: string; elapsedMonth: number; title: string; contributions: Array<{ cause: string; valueBps: number; evidenceIds: string[] }> }
export interface GovernanceProposal { id: string; companyId: string; proposerId: string; type: "buyback" | "asset-sale" | "board-change" | "company-sale"; requestedAmountMinor: number; votesFor: number; votesAgainst: number; status: "proposed" | "approved" | "rejected" | "executed"; createdAtMonth: number }
export interface RestructuringCase { id: string; companyId: string; goingConcernValueMinor: number; liquidationValueMinor: number; status: "negotiating" | "restructured" | "liquidation" | "failed"; haircutBps: number; debtToEquityMinor: number; creditorIds: string[]; openedAtMonth: number }
export interface DataCoverageSnapshot { elapsedMonth: number; category: "countries" | "companies" | "banks" | "institutions" | "defense" | "trade" | "markets"; observedBps: number; estimatedBps: number; calibratedBps: number; missingBps: number }
