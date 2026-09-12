import { emitSimpleEvent } from "../core/events.ts";
import {
  accountIds,
  bankAccountBalance,
  bankAccountsForOwner,
  depositOf,
  ensureAccount,
  entityBook,
  postTransaction,
  settleDepositPayment,
  transferBankAccountBalance,
} from "../core/ledger.ts";
import type { Company, CorporateAction, EquityHolding, WorldState } from "../domain/model.ts";

export interface CorporateResult {
  ok: boolean;
  message: string;
  transactionIds: string[];
}

function result(ok: boolean, message: string, transactionIds: string[] = []): CorporateResult {
  return { ok, message, transactionIds };
}

function recordAction(
  world: WorldState,
  companyId: string,
  type: CorporateAction["type"],
  title: string,
  amountCents: number,
  relatedEntityIds: string[],
): CorporateAction {
  const action: CorporateAction = {
    id: `corporate-action-${String(world.nextCorporateActionId++).padStart(6, "0")}`,
    companyId,
    elapsedMonth: world.clock.elapsedMonths,
    type,
    title,
    amountCents,
    relatedEntityIds,
  };
  world.corporateActions.push(action);
  return action;
}

function companyCurrency(world: WorldState, company: Company): string {
  return world.countries.find((country) => country.id === company.headquartersCountryId)?.currencyReference ?? "RUB";
}

function ownerCurrency(world: WorldState, ownerId: string): string | null {
  const household = world.households.find((item) => item.id === ownerId);
  const population = world.populationCohorts.find((item) => item.id === ownerId);
  const company = world.companies.find((item) => item.id === ownerId);
  const bankId = household?.bankId ?? population?.bankId ?? company?.bankId;
  return world.banks.find((bank) => bank.id === bankId)?.baseCurrency
    ?? world.funds.find((fund) => fund.id === ownerId)?.currencyId
    ?? world.banks.find((bank) => bank.id === ownerId)?.baseCurrency
    ?? bankAccountsForOwner(world, ownerId)[0]?.currencyId
    ?? null;
}

function holdingFor(world: WorldState, securityId: string, ownerId: string): EquityHolding | undefined {
  return world.equityHoldings.find((holding) => holding.securityId === securityId && holding.ownerId === ownerId);
}

function addHolding(world: WorldState, securityId: string, ownerId: string, shares: number, costCents: number): EquityHolding {
  let holding = holdingFor(world, securityId, ownerId);
  if (!holding) {
    holding = {
      id: `holding-${world.nextHoldingId++}`,
      securityId,
      ownerId,
      shares: 0,
      costBasisCents: 0,
      dividendsReceivedCents: 0,
    };
    world.equityHoldings.push(holding);
  }
  holding.shares += shares;
  holding.costBasisCents += costCents;
  return holding;
}

function revalueSecurityBook(world: WorldState, ownerId: string, securityId: string, fromCents: number, toCents: number): string | null {
  const currency = world.equitySecurities.find((security) => security.id === securityId)?.currencyId ?? "RUB";
  const difference = Math.round(toCents - fromCents);
  if (difference === 0) return null;
  const assetId = accountIds.security(ownerId, securityId);
  ensureAccount(world.ledger, assetId, ownerId, `Акции ${securityId}`, "asset", currency);
  if (difference > 0) {
    const gainId = accountIds.securityGain(ownerId);
    ensureAccount(world.ledger, gainId, ownerId, "Доход от переоценки ценных бумаг", "income", currency);
    return postTransaction(world, "SECURITY_REVALUATION", `Переоценка ${securityId}`, [
      { accountId: assetId, side: "debit", amountCents: difference },
      { accountId: gainId, side: "credit", amountCents: difference },
    ]);
  }
  const loss = Math.abs(difference);
  const lossId = accountIds.securityLoss(ownerId);
  ensureAccount(world.ledger, lossId, ownerId, "Убыток от переоценки ценных бумаг", "expense", currency);
  return postTransaction(world, "SECURITY_REVALUATION", `Переоценка ${securityId}`, [
    { accountId: lossId, side: "debit", amountCents: loss },
    { accountId: assetId, side: "credit", amountCents: loss },
  ]);
}

export function ownershipBps(world: WorldState, securityId: string, ownerId: string): number {
  const security = world.equitySecurities.find((item) => item.id === securityId);
  if (!security || security.sharesOutstanding <= 0) return 0;
  return Math.round(((holdingFor(world, securityId, ownerId)?.shares ?? 0) * 10_000) / security.sharesOutstanding);
}

export function companyValuation(world: WorldState, companyId: string): {
  enterpriseValueLowCents: number;
  enterpriseValueCents: number;
  enterpriseValueHighCents: number;
  equityValueCents: number;
  waccBps: number;
  method: string;
} {
  const company = world.companies.find((item) => item.id === companyId);
  if (!company) throw new Error("Компания не найдена");
  const centralBank = world.centralBanks.find((item) => item.countryId === company.headquartersCountryId) ?? world.centralBank;
  const latest = company.financialReports.at(-1);
  const normalizedCashFlow = Math.max(
    1,
    latest?.netIncomeCents ?? company.lastGrossRevenueCents - company.lastOperatingExpenseCents,
  );
  const debt = world.loans.filter((loan) => loan.borrowerId === company.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0)
    + world.corporateBonds.filter((bond) => bond.issuerCompanyId === company.id && bond.status === "active").reduce((sum, bond) => sum + bond.outstandingFaceValueCents, 0);
  const waccBps = Math.max(500, centralBank.policyRateBps + 520 + company.distressMonths * 80 - Math.round(company.brandReputationBps / 40));
  const terminalGrowthBps = Math.min(300, Math.max(50, 180 + Math.round((company.productivityBps - 10_000) / 20)));
  const denominatorBps = Math.max(250, waccBps - terminalGrowthBps);
  const enterpriseValueCents = Math.round((normalizedCashFlow * 12 * 10_000) / denominatorBps);
  const cash = depositOf(world, company.id);
  return {
    enterpriseValueLowCents: Math.round(enterpriseValueCents * 0.78),
    enterpriseValueCents,
    enterpriseValueHighCents: Math.round(enterpriseValueCents * 1.24),
    equityValueCents: Math.max(0, enterpriseValueCents + cash - debt),
    waccBps,
    method: "DCF: нормализованный денежный поток и терминальная стоимость",
  };
}

export function raiseEquity(
  world: WorldState,
  companyId: string,
  investorId: string,
  requestedCents: number,
  pricePerShareCents: number,
  kind: "EQUITY_ISSUE" | "IPO" = "EQUITY_ISSUE",
): CorporateResult {
  const company = world.companies.find((item) => item.id === companyId);
  const security = company && world.equitySecurities.find((item) => item.id === company.equitySecurityId);
  if (!company || !security || !company.active) return result(false, "Компания недоступна");
  if (ownerCurrency(world, investorId) !== security.currencyId) return result(false, "Без валютного рынка доступны только инструменты в валюте владельца");
  const shares = Math.floor(requestedCents / Math.max(1, pricePerShareCents));
  const cashCents = shares * pricePerShareCents;
  if (shares <= 0 || depositOf(world, investorId) < cashCents) return result(false, "Недостаточно денег для выпуска");
  const investorAssetId = accountIds.security(investorId, security.id);
  const companyEquityId = accountIds.contributedEquity(company.id);
  ensureAccount(world.ledger, investorAssetId, investorId, `Акции ${company.name}`, "asset", security.currencyId);
  ensureAccount(world.ledger, companyEquityId, company.id, "Внесённый акционерный капитал", "equity", security.currencyId);
  const transactionId = settleDepositPayment(world, investorId, company.id, cashCents, kind, `Первичный выпуск ${company.name}`, investorAssetId, companyEquityId);
  if (!transactionId) return result(false, "Расчёт выпуска не выполнен");
  security.sharesOutstanding += shares;
  addHolding(world, security.id, investorId, shares, cashCents);
  const action = recordAction(world, company.id, kind === "IPO" ? "ipo" : "equity-raise", kind === "IPO" ? "Первичное размещение" : "Выпуск акций", cashCents, [investorId, security.id]);
  emitSimpleEvent(world, "EquityIssued", action.title, `${shares.toLocaleString("ru-RU")} акций`, [company.id, investorId], "positive", [transactionId], { cashCents, shares });
  return result(true, `Выпущено ${shares.toLocaleString("ru-RU")} акций`, [transactionId]);
}

export function transferShares(
  world: WorldState,
  securityId: string,
  sellerId: string,
  buyerId: string,
  shares: number,
  pricePerShareCents: number,
  kind: "EQUITY_SECONDARY" | "MARKET_TRADE" = "EQUITY_SECONDARY",
  settlement?: { buyerBankAccountId: string; sellerBankAccountId: string },
): CorporateResult {
  shares = Math.floor(shares);
  const security = world.equitySecurities.find((item) => item.id === securityId);
  const company = security && world.companies.find((item) => item.id === security.companyId);
  const sellerHolding = holdingFor(world, securityId, sellerId);
  const cashCents = shares * Math.floor(pricePerShareCents);
  if (!security || !company || !sellerHolding || shares <= 0 || sellerHolding.shares < shares) return result(false, "Недостаточно акций");
  const buyerSettlement = settlement && world.bankAccounts.find((account) => account.id === settlement.buyerBankAccountId && account.ownerId === buyerId && account.status === "active");
  const sellerSettlement = settlement && world.bankAccounts.find((account) => account.id === settlement.sellerBankAccountId && account.ownerId === sellerId && account.status === "active");
  if (settlement && (!buyerSettlement || !sellerSettlement || buyerSettlement.currencyId !== security.currencyId || sellerSettlement.currencyId !== security.currencyId)) return result(false, "Расчётные счета не соответствуют валюте инструмента");
  if (!settlement && (ownerCurrency(world, buyerId) !== security.currencyId || ownerCurrency(world, sellerId) !== security.currencyId)) return result(false, "Валюты сторон не совпадают");
  if ((buyerSettlement ? bankAccountBalance(world, buyerSettlement.id) : depositOf(world, buyerId)) < cashCents) return result(false, "Недостаточно денег");
  const sellerBookCents = Math.round((sellerHolding.costBasisCents * shares) / sellerHolding.shares);
  const revaluationId = revalueSecurityBook(world, sellerId, securityId, sellerBookCents, cashCents);
  const buyerAssetId = accountIds.security(buyerId, securityId);
  const sellerAssetId = accountIds.security(sellerId, securityId);
  ensureAccount(world.ledger, buyerAssetId, buyerId, `Акции ${company.name}`, "asset", security.currencyId);
  ensureAccount(world.ledger, sellerAssetId, sellerId, `Акции ${company.name}`, "asset", security.currencyId);
  let transactionIds: string[] = [];
  if (buyerSettlement && sellerSettlement) {
    const cashId = transferBankAccountBalance(world, buyerSettlement.id, sellerSettlement.id, cashCents, kind, `Денежный расчёт ${company.name}`);
    if (!cashId) return result(false, "Расчёт сделки не выполнен");
    const securityId = postTransaction(world, kind, `Передача акций ${company.name}`, [
      { accountId: buyerAssetId, side: "debit", amountCents: cashCents },
      { accountId: sellerAssetId, side: "credit", amountCents: cashCents },
    ], [cashId]);
    transactionIds = [cashId, securityId];
  } else {
    const transactionId = settleDepositPayment(world, buyerId, sellerId, cashCents, kind, `Передача акций ${company.name}`, buyerAssetId, sellerAssetId);
    if (!transactionId) return result(false, "Расчёт сделки не выполнен");
    transactionIds = [transactionId];
  }
  sellerHolding.shares -= shares;
  sellerHolding.costBasisCents -= sellerBookCents;
  addHolding(world, securityId, buyerId, shares, cashCents);
  if (sellerHolding.shares === 0) world.equityHoldings.splice(world.equityHoldings.indexOf(sellerHolding), 1);
  if (kind === "EQUITY_SECONDARY") {
    recordAction(world, company.id, "share-transfer", "Передача акций", cashCents, [sellerId, buyerId]);
    emitSimpleEvent(world, "SharesTransferred", "Передача акций", `${shares.toLocaleString("ru-RU")} акций`, [sellerId, buyerId, company.id], "info", transactionIds);
  }
  return result(true, `Передано ${shares.toLocaleString("ru-RU")} акций`, [revaluationId, ...transactionIds].filter(Boolean) as string[]);
}

export function declareDividend(world: WorldState, companyId: string, totalCents: number): CorporateResult {
  const company = world.companies.find((item) => item.id === companyId);
  const security = company && world.equitySecurities.find((item) => item.id === company.equitySecurityId);
  if (!company || !security || totalCents <= 0) return result(false, "Некорректный дивиденд");
  if (depositOf(world, company.id) < totalCents || company.retainedEarningsCents < totalCents) return result(false, "Недостаточно денег или нераспределённой прибыли");
  const holdings = world.equityHoldings.filter((holding) => holding.securityId === security.id && holding.shares > 0);
  const transactionIds: string[] = [];
  let paid = 0;
  for (let index = 0; index < holdings.length; index += 1) {
    const holding = holdings[index];
    const amount = index === holdings.length - 1 ? totalCents - paid : Math.floor((totalCents * holding.shares) / security.sharesOutstanding);
    if (amount <= 0) continue;
    const recipientIncomeId = accountIds.dividendIncome(holding.ownerId);
    ensureAccount(world.ledger, recipientIncomeId, holding.ownerId, "Дивидендный доход", "income", security.currencyId);
    const transactionId = settleDepositPayment(world, company.id, holding.ownerId, amount, "DIVIDEND", `Дивиденд ${company.name}`, accountIds.retainedEarnings(company.id), recipientIncomeId);
    if (!transactionId) return result(false, "Выплата дивиденда прервана", transactionIds);
    holding.dividendsReceivedCents += amount;
    paid += amount;
    transactionIds.push(transactionId);
  }
  company.retainedEarningsCents -= paid;
  recordAction(world, company.id, "dividend", "Дивиденд", paid, holdings.map((holding) => holding.ownerId));
  emitSimpleEvent(world, "DividendDeclared", "Выплачен дивиденд", company.name, [company.id, ...holdings.map((holding) => holding.ownerId)], "positive", transactionIds, { amountCents: paid });
  return result(true, "Дивиденд выплачен", transactionIds);
}

export function executeShareBuyback(world: WorldState, companyId: string, sellerId: string, shares: number, pricePerShareCents: number): CorporateResult {
  const company = world.companies.find((item) => item.id === companyId && item.active && item.corporateStatus === "public");
  const security = company && world.equitySecurities.find((item) => item.id === company.equitySecurityId && item.status === "listed");
  const board = company && world.corporateBoards.find((item) => item.id === company.boardId);
  if (!company || !security || !board || shares <= 0) return result(false, "Выкуп недоступен");
  const buyerAccount = bankAccountsForOwner(world, company.id, security.currencyId)[0]; const sellerAccount = bankAccountsForOwner(world, sellerId, security.currencyId)[0];
  if (!buyerAccount || !sellerAccount) return result(false, "Нет расчётного счёта");
  const transfer = transferShares(world, security.id, sellerId, company.id, shares, pricePerShareCents, "EQUITY_SECONDARY", { buyerBankAccountId: buyerAccount.id, sellerBankAccountId: sellerAccount.id });
  if (!transfer.ok) return transfer;
  const treasury = world.equityHoldings.find((item) => item.ownerId === company.id && item.securityId === security.id); const retired = Math.min(shares, treasury?.shares ?? 0);
  if (treasury) { treasury.shares -= retired; treasury.costBasisCents = Math.max(0, treasury.costBasisCents - retired * pricePerShareCents); }
  security.sharesOutstanding = Math.max(0, security.sharesOutstanding - retired);
  recordAction(world, company.id, "buyback", "Выкуп и погашение акций", retired * pricePerShareCents, [sellerId, security.id]);
  return result(true, `Погашено ${retired} акций`, transfer.transactionIds);
}

export function issueBond(
  world: WorldState,
  companyId: string,
  investorId: string,
  faceValueCents: number,
  couponBps: number,
  maturityMonths: number,
  seniority: "senior" | "subordinated" = "senior",
): CorporateResult {
  const company = world.companies.find((item) => item.id === companyId);
  if (!company || faceValueCents <= 0 || maturityMonths < 1) return result(false, "Некорректные параметры облигации");
  const currencyId = companyCurrency(world, company);
  if (ownerCurrency(world, investorId) !== currencyId) return result(false, "Облигация доступна только в локальной валюте");
  if (depositOf(world, investorId) < faceValueCents) return result(false, "Недостаточно денег");
  const bondId = `bond-${String(world.nextBondId++).padStart(6, "0")}`;
  const assetId = accountIds.bondAsset(investorId, bondId);
  const liabilityId = accountIds.bondLiability(company.id, bondId);
  ensureAccount(world.ledger, assetId, investorId, `Облигация ${company.name}`, "asset", currencyId);
  ensureAccount(world.ledger, liabilityId, company.id, `Облигационный долг ${bondId}`, "liability", currencyId);
  const transactionId = settleDepositPayment(world, investorId, company.id, faceValueCents, "BOND_ISSUE", `Выпуск облигации ${company.name}`, assetId, liabilityId);
  if (!transactionId) return result(false, "Выпуск не рассчитан");
  world.corporateBonds.push({ id: bondId, issuerCompanyId: company.id, currencyId, faceValueCents, couponBps, maturityMonth: world.clock.elapsedMonths + maturityMonths, issuedAtMonth: world.clock.elapsedMonths, outstandingFaceValueCents: faceValueCents, seniority, status: "active" });
  world.bondHoldings.push({ id: `bond-holding-${world.nextHoldingId++}`, bondId, holderId: investorId, faceValueCents, costBasisCents: faceValueCents, couponsReceivedCents: 0 });
  recordAction(world, company.id, "bond-issue", "Выпуск облигации", faceValueCents, [investorId, bondId]);
  emitSimpleEvent(world, "BondIssued", "Выпущена облигация", company.name, [company.id, investorId], "info", [transactionId], { faceValueCents, couponBps });
  return result(true, "Облигация выпущена", [transactionId]);
}

export function serviceCorporateBonds(world: WorldState): void {
  for (const bond of world.corporateBonds.filter((item) => item.status === "active")) {
    const company = world.companies.find((item) => item.id === bond.issuerCompanyId);
    if (!company) continue;
    const holdings = world.bondHoldings.filter((holding) => holding.bondId === bond.id && holding.faceValueCents > 0);
    const couponDue = world.clock.elapsedMonths > bond.issuedAtMonth && (world.clock.elapsedMonths - bond.issuedAtMonth) % 12 === 0;
    if (couponDue) {
      for (const holding of holdings) {
        const coupon = Math.floor((holding.faceValueCents * bond.couponBps) / 10_000);
        if (coupon <= 0 || depositOf(world, company.id) < coupon) { bond.status = "defaulted"; continue; }
        const expenseId = accountIds.interestExpense(company.id);
        const incomeId = accountIds.interestIncome(holding.holderId);
        ensureAccount(world.ledger, expenseId, company.id, "Купонные расходы", "expense", bond.currencyId);
        ensureAccount(world.ledger, incomeId, holding.holderId, "Купонный доход", "income", bond.currencyId);
        const transactionId = settleDepositPayment(world, company.id, holding.holderId, coupon, "BOND_COUPON", `Купон ${bond.id}`, expenseId, incomeId);
        if (transactionId) {
          holding.couponsReceivedCents += coupon;
          emitSimpleEvent(world, "BondCouponPaid", "Выплачен купон", bond.id, [company.id, holding.holderId], "positive", [transactionId], { amountCents: coupon });
        }
      }
    }
    if (world.clock.elapsedMonths < bond.maturityMonth || bond.status !== "active") continue;
    const totalDue = holdings.reduce((sum, holding) => sum + holding.faceValueCents, 0);
    if (depositOf(world, company.id) < totalDue) { bond.status = "defaulted"; continue; }
    for (const holding of holdings) {
      const transactionId = settleDepositPayment(world, company.id, holding.holderId, holding.faceValueCents, "BOND_REPAYMENT", `Погашение ${bond.id}`, accountIds.bondLiability(company.id, bond.id), accountIds.bondAsset(holding.holderId, bond.id));
      if (transactionId) emitSimpleEvent(world, "BondRepaid", "Облигация погашена", bond.id, [company.id, holding.holderId], "positive", [transactionId]);
      holding.faceValueCents = 0;
      holding.costBasisCents = 0;
    }
    bond.outstandingFaceValueCents = 0;
    bond.status = "repaid";
    recordAction(world, company.id, "bond-repaid", "Погашение облигации", totalDue, [bond.id]);
  }
}

export function acquireCompany(world: WorldState, acquirerCompanyId: string, targetCompanyId: string, offerValueCents: number): CorporateResult {
  const acquirer = world.companies.find((item) => item.id === acquirerCompanyId);
  const target = world.companies.find((item) => item.id === targetCompanyId);
  if (!acquirer || !target || acquirer.id === target.id || target.parentCompanyId) return result(false, "Сделка недоступна");
  if (companyCurrency(world, acquirer) !== companyCurrency(world, target)) return result(false, "Без валютного рынка трансграничное поглощение недоступно");
  if (depositOf(world, acquirer.id) < offerValueCents) return result(false, "У покупателя недостаточно денег");
  const security = world.equitySecurities.find((item) => item.id === target.equitySecurityId)!;
  const holdings = world.equityHoldings.filter((holding) => holding.securityId === security.id && holding.shares > 0);
  const transactionIds: string[] = [];
  let paid = 0;
  for (let index = 0; index < holdings.length; index += 1) {
    const holding = holdings[index];
    const amount = index === holdings.length - 1 ? offerValueCents - paid : Math.floor((offerValueCents * holding.shares) / security.sharesOutstanding);
    const sellerBook = holding.costBasisCents;
    const revaluationId = revalueSecurityBook(world, holding.ownerId, security.id, sellerBook, amount);
    if (revaluationId) transactionIds.push(revaluationId);
    const buyerAssetId = accountIds.acquisitionInvestment(acquirer.id, target.id);
    const sellerAssetId = accountIds.security(holding.ownerId, security.id);
    ensureAccount(world.ledger, buyerAssetId, acquirer.id, `Инвестиция в ${target.name}`, "asset", security.currencyId);
    ensureAccount(world.ledger, sellerAssetId, holding.ownerId, `Акции ${target.name}`, "asset", security.currencyId);
    const transactionId = settleDepositPayment(world, acquirer.id, holding.ownerId, amount, "ACQUISITION", `Поглощение ${target.name}`, buyerAssetId, sellerAssetId);
    if (!transactionId) return result(false, "Расчёт поглощения прерван", transactionIds);
    transactionIds.push(transactionId);
    paid += amount;
  }
  world.equityHoldings = world.equityHoldings.filter((holding) => holding.securityId !== security.id);
  addHolding(world, security.id, acquirer.id, security.sharesOutstanding, offerValueCents);
  const targetCapital = entityBook(world, target.id).capital;
  const goodwillCents = Math.max(0, offerValueCents - Math.max(0, targetCapital));
  target.parentCompanyId = acquirer.id;
  target.corporateStatus = "subsidiary";
  acquirer.subsidiaryIds.push(target.id);
  acquirer.goodwillCents += goodwillCents;
  world.acquisitions.push({ id: `acquisition-${world.nextAcquisitionId++}`, acquirerCompanyId: acquirer.id, targetCompanyId: target.id, offerValueCents, debtFinancedCents: 0, goodwillCents, status: "closed", closedAtMonth: world.clock.elapsedMonths });
  recordAction(world, acquirer.id, "acquisition", "Поглощение", offerValueCents, [target.id]);
  emitSimpleEvent(world, "AcquisitionClosed", "Поглощение завершено", `${acquirer.name} → ${target.name}`, [acquirer.id, target.id], "attention", transactionIds, { offerValueCents, goodwillCents });
  return result(true, "Поглощение завершено", transactionIds);
}

export function runBankruptcyWaterfall(world: WorldState, companyId: string): CorporateResult {
  const company = world.companies.find((item) => item.id === companyId);
  if (!company) return result(false, "Компания не найдена");
  let cash = depositOf(world, company.id);
  const transactionIds: string[] = [];
  const bonds = world.corporateBonds.filter((bond) => bond.issuerCompanyId === company.id && bond.status === "active").sort((a, b) => a.seniority.localeCompare(b.seniority));
  for (const bond of bonds) {
    for (const holding of world.bondHoldings.filter((item) => item.bondId === bond.id && item.faceValueCents > 0)) {
      const payment = Math.min(cash, holding.faceValueCents);
      if (payment <= 0) break;
      const transactionId = settleDepositPayment(world, company.id, holding.holderId, payment, "BANKRUPTCY_DISTRIBUTION", `Очередь требований ${bond.id}`, accountIds.bondLiability(company.id, bond.id), accountIds.bondAsset(holding.holderId, bond.id));
      if (transactionId) transactionIds.push(transactionId);
      holding.faceValueCents -= payment;
      bond.outstandingFaceValueCents -= payment;
      cash -= payment;
    }
    bond.status = bond.outstandingFaceValueCents === 0 ? "repaid" : "defaulted";
  }
  const security = world.equitySecurities.find((item) => item.id === company.equitySecurityId);
  if (security && cash > 0) {
    const holders = world.equityHoldings.filter((holding) => holding.securityId === security.id && holding.shares > 0);
    for (let index = 0; index < holders.length; index += 1) {
      const holding = holders[index];
      const payment = index === holders.length - 1 ? cash : Math.floor((cash * holding.shares) / security.sharesOutstanding);
      if (payment <= 0) continue;
      const transactionId = settleDepositPayment(world, company.id, holding.ownerId, payment, "BANKRUPTCY_DISTRIBUTION", `Ликвидационная стоимость ${company.name}`, accountIds.openingEquity(company.id), accountIds.security(holding.ownerId, security.id));
      if (transactionId) transactionIds.push(transactionId);
    }
  }
  company.active = false;
  company.corporateStatus = "bankrupt";
  company.closedAtMonth = world.clock.elapsedMonths;
  company.closureReason = "Банкротство и распределение конкурсной массы";
  recordAction(world, company.id, "bankruptcy", "Банкротство", depositOf(world, company.id), []);
  return result(true, "Очередь требований исполнена", transactionIds);
}

export function startIpo(world: WorldState, companyId: string, investorId: string, primaryCents: number, pricePerShareCents: number): CorporateResult {
  const company = world.companies.find((item) => item.id === companyId);
  if (!company || company.corporateStatus !== "private") return result(false, "Первичное размещение недоступно");
  const exchange = world.exchanges.find((item) => item.countryId === company.headquartersCountryId);
  if (!exchange) return result(false, "В стране нет биржи");
  const raised = raiseEquity(world, companyId, investorId, primaryCents, pricePerShareCents, "IPO");
  if (!raised.ok) return raised;
  company.corporateStatus = "public";
  const security = world.equitySecurities.find((item) => item.id === company.equitySecurityId)!;
  security.status = "listed";
  exchange.listedSecurityIds.push(security.id);
  world.listings.push({ id: `listing-${company.id}`, exchangeId: exchange.id, companyId: company.id, securityId: security.id, ticker: `NEW${company.id.split("-").at(-1)}`, currencyId: security.currencyId, listedAtMonth: world.clock.elapsedMonths, lastPriceCents: pricePerShareCents, previousCloseCents: pricePerShareCents });
  emitSimpleEvent(world, "CompanyListed", "Компания вышла на биржу", company.name, [company.id, exchange.id], "positive", raised.transactionIds);
  return raised;
}
