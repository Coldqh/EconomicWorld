import {
  accountIds,
  bankAccountBalance,
  bankAccountsForOwner,
  ensureAccount,
  openBankAccount,
  postTransaction,
  settleDepositPayment,
  transferBankAccountBalance,
} from "../core/ledger.ts";
import { companyValuation } from "../corporate/finance.ts";
import { submitGovernanceProposal, voteGovernanceProposal } from "../corporate-finance/governance.ts";
import { createIPOProcess, proposeMAndA } from "../corporate-finance/transactions.ts";
import type { AcquisitionVehicle, Company, PrivateEquityDeal, PrivateEquityFundState, WorldState } from "../domain/model.ts";
import { issueLoan, settleBorrowerLoansFromCash } from "../finance/credit.ts";

export interface PrivateEquityInvestmentDecision {
  targetCompanyId: string;
  enterpriseValueMinor: number;
  equityValueMinor: number;
  normalizedCashFlowMinor: number;
  debtCapacityMinor: number;
  stabilityBps: number;
  improvementPotentialBps: number;
  expectedMoicBps: number;
  scoreBps: number;
  approved: boolean;
}

export function initializePrivateEquityFund(
  world: WorldState,
  fundId: string,
  gpId: string,
  commitments: Array<{ lpId: string; committedMinor: number }>,
  vintageYear = world.clock.startYear,
): PrivateEquityFundState {
  const existing = world.privateEquityFunds.find((item) => item.fundId === fundId);
  if (existing) return existing;
  const state: PrivateEquityFundState = {
    fundId,
    vintageYear,
    committedCapitalMinor: commitments.reduce((sum, item) => sum + item.committedMinor, 0),
    calledCapitalMinor: 0,
    investedCapitalMinor: 0,
    dryPowderMinor: 0,
    distributedCapitalMinor: 0,
    navMinor: 0,
    managementFeeBps: 200,
    carryBps: 2_000,
    gpId,
    lpCommitments: commitments.map((item) => ({ ...item, calledMinor: 0, distributedMinor: 0 })),
  };
  world.privateEquityFunds.push(state);
  return state;
}

export function callCapital(world: WorldState, fundId: string, amountMinor: number): number {
  const state = world.privateEquityFunds.find((item) => item.fundId === fundId);
  const fund = world.funds.find((item) => item.id === fundId);
  if (!state || !fund) return 0;
  const remainingCommitment = state.committedCapitalMinor - state.calledCapitalMinor;
  const requested = Math.min(Math.max(0, Math.floor(amountMinor)), remainingCommitment);
  let received = 0;
  for (const lp of state.lpCommitments) {
    const uncapped = Math.floor(requested * lp.committedMinor / Math.max(1, state.committedCapitalMinor));
    const call = Math.min(lp.committedMinor - lp.calledMinor, uncapped);
    const source = bankAccountsForOwner(world, lp.lpId, fund.currencyId)[0];
    if (!source || call <= 0 || bankAccountBalance(world, source.id) < call) continue;
    const transactionId = transferBankAccountBalance(world, source.id, fund.bankAccountId, call, "FUND_SUBSCRIPTION", `Взнос капитала в ${fund.name}`);
    if (!transactionId) continue;
    lp.calledMinor += call;
    received += call;
    world.fundFlows.push({ id: `fund-flow-${world.fundFlows.length + 1}`, fundId, investorId: lp.lpId, type: "capital-call", amountMinor: call, elapsedMonth: world.clock.elapsedMonths, transactionIds: [transactionId] });
  }
  state.calledCapitalMinor += received;
  state.dryPowderMinor += received;
  return received;
}

function normalizedCompanyCashFlow(company: Company): number {
  const reports = company.financialReports.slice(-12);
  if (reports.length) return reports.reduce((sum, report) => sum + report.operatingCashFlowCents, 0);
  return Math.max(0, company.lastGrossRevenueCents - company.lastOperatingExpenseCents) * 12;
}

export function evaluatePrivateEquityTarget(world: WorldState, fundId: string, targetCompanyId: string): PrivateEquityInvestmentDecision | null {
  const state = world.privateEquityFunds.find((item) => item.fundId === fundId);
  const company = world.companies.find((item) => item.id === targetCompanyId && item.active);
  if (!state || !company || company.corporateStatus === "subsidiary") return null;
  const valuation = companyValuation(world, company.id);
  const enterpriseValueMinor = valuation.enterpriseValueCents;
  const equityValueMinor = valuation.equityValueCents;
  const normalizedCashFlowMinor = normalizedCompanyCashFlow(company);
  const existingDebt = world.loans.filter((item) => item.borrowerId === company.id && item.status === "active").reduce((sum, item) => sum + item.remainingPrincipalCents, 0);
  // Five years of normalized annual cash flow is a conservative debt ceiling.
  const debtCapacityMinor = Math.max(0, normalizedCashFlowMinor * 5 - existingDebt);
  const stabilityBps = Math.max(0, 10_000 - company.distressMonths * 1_500);
  const utilizationBps = Math.round(company.lastProductionMilliUnits * 10_000 / Math.max(1, company.capacityMilliUnits));
  const improvementPotentialBps = Math.max(0, 10_000 - Math.min(10_000, company.managementBps)) + Math.max(0, 8_500 - utilizationBps) / 2;
  // A buyout purchases the shareholders' equity, not the enterprise value. EV is
  // still useful for operating/debt-capacity analysis, but using it as the sponsor
  // purchase price underfunds cash-rich targets and can approve impossible deals.
  const acquisitionDebtMinor = Math.min(Math.round(equityValueMinor * 0.6), debtCapacityMinor);
  const sponsorEquity = Math.max(1, equityValueMinor - acquisitionDebtMinor);
  const expectedExitEnterprise = Math.max(0, Math.round((enterpriseValueMinor + normalizedCashFlowMinor * 2) * (1 + improvementPotentialBps / 40_000)));
  const enterpriseValueGain = expectedExitEnterprise - enterpriseValueMinor;
  const expectedTargetEquityValue = Math.max(0, equityValueMinor + enterpriseValueGain);
  const expectedRemainingAcquisitionDebt = Math.round(acquisitionDebtMinor * 0.65);
  const expectedSponsorProceeds = Math.max(0, expectedTargetEquityValue - expectedRemainingAcquisitionDebt);
  const expectedMoicBps = Math.round(expectedSponsorProceeds * 10_000 / sponsorEquity);
  const scoreBps = Math.round(expectedMoicBps * stabilityBps / 10_000 + improvementPotentialBps / 4);
  const availableSponsorCapital = Math.max(0, state.dryPowderMinor + state.committedCapitalMinor - state.calledCapitalMinor);
  const approved = equityValueMinor > 0 && enterpriseValueMinor > 0 && normalizedCashFlowMinor > 0 && stabilityBps >= 5_000 && expectedMoicBps >= 12_500 && sponsorEquity <= availableSponsorCapital;
  return { targetCompanyId, enterpriseValueMinor, equityValueMinor, normalizedCashFlowMinor, debtCapacityMinor, stabilityBps, improvementPotentialBps: Math.round(improvementPotentialBps), expectedMoicBps, scoreBps, approved };
}

export function sourcePrivateEquityTarget(world: WorldState, fundId: string): string | null {
  const state = world.privateEquityFunds.find((item) => item.fundId === fundId);
  if (!state || state.dryPowderMinor <= 0 && state.calledCapitalMinor >= state.committedCapitalMinor) return null;
  return world.companies
    .filter((company) => company.active && company.corporateStatus !== "subsidiary" && !world.privateEquityDeals.some((deal) => deal.targetCompanyId === company.id && !["exited", "failed"].includes(deal.status)))
    .map((company) => evaluatePrivateEquityTarget(world, fundId, company.id))
    .filter((decision): decision is PrivateEquityInvestmentDecision => Boolean(decision?.approved))
    .sort((left, right) => right.scoreBps - left.scoreBps)[0]?.targetCompanyId ?? null;
}

export function executeLbo(world: WorldState, fundId: string, targetCompanyId: string, purchaseMinor: number, debtBps = 6_000): PrivateEquityDeal | null {
  const state = world.privateEquityFunds.find((item) => item.fundId === fundId);
  const fund = world.funds.find((item) => item.id === fundId);
  const target = world.companies.find((item) => item.id === targetCompanyId && item.active);
  const decision = evaluatePrivateEquityTarget(world, fundId, targetCompanyId);
  if (!state || !fund || !target || !decision?.approved || purchaseMinor <= 0 || world.privateEquityDeals.some((item) => item.targetCompanyId === targetCompanyId && !["exited", "failed"].includes(item.status))) return null;

  const requestedDebt = Math.min(Math.round(purchaseMinor * debtBps / 10_000), decision.debtCapacityMinor || Math.round(purchaseMinor * 0.4));
  const candidateBanks = world.banks.filter((item) => item.baseCurrency === fund.currencyId).sort((left, right) => {
    const leftCost = world.bankAlmStates.find((item) => item.bankId === left.id)?.fundingCostBps ?? left.baseSpreadBps;
    const rightCost = world.bankAlmStates.find((item) => item.bankId === right.id)?.fundingCostBps ?? right.baseSpreadBps;
    return leftCost - rightCost;
  });
  const vehicleId = `pe-holdco-${world.privateEquityDeals.length + 1}`;
  const expectedSponsorEquity = Math.max(0, purchaseMinor - requestedDebt);
  if (state.dryPowderMinor < expectedSponsorEquity) callCapital(world, fundId, expectedSponsorEquity - state.dryPowderMinor);
  if (state.dryPowderMinor < expectedSponsorEquity || bankAccountBalance(world, fund.bankAccountId) < expectedSponsorEquity) return null;

  // Acquisition leverage belongs to the transaction HoldCo. Stop after the
  // first lender approves so no orphan loans or duplicate deposits are created.
  let acquisitionLoan = null;
  if (requestedDebt > 0) {
    for (const bank of candidateBanks) {
      acquisitionLoan = issueLoan(world, bank.id, vehicleId, requestedDebt, 84, 450, [fundId, targetCompanyId]);
      if (acquisitionLoan) break;
    }
  }
  if (!acquisitionLoan && requestedDebt > 0) {
    const fallbackDebt = Math.round(requestedDebt * 0.7);
    for (const bank of candidateBanks) {
      acquisitionLoan = issueLoan(world, bank.id, vehicleId, fallbackDebt, 84, 550, [fundId, targetCompanyId]);
      if (acquisitionLoan) break;
    }
  }
  const actualDebt = acquisitionLoan?.originalPrincipalCents ?? 0;
  const sponsorEquity = Math.max(0, purchaseMinor - actualDebt);
  if (state.dryPowderMinor < sponsorEquity) callCapital(world, fundId, sponsorEquity - state.dryPowderMinor);
  if (state.dryPowderMinor < sponsorEquity || bankAccountBalance(world, fund.bankAccountId) < sponsorEquity) {
    if (acquisitionLoan) settleBorrowerLoansFromCash(world, vehicleId, [targetCompanyId, "failed-sponsor-funding"]);
    return null;
  }
  let vehicleAccount = acquisitionLoan && world.bankAccounts.find((item) => item.id === acquisitionLoan.settlementBankAccountId);
  if (!vehicleAccount) {
    const fundBankId = world.bankAccounts.find((item) => item.id === fund.bankAccountId)?.bankId ?? candidateBanks[0]?.id;
    if (!fundBankId) return null;
    vehicleAccount = world.bankAccounts.find((item) => item.id === openBankAccount(world, vehicleId, fundBankId, true).accountId);
  }
  if (!vehicleAccount) return null;
  const sponsorCashTransactionId = sponsorEquity > 0
    ? transferBankAccountBalance(world, fund.bankAccountId, vehicleAccount.id, sponsorEquity, "CAPITAL_CONTRIBUTION", `Sponsor equity ${vehicleId}`, [targetCompanyId])
    : null;
  if (sponsorEquity > 0 && !sponsorCashTransactionId) return null;
  const fundInvestmentAccount = `asset:pe-vehicle:${fund.id}:${vehicleId}`;
  const vehicleEquityAccount = `equity:pe-vehicle:${vehicleId}`;
  ensureAccount(world.ledger, fundInvestmentAccount, fund.id, `Инвестиция в ${vehicleId}`, "asset", fund.currencyId);
  ensureAccount(world.ledger, vehicleEquityAccount, vehicleId, `Капитал спонсора ${vehicleId}`, "equity", fund.currencyId);
  const sponsorRecognitionId = sponsorEquity > 0 ? postTransaction(world, "CAPITAL_CONTRIBUTION", `Признание капитала ${vehicleId}`, [
    { accountId: fundInvestmentAccount, side: "debit", amountCents: sponsorEquity },
    { accountId: vehicleEquityAccount, side: "credit", amountCents: sponsorEquity },
  ], sponsorCashTransactionId ? [sponsorCashTransactionId] : []) : null;

  const acquisition = proposeMAndA(world, vehicleId, target.id, "pe-buyout", "cash", purchaseMinor);
  if (!acquisition) return null;
  const vehicle: AcquisitionVehicle = {
    id: vehicleId, dealId: null, fundId: fund.id, targetCompanyId: target.id, currencyId: fund.currencyId, bankAccountId: vehicleAccount.id,
    status: "funding" as const, sponsorEquityMinor: sponsorEquity, debtMinor: actualDebt, targetShares: 0,
    createdAtMonth: world.clock.elapsedMonths, closedAtMonth: null,
    transactionIds: [sponsorCashTransactionId, sponsorRecognitionId, acquisitionLoan?.id].filter((item): item is string => Boolean(item)),
  };
  world.acquisitionVehicles.push(vehicle);
  const deal: PrivateEquityDeal = {
    id: `pe-deal-${world.privateEquityDeals.length + 1}`,
    fundId,
    targetCompanyId,
    sponsorEquityMinor: sponsorEquity,
    seniorDebtMinor: actualDebt,
    subordinatedDebtMinor: 0,
    purchaseConsiderationMinor: purchaseMinor,
    outstandingDebtMinor: actualDebt,
    entryMonth: world.clock.elapsedMonths,
    exitMonth: null,
    exitProceedsMinor: 0,
    leverageCovenantBps: 60_000,
    interestCoverageCovenantBps: 150,
    status: "diligence",
    cashFlows: [{ elapsedMonth: world.clock.elapsedMonths, amountMinor: -sponsorEquity }],
    acquisitionDealId: acquisition.id,
    acquisitionVehicleId: vehicle.id,
    acquisitionLoanIds: acquisitionLoan ? [acquisitionLoan.id] : [],
    investmentCommitteeScoreBps: decision.scoreBps,
    exitRoute: null,
    exitProcessId: null,
    covenantActions: [],
  };
  world.privateEquityDeals.push(deal);
  vehicle.dealId = deal.id;
  return deal;
}

function synchronizeAcquisition(world: WorldState, deal: PrivateEquityDeal): void {
  if (deal.status !== "diligence" || !deal.acquisitionDealId) return;
  const acquisition = world.mAndADeals.find((item) => item.id === deal.acquisitionDealId);
  const state = world.privateEquityFunds.find((item) => item.fundId === deal.fundId);
  const vehicle = world.acquisitionVehicles.find((item) => item.id === deal.acquisitionVehicleId);
  if (!acquisition || !state || !vehicle) { deal.status = "failed"; if (vehicle) vehicle.status = "failed"; return; }
  if (acquisition.status === "failed") { deal.status = "failed"; vehicle.status = "failed"; return; }
  if (acquisition.status !== "closed") return;
  deal.status = "owned";
  vehicle.status = "holding";
  const security = world.equitySecurities.find((item) => item.companyId === deal.targetCompanyId);
  vehicle.targetShares = security ? world.equityHoldings.find((item) => item.securityId === security.id && item.ownerId === vehicle.id)?.shares ?? 0 : 0;
  state.dryPowderMinor = Math.max(0, state.dryPowderMinor - deal.sponsorEquityMinor);
  state.investedCapitalMinor += deal.sponsorEquityMinor;
  state.navMinor += Math.max(0, deal.purchaseConsiderationMinor - deal.outstandingDebtMinor);
  const proposal = submitGovernanceProposal(world, deal.targetCompanyId, vehicle.id, "asset-sale", 0);
  if (proposal) voteGovernanceProposal(world, proposal.id);
}

function currentAcquisitionDebt(world: WorldState, deal: PrivateEquityDeal): number {
  const ids = new Set(deal.acquisitionLoanIds ?? []);
  return world.loans.filter((item) => ids.has(item.id) && item.status === "active").reduce((sum, item) => sum + item.remainingPrincipalCents, 0);
}

export function monitorPeCovenants(world: WorldState): void {
  for (const deal of world.privateEquityDeals.filter((item) => item.status === "owned" || item.status === "covenant-breach")) {
    const company = world.companies.find((item) => item.id === deal.targetCompanyId);
    const fund = world.funds.find((item) => item.id === deal.fundId);
    const vehicle = world.acquisitionVehicles.find((item) => item.id === deal.acquisitionVehicleId);
    if (!company || !fund || !vehicle) continue;
    deal.outstandingDebtMinor = currentAcquisitionDebt(world, deal);
    const cashFlow = normalizedCompanyCashFlow(company);
    const interest = Math.max(1, company.financialReports.slice(-12).reduce((sum, report) => sum + report.interestCents, 0));
    const leverageBps = Math.round(deal.outstandingDebtMinor * 10_000 / Math.max(1, cashFlow));
    const coverageBps = Math.round(cashFlow * 100 / interest);
    if (leverageBps <= deal.leverageCovenantBps && coverageBps >= deal.interestCoverageCovenantBps) { if (deal.status === "covenant-breach") deal.status = "owned"; continue; }
    deal.status = "covenant-breach";
    const actions = deal.covenantActions ??= [];
    if (!actions.some((item) => item.elapsedMonth === world.clock.elapsedMonths && item.action === "dividend-restriction")) actions.push({ elapsedMonth: world.clock.elapsedMonths, action: "dividend-restriction", amountMinor: 0 });
    const companyAccount = bankAccountsForOwner(world, company.id, fund.currencyId)[0];
    const available = companyAccount ? bankAccountBalance(world, companyAccount.id) : 0;
    const upstream = Math.min(Math.max(0, Math.round(cashFlow * 0.1)), Math.floor(available * 0.15), deal.outstandingDebtMinor);
    if (upstream > 0) {
      const dividendExpense = accountIds.operatingExpense(company.id);
      const dividendIncome = accountIds.operatingIncome(vehicle.id);
      ensureAccount(world.ledger, dividendExpense, company.id, "Распределение портфельной компании", "expense", fund.currencyId);
      ensureAccount(world.ledger, dividendIncome, vehicle.id, "Доход acquisition HoldCo", "income", fund.currencyId);
      const cashTransactionId = settleDepositPayment(world, company.id, vehicle.id, upstream, "DIVIDEND", `Deleveraging ${deal.id}`, dividendExpense, dividendIncome);
      if (cashTransactionId) {
        const before = currentAcquisitionDebt(world, deal);
        settleBorrowerLoansFromCash(world, vehicle.id, [cashTransactionId, deal.id]);
        const repaid = Math.max(0, before - currentAcquisitionDebt(world, deal));
        if (repaid > 0) actions.push({ elapsedMonth: world.clock.elapsedMonths, action: "mandatory-repayment", amountMinor: repaid });
      }
    } else {
      const loans = world.loans.filter((item) => (deal.acquisitionLoanIds ?? []).includes(item.id) && item.status === "active");
      for (const loan of loans) loan.annualRateBps += 50;
      actions.push({ elapsedMonth: world.clock.elapsedMonths, action: "spread-step-up", amountMinor: 0 });
      deal.leverageCovenantBps = Math.round(deal.leverageCovenantBps * 1.05);
    }
    deal.outstandingDebtMinor = currentAcquisitionDebt(world, deal);
  }
}

export function privateEquityMoicBps(deal: PrivateEquityDeal): number {
  const invested = -deal.cashFlows.filter((flow) => flow.amountMinor < 0).reduce((sum, flow) => sum + flow.amountMinor, 0);
  const returned = deal.cashFlows.filter((flow) => flow.amountMinor > 0).reduce((sum, flow) => sum + flow.amountMinor, 0)
    + (deal.status === "exited" ? 0 : Math.max(0, deal.purchaseConsiderationMinor - deal.outstandingDebtMinor));
  return Math.round(returned * 10_000 / Math.max(1, invested));
}

export function privateEquityIrrBps(deal: PrivateEquityDeal): number | null {
  if (deal.cashFlows.length < 2) return null;
  let low = -0.99;
  let high = 10;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const rate = (low + high) / 2;
    const npv = deal.cashFlows.reduce((sum, flow) => sum + flow.amountMinor / Math.pow(1 + rate, (flow.elapsedMonth - deal.entryMonth) / 12), 0);
    if (npv > 0) low = rate; else high = rate;
  }
  return Math.round((low + high) * 5_000);
}

export function evaluatePeExit(world: WorldState, dealId: string): "strategic" | "secondary" | "ipo" | null {
  const deal = world.privateEquityDeals.find((item) => item.id === dealId && (item.status === "owned" || item.status === "covenant-breach"));
  const company = deal && world.companies.find((item) => item.id === deal.targetCompanyId);
  if (!deal || !company || deal.exitProcessId || world.clock.elapsedMonths - deal.entryMonth < 24) return null;
  const value = companyValuation(world, company.id).equityValueCents;
  if (value <= deal.sponsorEquityMinor * 1.25) return null;
  const fund = world.funds.find((item) => item.id === deal.fundId);
  const strategic = world.companies
    .filter((item) => item.active && item.id !== company.id && item.goodId === company.goodId && item.corporateStatus !== "subsidiary" && bankAccountsForOwner(world, item.id, fund?.currencyId).length > 0)
    .filter((item) => item.marketShareBps + company.marketShareBps <= 6_500)
    .sort((left, right) => left.marketShareBps - right.marketShareBps)[0];
  if (strategic) {
    const exit = proposeMAndA(world, strategic.id, company.id, "friendly", "cash", value);
    if (!exit) return null;
    deal.exitRoute = "strategic";
    deal.exitProcessId = exit.id;
    return "strategic";
  }
  const secondary = world.privateEquityFunds.find((item) => item.fundId !== deal.fundId && item.dryPowderMinor >= Math.round(value * 0.4));
  if (secondary) {
    const exit = proposeMAndA(world, secondary.fundId, company.id, "pe-buyout", "cash", value);
    if (!exit) return null;
    deal.exitRoute = "secondary";
    deal.exitProcessId = exit.id;
    return "secondary";
  }
  const security = world.equitySecurities.find((item) => item.companyId === company.id);
  const vehicleId = deal.acquisitionVehicleId ?? deal.fundId;
  const sponsorHolding = security && world.equityHoldings.find((item) => item.securityId === security.id && item.ownerId === vehicleId);
  const exit = sponsorHolding && createIPOProcess(world, company.id, 0, sponsorHolding.shares);
  if (!exit) return null;
  deal.exitRoute = "ipo";
  deal.exitProcessId = exit.id;
  return "ipo";
}

export function settlePeExitWaterfall(world: WorldState, dealId: string, grossProceedsMinor: number): boolean {
  const deal = world.privateEquityDeals.find((item) => item.id === dealId);
  const state = deal && world.privateEquityFunds.find((item) => item.fundId === deal.fundId);
  const fund = state && world.funds.find((item) => item.id === state.fundId);
  if (!deal || !state || !fund || grossProceedsMinor <= 0) return false;
  const vehicle = world.acquisitionVehicles.find((item) => item.id === deal.acquisitionVehicleId);
  const debtBorrowerId = vehicle?.id ?? fund.id;
  const debtBefore = currentAcquisitionDebt(world, deal);
  if (debtBefore > 0) settleBorrowerLoansFromCash(world, debtBorrowerId, [deal.id, deal.exitProcessId ?? deal.id]);
  const debtAfter = currentAcquisitionDebt(world, deal);
  const repaidDebt = Math.max(0, debtBefore - debtAfter);
  let proceedsMinor = Math.max(0, grossProceedsMinor - repaidDebt);
  if (debtAfter > 0) return false;
  if (vehicle) {
    const vehicleCash = bankAccountsForOwner(world, vehicle.id, fund.currencyId).find((item) => item.id === vehicle.bankAccountId) ?? bankAccountsForOwner(world, vehicle.id, fund.currencyId)[0];
    if (!vehicleCash) return false;
    // Loan settlement consumes principal plus accrued interest. The distributable
    // equity proceeds are therefore the HoldCo's actual residual cash, not a
    // principal-only arithmetic estimate that can exceed the bank balance.
    proceedsMinor = bankAccountBalance(world, vehicleCash.id);
    if (proceedsMinor <= 0) return false;
    const vehicleExpense = accountIds.operatingExpense(vehicle.id);
    const fundIncome = accountIds.operatingIncome(fund.id);
    ensureAccount(world.ledger, vehicleExpense, vehicle.id, "Распределение выручки в фонд прямых инвестиций", "expense", fund.currencyId);
    ensureAccount(world.ledger, fundIncome, fund.id, "Доход от acquisition HoldCo", "income", fund.currencyId);
    const upstream = settleDepositPayment(world, vehicle.id, fund.id, proceedsMinor, "DIVIDEND", `Exit proceeds ${deal.id}`, vehicleExpense, fundIncome);
    if (!upstream) return false;
    vehicle.transactionIds.push(upstream);
    vehicle.status = "exited";
    vehicle.closedAtMonth = world.clock.elapsedMonths;
    vehicle.debtMinor = debtAfter;
  }
  if (proceedsMinor <= 0) return false;
  if (bankAccountBalance(world, fund.bankAccountId) < proceedsMinor) return false;
  const profit = Math.max(0, proceedsMinor - deal.sponsorEquityMinor);
  const carry = Math.round(profit * state.carryBps / 10_000);
  const gpAccount = bankAccountsForOwner(world, state.gpId, fund.currencyId)[0];
  let paidCarry = 0;
  if (carry > 0 && gpAccount) {
    const transactionId = transferBankAccountBalance(world, fund.bankAccountId, gpAccount.id, carry, "PERFORMANCE_FEE", `Carry ${deal.id}`);
    if (transactionId) paidCarry = carry;
  }
  const lpPool = proceedsMinor - paidCarry;
  const contributedCapital = state.lpCommitments.reduce((sum, lp) => sum + lp.calledMinor, 0);
  let distributed = 0;
  for (const lp of state.lpCommitments) {
    // Distributions follow capital actually contributed. An LP that committed but
    // never funded a call does not receive the same economics as a paying LP.
    const weight = contributedCapital > 0 ? lp.calledMinor : lp.committedMinor;
    const denominator = contributedCapital > 0 ? contributedCapital : state.committedCapitalMinor;
    const amount = Math.floor(lpPool * weight / Math.max(1, denominator));
    const account = bankAccountsForOwner(world, lp.lpId, fund.currencyId)[0];
    if (!account || amount <= 0) continue;
    const transactionId = transferBankAccountBalance(world, fund.bankAccountId, account.id, amount, "FUND_REDEMPTION", `Распределение ${deal.id}`);
    if (!transactionId) continue;
    lp.distributedMinor += amount;
    distributed += amount;
    world.fundFlows.push({ id: `fund-flow-${world.fundFlows.length + 1}`, fundId: fund.id, investorId: lp.lpId, type: "distribution", amountMinor: amount, elapsedMonth: world.clock.elapsedMonths, transactionIds: [transactionId] });
  }
  deal.status = "exited";
  deal.exitMonth = world.clock.elapsedMonths;
  deal.exitProceedsMinor = grossProceedsMinor;
  deal.outstandingDebtMinor = debtAfter;
  deal.cashFlows.push({ elapsedMonth: world.clock.elapsedMonths, amountMinor: proceedsMinor });
  state.distributedCapitalMinor += distributed;
  state.navMinor = Math.max(0, state.navMinor - deal.purchaseConsiderationMinor);
  return true;
}

function synchronizeExit(world: WorldState, deal: PrivateEquityDeal): void {
  if (!deal.exitRoute || !deal.exitProcessId || deal.status === "exited") return;
  if (deal.exitRoute === "ipo") {
    const ipo = world.ipoProcesses.find((item) => item.id === deal.exitProcessId);
    if (!ipo || ipo.stage === "failed") { deal.exitProcessId = null; deal.exitRoute = null; return; }
    if (ipo.stage === "completed" && ipo.finalPriceMinor) settlePeExitWaterfall(world, deal.id, ipo.secondaryShares * ipo.finalPriceMinor);
    return;
  }
  const transaction = world.mAndADeals.find((item) => item.id === deal.exitProcessId);
  if (!transaction || transaction.status === "failed") { deal.exitProcessId = null; deal.exitRoute = null; return; }
  if (transaction.status === "closed") settlePeExitWaterfall(world, deal.id, transaction.offerPriceMinor);
}

export function runPrivateEquityMonth(world: WorldState): void {
  for (const deal of world.privateEquityDeals) synchronizeAcquisition(world, deal);
  monitorPeCovenants(world);
  for (const deal of world.privateEquityDeals) synchronizeExit(world, deal);
  if (world.clock.elapsedMonths % 3 !== 0) return;
  for (const state of world.privateEquityFunds) {
    const activeDeals = world.privateEquityDeals.filter((item) => item.fundId === state.fundId && !["exited", "failed"].includes(item.status));
    if (!activeDeals.length) {
      const target = sourcePrivateEquityTarget(world, state.fundId);
      if (target) {
        const value = companyValuation(world, target).equityValueCents;
        if (value > 0) executeLbo(world, state.fundId, target, value);
      }
    }
    for (const deal of activeDeals) evaluatePeExit(world, deal.id);
  }
}
