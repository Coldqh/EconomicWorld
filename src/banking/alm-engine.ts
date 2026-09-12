import { bankAccountBalance, openBankAccount, transferBankAccountBalance } from "../core/ledger.ts";
import type { BankAlmState, Company, CreditOffer, WorldState } from "../domain/model.ts";
import { bankCapitalCents } from "../finance/credit.ts";

export function corporateCreditScore(world: WorldState, company: Company): number {
  const reports = company.financialReports.slice(-12); const cashFlow = reports.reduce((sum, report) => sum + report.operatingCashFlowCents, 0);
  const interest = reports.reduce((sum, report) => sum + report.interestCents, 0); const debt = world.loans.filter((loan) => loan.borrowerId === company.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  const leveragePenalty = Math.min(3_000, Math.round(debt * 3_000 / Math.max(1, company.productiveCapital.bookValueCents + company.inventoryValueCents)));
  const coverage = cashFlow / Math.max(1, interest); return Math.max(500, Math.min(9_500, 6_500 + Math.min(2_000, coverage * 250) - leveragePenalty - company.distressMonths * 500));
}

export function priceCorporateLoan(world: WorldState, bankId: string, companyId: string, amountMinor: number, termMonths = 60): CreditOffer | null {
  const bank = world.banks.find((item) => item.id === bankId); const company = world.companies.find((item) => item.id === companyId); if (!bank || !company) return null;
  const alm = world.bankAlmStates.find((item) => item.bankId === bankId); const score = corporateCreditScore(world, company);
  const expectedLoss = Math.max(25, Math.round((10_000 - score) * 0.16)); const capitalCost = Math.max(60, Math.round(amountMinor * bank.minimumCapitalRatioBps / Math.max(1, bankCapitalCents(world, bankId))));
  const policy = world.centralBanks.find((item) => item.id === bank.centralBankId)?.policyRateBps ?? 0;
  const offer: CreditOffer = { id: `credit-offer-${world.clock.elapsedMonths}-${world.creditOffers.length + 1}`, bankId, borrowerId: companyId, amountMinor, annualRateBps: policy + (alm?.fundingCostBps ?? 100) + expectedLoss + capitalCost + bank.baseSpreadBps, termMonths, riskScoreBps: score, expectedLossBps: expectedLoss, capitalCostBps: capitalCost, status: "offered", createdAtMonth: world.clock.elapsedMonths };
  world.creditOffers.push(offer); return offer;
}

export function compareCorporateLoanOffers(world: WorldState, companyId: string, amountMinor: number, termMonths = 60): CreditOffer | null {
  const company = world.companies.find((item) => item.id === companyId); if (!company) return null;
  const countryBanks = world.banks.filter((bank) => bank.countryId === company.headquartersCountryId);
  const offers = countryBanks.map((bank) => priceCorporateLoan(world, bank.id, companyId, amountMinor, termMonths)).filter((item): item is CreditOffer => Boolean(item));
  const best = offers.sort((a, b) => (a.annualRateBps + Math.max(0, amountMinor - a.amountMinor) / Math.max(1, amountMinor) * 2_000) - (b.annualRateBps + Math.max(0, amountMinor - b.amountMinor) / Math.max(1, amountMinor) * 2_000))[0] ?? null;
  for (const offer of offers) offer.status = offer === best ? "accepted" : "rejected"; return best;
}

export function runDepositCompetition(world: WorldState): number {
  let moved = 0;
  for (const owner of [...world.households.map((item) => item.id), ...world.companies.filter((item) => item.active).map((item) => item.id)]) {
    const accounts = world.bankAccounts.filter((item) => item.ownerId === owner && item.status === "active"); const source = accounts.sort((a, b) => bankAccountBalance(world, b.id) - bankAccountBalance(world, a.id))[0]; if (!source) continue;
    const sourceBank = world.banks.find((item) => item.id === source.bankId); const sourceRate = world.bankAlmStates.find((item) => item.bankId === source.bankId)?.depositRateBps ?? 0;
    const candidate = world.banks.filter((item) => item.countryId === sourceBank?.countryId && item.baseCurrency === source.currencyId).map((bank) => ({ bank, alm: world.bankAlmStates.find((item) => item.bankId === bank.id) })).filter((item) => item.alm && item.bank.id !== source.bankId).sort((a, b) => (b.alm!.depositRateBps + Math.min(500, Math.round(bankCapitalCents(world, b.bank.id) / 1_000_000))) - (a.alm!.depositRateBps + Math.min(500, Math.round(bankCapitalCents(world, a.bank.id) / 1_000_000))))[0];
    if (!candidate || candidate.alm!.depositRateBps < sourceRate + 75) continue; const amount = Math.floor(bankAccountBalance(world, source.id) * 500 / 10_000); if (amount <= 0) continue;
    const opened = openBankAccount(world, owner, candidate.bank.id); const target = world.bankAccounts.find((item) => item.id === opened.accountId); if (target && transferBankAccountBalance(world, source.id, target.id, amount, "TRANSFER", `Перевод депозита в ${candidate.bank.name}`)) moved += amount;
  }
  return moved;
}

export function runBankAlm(world: WorldState): void {
  const states: BankAlmState[] = [];
  const companyIds = new Set(world.companies.map((company) => company.id));
  const householdIds = new Set(world.households.map((household) => household.id));
  const activeLoansByBank = new Map<string, WorldState["loans"]>();
  const defaultedLoanCountByBank = new Map<string, number>();
  const activeAccountsByBank = new Map<string, WorldState["bankAccounts"]>();
  const activeAccountsByOwner = new Map<string, WorldState["bankAccounts"]>();
  const activeFundingByLender = new Map<string, WorldState["bankFunding"]>();
  const activeFundingByBorrower = new Map<string, WorldState["bankFunding"]>();
  const sovereignByHolder = new Map<string, WorldState["sovereignBondHoldings"]>();
  const corporateBondsByHolder = new Map<string, WorldState["bondHoldings"]>();
  const append = <T,>(map: Map<string, T[]>, key: string, value: T): void => {
    const items = map.get(key) ?? [];
    items.push(value);
    map.set(key, items);
  };
  for (const loan of world.loans) {
    if (loan.status === "active") append(activeLoansByBank, loan.lenderBankId, loan);
    else if (loan.status === "defaulted") defaultedLoanCountByBank.set(loan.lenderBankId, (defaultedLoanCountByBank.get(loan.lenderBankId) ?? 0) + 1);
  }
  for (const account of world.bankAccounts) if (account.status === "active") {
    append(activeAccountsByBank, account.bankId, account);
    append(activeAccountsByOwner, account.ownerId, account);
  }
  for (const funding of world.bankFunding) if (funding.status === "active") {
    append(activeFundingByLender, funding.lenderId, funding);
    append(activeFundingByBorrower, funding.borrowerBankId, funding);
  }
  for (const holding of world.sovereignBondHoldings) append(sovereignByHolder, holding.holderId, holding);
  for (const holding of world.bondHoldings) append(corporateBondsByHolder, holding.holderId, holding);
  const sovereignBondById = new Map(world.sovereignBonds.map((bond) => [bond.id, bond]));
  const corporateBondById = new Map(world.corporateBonds.map((bond) => [bond.id, bond]));
  for (const bank of world.banks) {
    const bankLoans = activeLoansByBank.get(bank.id) ?? [];
    const bankAccounts = activeAccountsByBank.get(bank.id) ?? [];
    const bankSovereign = sovereignByHolder.get(bank.id) ?? [];
    const bankCorporateBonds = corporateBondsByHolder.get(bank.id) ?? [];
    const deposits = bankAccounts.reduce((sum, account) => sum + bankAccountBalance(world, account.id), 0);
    const corporateLoans = bankLoans.filter((loan) => companyIds.has(loan.borrowerId)).reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
    const householdLoans = bankLoans.filter((loan) => householdIds.has(loan.borrowerId)).reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
    const interbankAssets = (activeFundingByLender.get(bank.id) ?? []).reduce((sum, funding) => sum + funding.remainingCents, 0);
    const borrowerFunding = activeFundingByBorrower.get(bank.id) ?? [];
    const interbankFunding = borrowerFunding.filter((funding) => funding.kind === "interbank").reduce((sum, funding) => sum + funding.remainingCents, 0);
    const centralBankFunding = borrowerFunding.filter((funding) => funding.kind === "central-bank").reduce((sum, funding) => sum + funding.remainingCents, 0);
    const sovereign = bankSovereign.reduce((sum, holding) => sum + holding.faceValueMinor, 0);
    const corporateBonds = bankCorporateBonds.reduce((sum, holding) => sum + holding.faceValueCents, 0);
    const reserves = Math.max(0, bankCapitalCents(world, bank.id) + deposits + interbankFunding + centralBankFunding - corporateLoans - householdLoans - interbankAssets - sovereign - corporateBonds);
    const policy = world.centralBanks.find((item) => item.id === bank.centralBankId)?.policyRateBps ?? 0;
    const prior = world.bankAlmStates.find((item) => item.bankId === bank.id); const fundingPressure = deposits > 0 ? Math.max(-150, Math.min(350, (corporateLoans + householdLoans - deposits * 0.75) * 1_000 / deposits)) : 350;
    const depositRate = Math.max(0, Math.round(policy * 0.65 + fundingPressure)); const loanYield = bankLoans.reduce((sum, loan) => sum + loan.annualRateBps * loan.remainingPrincipalCents, 0) / Math.max(1, corporateLoans + householdLoans);
    const fundingCost = Math.round((depositRate * deposits + (policy + 100) * (interbankFunding + centralBankFunding)) / Math.max(1, deposits + interbankFunding + centralBankFunding));
    const loanBucket = (min: number, max: number) => bankLoans.filter((loan) => loan.remainingMonths > min && loan.remainingMonths <= max).reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
    const assetsByCurrency: Record<string, number> = { [bank.baseCurrency]: reserves + interbankAssets };
    const liabilitiesByCurrency: Record<string, number> = { [bank.baseCurrency]: interbankFunding + centralBankFunding };
    for (const loan of bankLoans) assetsByCurrency[loan.currencyId] = (assetsByCurrency[loan.currencyId] ?? 0) + loan.remainingPrincipalCents;
    for (const account of activeAccountsByOwner.get(bank.id) ?? []) assetsByCurrency[account.currencyId] = (assetsByCurrency[account.currencyId] ?? 0) + bankAccountBalance(world, account.id);
    for (const account of bankAccounts) if (account.ownerId !== bank.id) liabilitiesByCurrency[account.currencyId] = (liabilitiesByCurrency[account.currencyId] ?? 0) + bankAccountBalance(world, account.id);
    for (const holding of bankSovereign) { const currency = sovereignBondById.get(holding.bondId)?.currencyId ?? bank.baseCurrency; assetsByCurrency[currency] = (assetsByCurrency[currency] ?? 0) + holding.faceValueMinor; }
    for (const holding of bankCorporateBonds) { const currency = corporateBondById.get(holding.bondId)?.currencyId ?? bank.baseCurrency; assetsByCurrency[currency] = (assetsByCurrency[currency] ?? 0) + holding.faceValueCents; }
    const currencyMismatch = Object.keys({ ...assetsByCurrency, ...liabilitiesByCurrency }).filter((currency) => currency !== bank.baseCurrency).reduce((sum, currency) => sum + Math.abs((assetsByCurrency[currency] ?? 0) - (liabilitiesByCurrency[currency] ?? 0)), 0);
    states.push({ bankId: bank.id, reserveAssetsMinor: reserves, householdLoansMinor: householdLoans, corporateLoansMinor: corporateLoans, interbankAssetsMinor: interbankAssets, sovereignBondsMinor: sovereign, corporateBondsMinor: corporateBonds, securitiesMinor: 0, depositsMinor: deposits, wholesaleFundingMinor: 0, interbankFundingMinor: interbankFunding, centralBankFundingMinor: centralBankFunding, issuedBondsMinor: 0, liquidityGapMinor: reserves - Math.round(deposits * bank.minimumLiquidityRatioBps / 10_000), maturityGapMonths: 24, rateSensitivityMinorPer100Bps: -Math.round((sovereign + corporateBonds + loanBucket(12, 600)) * 0.04), currencyMismatchMinor: currencyMismatch, depositRateBps: depositRate, averageAssetYieldBps: Math.round(loanYield || policy), fundingCostBps: fundingCost, netInterestMarginBps: Math.round((loanYield || policy) - fundingCost), expectedCreditLossBps: Math.round((defaultedLoanCountByBank.get(bank.id) ?? 0) * 20), profitMinor: Math.round(((loanYield || policy) * (corporateLoans + householdLoans) - fundingCost * deposits) / 10_000 / 12), lastDecisionMonth: world.clock.elapsedMonths, maturityBuckets: { shortAssetsMinor: reserves + loanBucket(0, 12), mediumAssetsMinor: loanBucket(12, 60), longAssetsMinor: loanBucket(60, 600) + sovereign + corporateBonds, shortFundingMinor: Math.round(deposits * 0.35) + interbankFunding, mediumFundingMinor: Math.round(deposits * 0.4) + centralBankFunding, longFundingMinor: Math.round(deposits * 0.25) }, assetsByCurrency, liabilitiesByCurrency, hedgeContractIds: prior?.hedgeContractIds ?? [] });
    if (prior) states.at(-1)!.profitMinor += prior.profitMinor > 0 ? Math.min(prior.profitMinor, states.at(-1)!.profitMinor) : 0;
  }
  world.bankAlmStates = states;
  if (world.clock.elapsedMonths % 6 === 0) runDepositCompetition(world);
}
