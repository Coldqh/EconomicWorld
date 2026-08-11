import { emitSimpleEvent } from "../core/events.ts";
import {
  accountIds,
  balanceOf,
  bankAccountBalance,
  bankAccountsForOwner,
  ensureAccount,
  postTransaction,
  settleDepositPayment,
  transferBankAccountBalance,
} from "../core/ledger.ts";
import type { CollateralPledge, MarginAccount, WorldState } from "../domain/model.ts";
import { matchOrderBook, openBrokerageAccount, placeOrder } from "../markets/exchange.ts";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function listingFor(world: WorldState, securityId: string) {
  return world.listings.find((item) => item.securityId === securityId) ?? null;
}

export function securityHaircutBps(world: WorldState, securityId: string): number {
  const listing = listingFor(world, securityId);
  if (!listing) return 7_500;
  const bars = world.ohlcvBars.filter((bar) => bar.securityId === securityId).slice(-12);
  const averageVolume = bars.length ? bars.reduce((sum, bar) => sum + bar.volume, 0) / bars.length : 0;
  const volatilityBps = bars.length > 1 ? Math.round(bars.reduce((sum, bar) => sum + Math.abs(bar.highCents - bar.lowCents) * 10_000 / Math.max(1, bar.closeCents), 0) / bars.length) : 1_200;
  const company = world.companies.find((item) => item.id === listing.companyId);
  const creditPenalty = (company?.distressMonths ?? 0) * 250;
  const liquidityPenalty = averageVolume < 20 ? 1_500 : averageVolume < 100 ? 800 : 250;
  return clamp(1_200 + Math.round(volatilityBps * 0.6) + liquidityPenalty + creditPenalty, 1_500, 8_500);
}

function pledgedSecurityQuantity(world: WorldState, ownerId: string, securityId: string): number {
  return world.collateralPledges.filter((pledge) => pledge.ownerId === ownerId && pledge.assetType === "security" && pledge.assetId === securityId && pledge.status === "active").reduce((sum, pledge) => sum + pledge.quantity, 0);
}

export function pledgeSecurityCollateral(world: WorldState, ownerId: string, securedPartyId: string, securityId: string, quantity: number, purpose: "margin" | "repo" | "prime-brokerage"): CollateralPledge | null {
  const holding = world.equityHoldings.find((item) => item.ownerId === ownerId && item.securityId === securityId);
  const listing = listingFor(world, securityId);
  quantity = Math.floor(quantity);
  if (!holding || !listing || quantity <= 0 || holding.shares - pledgedSecurityQuantity(world, ownerId, securityId) < quantity) return null;
  const haircutBps = securityHaircutBps(world, securityId);
  const pledge: CollateralPledge = {
    id: `collateral-${String(world.nextCollateralId++).padStart(8, "0")}`,
    ownerId,
    securedPartyId,
    assetType: "security",
    assetId: securityId,
    quantity,
    currencyId: listing.currencyId,
    haircutBps,
    markedValueMinor: quantity * listing.lastPriceCents,
    purpose,
    status: "active",
  };
  world.collateralPledges.push(pledge);
  return pledge;
}

export function openMarginAccount(world: WorldState, ownerId: string, brokerageAccountId: string, primeBrokerId?: string): { ok: boolean; message: string; marginAccountId?: string } {
  const brokerage = world.brokerageAccounts.find((account) => account.id === brokerageAccountId && account.ownerId === ownerId && account.status === "active");
  const settlement = brokerage && world.bankAccounts.find((account) => brokerage.settlementBankAccountIds.includes(account.id) && account.currencyId === brokerage.currencyId);
  const broker = brokerage && world.brokers.find((item) => item.id === brokerage.brokerId);
  const primeBroker = world.banks.find((bank) => bank.id === (primeBrokerId ?? settlement?.bankId));
  if (!broker?.marginAvailable || !settlement || !primeBroker || primeBroker.id !== settlement.bankId) return { ok: false, message: "Маржинальный счёт требует локального прайм-брокера и расчётного счёта" };
  const existing = world.marginAccounts.find((account) => account.ownerId === ownerId && account.brokerageAccountId === brokerageAccountId && account.status !== "closed");
  if (existing) return { ok: true, message: "Маржинальный счёт уже открыт", marginAccountId: existing.id };
  const account: MarginAccount = {
    id: `margin-${String(world.nextMarginAccountId++).padStart(8, "0")}`,
    ownerId,
    primeBrokerId: primeBroker.id,
    brokerageAccountId,
    currencyId: brokerage.currencyId,
    cashMinor: bankAccountBalance(world, settlement.id),
    borrowedMinor: 0,
    initialMarginBps: 5_000,
    maintenanceMarginBps: 3_000,
    maxLeverageBps: 25_000,
    status: "active",
  };
  world.marginAccounts.push(account);
  world.primeBrokerExposures.push({ id: `pb-exposure-${account.id}`, primeBrokerId: primeBroker.id, clientId: ownerId, marginAccountId: account.id, loanMinor: 0, collateralValueMinor: 0, unrealizedExposureMinor: 0, liquidationShortfallMinor: 0, status: "active" });
  return { ok: true, message: "Маржинальный счёт открыт", marginAccountId: account.id };
}

export function marginAccountState(world: WorldState, marginAccountId: string) {
  const account = world.marginAccounts.find((item) => item.id === marginAccountId);
  if (!account) return { cashMinor: 0, longValueMinor: 0, shortValueMinor: 0, equityMinor: 0, grossExposureMinor: 0, netExposureMinor: 0, leverageBps: 0, marginUtilizationBps: 0 };
  const brokerage = world.brokerageAccounts.find((item) => item.id === account.brokerageAccountId)!;
  const settlement = world.bankAccounts.find((item) => brokerage.settlementBankAccountIds.includes(item.id) && item.currencyId === account.currencyId)!;
  const encumberedCash = world.collateralPledges.filter((pledge) => pledge.ownerId === account.ownerId && pledge.assetType === "cash" && pledge.assetId === settlement.id && pledge.status === "active").reduce((sum, pledge) => sum + pledge.quantity, 0);
  const cashMinor = Math.max(0, bankAccountBalance(world, settlement.id) - encumberedCash);
  const longValueMinor = world.equityHoldings.filter((holding) => holding.ownerId === account.ownerId && holding.shares > 0).reduce((sum, holding) => sum + holding.shares * (listingFor(world, holding.securityId)?.lastPriceCents ?? 0), 0);
  const shortValueMinor = world.shortPositions.filter((position) => position.marginAccountId === account.id && position.status === "open").reduce((sum, position) => sum + position.quantity * (listingFor(world, position.securityId)?.lastPriceCents ?? position.entryPriceMinor), 0);
  const equityMinor = cashMinor + longValueMinor - shortValueMinor - account.borrowedMinor;
  const grossExposureMinor = longValueMinor + shortValueMinor;
  const netExposureMinor = longValueMinor - shortValueMinor;
  const leverageBps = equityMinor > 0 ? Math.round(grossExposureMinor * 10_000 / equityMinor) : 100_000;
  const required = Math.round(grossExposureMinor * account.maintenanceMarginBps / 10_000);
  const marginUtilizationBps = equityMinor > 0 ? Math.round(required * 10_000 / equityMinor) : 100_000;
  account.cashMinor = cashMinor;
  return { cashMinor, longValueMinor, shortValueMinor, equityMinor, grossExposureMinor, netExposureMinor, leverageBps, marginUtilizationBps };
}

function financeMargin(world: WorldState, account: MarginAccount, amountMinor: number): boolean {
  const brokerage = world.brokerageAccounts.find((item) => item.id === account.brokerageAccountId)!;
  const settlement = world.bankAccounts.find((item) => brokerage.settlementBankAccountIds.includes(item.id) && item.currencyId === account.currencyId)!;
  const bank = world.banks.find((item) => item.id === account.primeBrokerId)!;
  amountMinor = Math.floor(amountMinor);
  if (amountMinor <= 0 || bank.id !== settlement.bankId) return false;
  const loanAsset = accountIds.marginLoanAsset(bank.id, account.id);
  const loanLiability = accountIds.marginLoanLiability(account.ownerId, account.id);
  ensureAccount(world.ledger, loanAsset, bank.id, `Маржинальное финансирование ${account.ownerId}`, "asset", account.currencyId);
  ensureAccount(world.ledger, loanLiability, account.ownerId, `Долг прайм-брокеру ${bank.name}`, "liability", account.currencyId);
  const tx = postTransaction(world, "MARGIN_FINANCE", `Маржинальное финансирование ${account.id}`, [
    { accountId: settlement.ledgerDepositAccountId, side: "debit", amountCents: amountMinor },
    { accountId: loanLiability, side: "credit", amountCents: amountMinor },
    { accountId: loanAsset, side: "debit", amountCents: amountMinor },
    { accountId: settlement.ledgerBankLiabilityAccountId, side: "credit", amountCents: amountMinor },
  ]);
  account.borrowedMinor += amountMinor;
  const exposure = world.primeBrokerExposures.find((item) => item.marginAccountId === account.id)!;
  exposure.loanMinor = account.borrowedMinor;
  return Boolean(tx);
}

export function placeMarginBuy(world: WorldState, marginAccountId: string, securityId: string, quantity: number, limitPriceMinor?: number): { ok: boolean; message: string; orderId?: string } {
  const account = world.marginAccounts.find((item) => item.id === marginAccountId && item.status === "active");
  const listing = listingFor(world, securityId);
  if (!account || !listing || listing.currencyId !== account.currencyId) return { ok: false, message: "Инструмент недоступен для маржи" };
  quantity = Math.floor(quantity);
  const price = limitPriceMinor ?? listing.lastPriceCents;
  const purchaseValue = quantity * price;
  const state = marginAccountState(world, account.id);
  const projectedGross = state.grossExposureMinor + purchaseValue;
  const ownEquity = state.equityMinor;
  if (quantity <= 0 || ownEquity * 10_000 < projectedGross * account.initialMarginBps || projectedGross * 10_000 > ownEquity * account.maxLeverageBps) return { ok: false, message: "Недостаточно начальной маржи" };
  const financing = Math.max(0, purchaseValue - Math.max(0, state.cashMinor - Math.round(projectedGross * account.initialMarginBps / 10_000)));
  if (financing > 0 && !financeMargin(world, account, financing)) return { ok: false, message: "Прайм-брокер отклонил финансирование" };
  const result = placeOrder(world, account.brokerageAccountId, securityId, "buy", limitPriceMinor ? "limit" : "market", quantity, limitPriceMinor ?? null);
  return { ok: result.ok, message: result.message, orderId: result.orderId };
}

export function checkMaintenanceMargin(world: WorldState, marginAccountId: string): boolean {
  const account = world.marginAccounts.find((item) => item.id === marginAccountId && item.status !== "closed" && item.status !== "defaulted");
  if (!account) return false;
  const state = marginAccountState(world, account.id);
  const required = Math.round(state.grossExposureMinor * account.maintenanceMarginBps / 10_000);
  if (state.grossExposureMinor <= 0 || state.equityMinor >= required) return true;
  const existing = world.marginCalls.find((call) => call.marginAccountId === account.id && call.status === "open");
  if (!existing) {
    const call = { id: `margin-call-${String(world.nextMarginCallId++).padStart(8, "0")}`, marginAccountId: account.id, requiredEquityMinor: required, currentEquityMinor: state.equityMinor, issuedAtMonth: world.clock.elapsedMonths, deadlineMonth: world.clock.elapsedMonths + 1, status: "open" as const, reason: "Equity ratio below maintenance margin" };
    world.marginCalls.push(call);
    account.status = "margin-call";
    emitSimpleEvent(world, "MarginCallIssued", "Маржинальное требование", `${account.ownerId}: требуется обеспечение`, [account.ownerId, account.primeBrokerId], "critical", [], { requiredEquityMinor: required, currentEquityMinor: state.equityMinor });
  }
  return false;
}

export function forceLiquidation(world: WorldState, marginAccountId: string): string[] {
  const account = world.marginAccounts.find((item) => item.id === marginAccountId && (item.status === "margin-call" || item.status === "active"));
  if (!account) return [];
  const orderIds: string[] = [];
  for (const holding of world.equityHoldings.filter((item) => item.ownerId === account.ownerId && item.shares > 0)) {
    const free = holding.shares - pledgedSecurityQuantity(world, account.ownerId, holding.securityId);
    if (free <= 0) continue;
    const result = placeOrder(world, account.brokerageAccountId, holding.securityId, "sell", "market", free);
    if (result.orderId) orderIds.push(result.orderId);
  }
  const call = world.marginCalls.find((item) => item.marginAccountId === account.id && item.status === "open");
  if (call) call.status = "liquidating";
  const exposure = world.primeBrokerExposures.find((item) => item.marginAccountId === account.id);
  if (exposure) exposure.status = "liquidating";
  emitSimpleEvent(world, "ForcedLiquidation", "Принудительная ликвидация", account.ownerId, [account.ownerId, account.primeBrokerId], "critical", orderIds, { orderCount: orderIds.length });
  return orderIds;
}

export function borrowSecurities(world: WorldState, marginAccountId: string, lenderId: string, securityId: string, quantity: number): { ok: boolean; message: string; loanId?: string } {
  const account = world.marginAccounts.find((item) => item.id === marginAccountId && item.status === "active");
  const lenderHolding = world.equityHoldings.find((holding) => holding.ownerId === lenderId && holding.securityId === securityId);
  const listing = listingFor(world, securityId);
  quantity = Math.floor(quantity);
  if (!account || !lenderHolding || !listing || quantity <= 0 || lenderHolding.shares - pledgedSecurityQuantity(world, lenderId, securityId) < quantity) return { ok: false, message: "Бумаги для займа недоступны" };
  const settlementId = world.brokerageAccounts.find((item) => item.id === account.brokerageAccountId)!.settlementBankAccountIds[0];
  const collateralValue = Math.round(quantity * listing.lastPriceCents * 1.25);
  const alreadyPledged = world.collateralPledges.filter((pledge) => pledge.ownerId === account.ownerId && pledge.assetType === "cash" && pledge.assetId === settlementId && pledge.status === "active").reduce((sum, pledge) => sum + pledge.quantity, 0);
  if (bankAccountBalance(world, settlementId) - alreadyPledged < collateralValue) return { ok: false, message: "Недостаточно свободного денежного обеспечения" };
  const collateral: CollateralPledge = { id: `collateral-${String(world.nextCollateralId++).padStart(8, "0")}`, ownerId: account.ownerId, securedPartyId: account.primeBrokerId, assetType: "cash", assetId: settlementId, quantity: collateralValue, currencyId: listing.currencyId, haircutBps: 0, markedValueMinor: collateralValue, purpose: "prime-brokerage", status: "active" };
  world.collateralPledges.push(collateral);
  lenderHolding.shares -= quantity;
  let borrowerHolding = world.equityHoldings.find((holding) => holding.ownerId === account.ownerId && holding.securityId === securityId);
  if (!borrowerHolding) {
    borrowerHolding = { id: `holding-${world.nextHoldingId++}`, securityId, ownerId: account.ownerId, shares: 0, costBasisCents: 0, dividendsReceivedCents: 0 };
    world.equityHoldings.push(borrowerHolding);
  }
  borrowerHolding.shares += quantity;
  const loan = { id: `securities-loan-${String(world.nextSecuritiesLoanId++).padStart(8, "0")}`, securityId, quantity, lenderId, borrowerId: account.ownerId, collateralPledgeId: collateral.id, borrowFeeBps: clamp(120 + securityHaircutBps(world, securityId) / 10, 120, 1_200), openedAtMonth: world.clock.elapsedMonths, status: "active" as const };
  world.securitiesLoans.push(loan);
  emitSimpleEvent(world, "SecuritiesBorrowed", "Ценные бумаги предоставлены в заём", securityId, [lenderId, account.ownerId, account.primeBrokerId], "info", [], { quantity });
  return { ok: true, message: "Заём бумаг открыт", loanId: loan.id };
}

export function placeShortSale(world: WorldState, marginAccountId: string, lenderId: string, securityId: string, quantity: number): { ok: boolean; message: string; positionId?: string } {
  const account = world.marginAccounts.find((item) => item.id === marginAccountId && item.status === "active");
  if (!account) return { ok: false, message: "Маржинальный счёт недоступен" };
  const borrowed = borrowSecurities(world, marginAccountId, lenderId, securityId, quantity);
  if (!borrowed.ok || !borrowed.loanId) return { ok: false, message: borrowed.message };
  const result = placeOrder(world, account.brokerageAccountId, securityId, "sell", "market", quantity);
  const filled = result.tradeIds?.reduce((sum, tradeId) => sum + (world.marketTrades.find((trade) => trade.id === tradeId)?.quantity ?? 0), 0) ?? 0;
  if (!result.ok || filled <= 0) return { ok: result.ok, message: "Бумаги заняты, заявка ожидает покупателя" };
  const position = { id: `short-${String(world.nextShortPositionId++).padStart(8, "0")}`, marginAccountId, securityId, securitiesLoanId: borrowed.loanId, quantity: filled, entryPriceMinor: world.marketTrades.find((trade) => result.tradeIds?.includes(trade.id))?.priceCents ?? listingFor(world, securityId)!.lastPriceCents, accruedBorrowFeeMinor: 0, status: "open" as const };
  world.shortPositions.push(position);
  emitSimpleEvent(world, "ShortOpened", "Открыта короткая позиция", securityId, [account.ownerId, account.primeBrokerId], "attention", result.tradeIds, { quantity: filled });
  return { ok: true, message: "Короткая позиция открыта", positionId: position.id };
}

export function buyToCover(world: WorldState, shortPositionId: string): { ok: boolean; message: string } {
  const position = world.shortPositions.find((item) => item.id === shortPositionId && item.status === "open");
  const account = position && world.marginAccounts.find((item) => item.id === position.marginAccountId);
  const loan = position && world.securitiesLoans.find((item) => item.id === position.securitiesLoanId && item.status === "active");
  if (!position || !account || !loan) return { ok: false, message: "Короткая позиция недоступна" };
  const result = placeOrder(world, account.brokerageAccountId, position.securityId, "buy", "market", position.quantity);
  const filled = result.tradeIds?.reduce((sum, tradeId) => sum + (world.marketTrades.find((trade) => trade.id === tradeId)?.quantity ?? 0), 0) ?? 0;
  if (filled < position.quantity) return { ok: false, message: "Недостаточно ликвидности для полного закрытия" };
  const borrowerHolding = world.equityHoldings.find((holding) => holding.ownerId === account.ownerId && holding.securityId === position.securityId)!;
  let lenderHolding = world.equityHoldings.find((holding) => holding.ownerId === loan.lenderId && holding.securityId === position.securityId);
  if (!lenderHolding) {
    lenderHolding = { id: `holding-${world.nextHoldingId++}`, securityId: position.securityId, ownerId: loan.lenderId, shares: 0, costBasisCents: 0, dividendsReceivedCents: 0 };
    world.equityHoldings.push(lenderHolding);
  }
  borrowerHolding.shares -= position.quantity;
  lenderHolding.shares += position.quantity;
  loan.status = "returned";
  position.status = "covered";
  const pledge = world.collateralPledges.find((item) => item.id === loan.collateralPledgeId);
  if (pledge) pledge.status = "released";
  emitSimpleEvent(world, "ShortCovered", "Короткая позиция закрыта", position.securityId, [account.ownerId, loan.lenderId], "positive", result.tradeIds, { quantity: position.quantity });
  return { ok: true, message: "Позиция закрыта, бумаги возвращены" };
}

export function chargeSecuritiesBorrowFees(world: WorldState): void {
  for (const loan of world.securitiesLoans.filter((item) => item.status === "active")) {
    const listing = listingFor(world, loan.securityId);
    const amount = Math.max(1, Math.round(loan.quantity * (listing?.lastPriceCents ?? 1) * loan.borrowFeeBps / 10_000 / 12));
    ensureAccount(world.ledger, accountIds.operatingExpense(loan.borrowerId), loan.borrowerId, "Стоимость займа бумаг", "expense", listing?.currencyId);
    ensureAccount(world.ledger, accountIds.operatingIncome(loan.lenderId), loan.lenderId, "Доход от займа бумаг", "income", listing?.currencyId);
    const tx = settleDepositPayment(world, loan.borrowerId, loan.lenderId, amount, "BORROW_FEE", `Заём ${loan.securityId}`, accountIds.operatingExpense(loan.borrowerId), accountIds.operatingIncome(loan.lenderId));
    if (tx) {
      const position = world.shortPositions.find((item) => item.securitiesLoanId === loan.id && item.status === "open");
      if (position) position.accruedBorrowFeeMinor += amount;
    }
  }
}

export function compensateBorrowedDividend(world: WorldState, securityId: string, amountPerShareMinor: number): number {
  let paid = 0;
  for (const loan of world.securitiesLoans.filter((item) => item.securityId === securityId && item.status === "active")) {
    const amount = loan.quantity * amountPerShareMinor;
    ensureAccount(world.ledger, accountIds.operatingExpense(loan.borrowerId), loan.borrowerId, "Компенсация дивиденда", "expense");
    ensureAccount(world.ledger, accountIds.dividendIncome(loan.lenderId), loan.lenderId, "Компенсация дивиденда", "income");
    const tx = settleDepositPayment(world, loan.borrowerId, loan.lenderId, amount, "DIVIDEND_COMPENSATION", `Компенсация по ${securityId}`, accountIds.operatingExpense(loan.borrowerId), accountIds.dividendIncome(loan.lenderId));
    if (tx) paid += amount;
  }
  return paid;
}

export function openRepo(world: WorldState, cashLenderId: string, cashBorrowerId: string, securityId: string, quantity: number, maturityMonths = 3, repoRateBps = 500): { ok: boolean; message: string; repoId?: string } {
  const listing = listingFor(world, securityId);
  const lenderAccount = listing && bankAccountsForOwner(world, cashLenderId, listing.currencyId)[0];
  const borrowerAccount = listing && bankAccountsForOwner(world, cashBorrowerId, listing.currencyId)[0];
  const pledge = listing && pledgeSecurityCollateral(world, cashBorrowerId, cashLenderId, securityId, quantity, "repo");
  if (!listing || !lenderAccount || !borrowerAccount || !pledge) return { ok: false, message: "Обеспечение или денежный счёт недоступны" };
  const cashAmountMinor = Math.floor(pledge.markedValueMinor * (10_000 - pledge.haircutBps) / 10_000);
  if (bankAccountBalance(world, lenderAccount.id) < cashAmountMinor) { pledge.status = "released"; return { ok: false, message: "У кредитора недостаточно денег" }; }
  const repoId = `repo-${String(world.nextRepoId++).padStart(8, "0")}`;
  const cashTx = transferBankAccountBalance(world, lenderAccount.id, borrowerAccount.id, cashAmountMinor, "REPO_OPEN", `Репо ${repoId}`, [pledge.id]);
  if (!cashTx) { pledge.status = "released"; return { ok: false, message: "Расчёт репо отклонён" }; }
  ensureAccount(world.ledger, accountIds.repoAsset(cashLenderId, repoId), cashLenderId, "Требование по репо", "asset", listing.currencyId);
  ensureAccount(world.ledger, accountIds.repoLiability(cashBorrowerId, repoId), cashBorrowerId, "Обязательство по репо", "liability", listing.currencyId);
  postTransaction(world, "REPO_OPEN", `Финансовая позиция ${repoId}`, [
    { accountId: accountIds.repoAsset(cashLenderId, repoId), side: "debit", amountCents: cashAmountMinor },
    { accountId: accountIds.repoLiability(cashBorrowerId, repoId), side: "credit", amountCents: cashAmountMinor },
  ], [cashTx]);
  world.repoAgreements.push({ id: repoId, cashLenderId, cashBorrowerId, currencyId: listing.currencyId, cashAmountMinor, collateralPledgeId: pledge.id, repoRateBps, openedAtMonth: world.clock.elapsedMonths, maturityMonth: world.clock.elapsedMonths + maturityMonths, status: "active" });
  emitSimpleEvent(world, "RepoOpened", "Репо открыто", securityId, [cashLenderId, cashBorrowerId], "info", [cashTx], { cashAmountMinor, haircutBps: pledge.haircutBps });
  return { ok: true, message: "Репо открыто", repoId };
}

export function repayRepo(world: WorldState, repoId: string): boolean {
  const repo = world.repoAgreements.find((item) => item.id === repoId && item.status === "active");
  if (!repo) return false;
  const borrower = bankAccountsForOwner(world, repo.cashBorrowerId, repo.currencyId)[0];
  const lender = bankAccountsForOwner(world, repo.cashLenderId, repo.currencyId)[0];
  const interest = Math.max(1, Math.round(repo.cashAmountMinor * repo.repoRateBps / 10_000 * Math.max(1, world.clock.elapsedMonths - repo.openedAtMonth) / 12));
  if (!borrower || !lender || bankAccountBalance(world, borrower.id) < repo.cashAmountMinor + interest) return false;
  const principalTx = transferBankAccountBalance(world, borrower.id, lender.id, repo.cashAmountMinor, "REPO_REPAYMENT", `Погашение ${repo.id}`);
  ensureAccount(world.ledger, accountIds.operatingExpense(repo.cashBorrowerId), repo.cashBorrowerId, "Проценты репо", "expense", repo.currencyId);
  ensureAccount(world.ledger, accountIds.operatingIncome(repo.cashLenderId), repo.cashLenderId, "Проценты репо", "income", repo.currencyId);
  const interestTx = settleDepositPayment(world, repo.cashBorrowerId, repo.cashLenderId, interest, "REPO_REPAYMENT", `Процент ${repo.id}`, accountIds.operatingExpense(repo.cashBorrowerId), accountIds.operatingIncome(repo.cashLenderId));
  if (!principalTx || !interestTx) return false;
  postTransaction(world, "REPO_REPAYMENT", `Закрытие ${repo.id}`, [
    { accountId: accountIds.repoLiability(repo.cashBorrowerId, repo.id), side: "debit", amountCents: repo.cashAmountMinor },
    { accountId: accountIds.repoAsset(repo.cashLenderId, repo.id), side: "credit", amountCents: repo.cashAmountMinor },
  ], [principalTx, interestTx]);
  repo.status = "repaid";
  const pledge = world.collateralPledges.find((item) => item.id === repo.collateralPledgeId);
  if (pledge) pledge.status = "released";
  emitSimpleEvent(world, "RepoRepaid", "Репо погашено", repo.id, [repo.cashLenderId, repo.cashBorrowerId], "positive", [principalTx, interestTx]);
  return true;
}

function recognizePrimeBrokerLoss(world: WorldState, account: MarginAccount, shortfallMinor: number): void {
  if (shortfallMinor <= 0) return;
  const loanAsset = accountIds.marginLoanAsset(account.primeBrokerId, account.id);
  const loss = Math.min(shortfallMinor, balanceOf(world, loanAsset));
  if (loss <= 0) return;
  ensureAccount(world.ledger, accountIds.bankCreditLoss(account.primeBrokerId), account.primeBrokerId, "Убыток контрагента", "expense", account.currencyId);
  const tx = postTransaction(world, "PRIME_BROKER_LOSS", `Убыток по ${account.id}`, [
    { accountId: accountIds.bankCreditLoss(account.primeBrokerId), side: "debit", amountCents: loss },
    { accountId: loanAsset, side: "credit", amountCents: loss },
  ]);
  const exposure = world.primeBrokerExposures.find((item) => item.marginAccountId === account.id);
  if (exposure) { exposure.liquidationShortfallMinor = loss; exposure.status = "loss"; }
  account.status = "defaulted";
  emitSimpleEvent(world, "PrimeBrokerLoss", "Прайм-брокер получил убыток", account.id, [account.primeBrokerId, account.ownerId], "critical", [tx], { lossMinor: loss });
}

export function processMarginRisk(world: WorldState): void {
  chargeSecuritiesBorrowFees(world);
  for (const account of world.marginAccounts.filter((item) => item.status !== "closed" && item.status !== "defaulted")) {
    const healthy = checkMaintenanceMargin(world, account.id);
    const call = world.marginCalls.find((item) => item.marginAccountId === account.id && item.status === "open");
    if (!healthy && call && world.clock.elapsedMonths >= call.deadlineMonth) forceLiquidation(world, account.id);
    for (const holding of world.equityHoldings.filter((item) => item.ownerId === account.ownerId && item.shares > 0)) matchOrderBook(world, holding.securityId);
    const state = marginAccountState(world, account.id);
    const exposure = world.primeBrokerExposures.find((item) => item.marginAccountId === account.id);
    if (exposure) {
      exposure.loanMinor = account.borrowedMinor;
      exposure.collateralValueMinor = world.collateralPledges.filter((pledge) => pledge.securedPartyId === account.primeBrokerId && pledge.status === "active").reduce((sum, pledge) => sum + Math.round(pledge.markedValueMinor * (10_000 - pledge.haircutBps) / 10_000), 0);
      exposure.unrealizedExposureMinor = Math.max(0, account.borrowedMinor - Math.max(0, state.equityMinor));
    }
    if (account.status === "margin-call" && state.grossExposureMinor === 0 && state.cashMinor < account.borrowedMinor) recognizePrimeBrokerLoss(world, account, account.borrowedMinor - state.cashMinor);
  }
}

export function seedLeverageFinance(world: WorldState): void {
  for (const fund of world.funds.filter((item) => item.type === "hedge")) {
    openBrokerageAccount(world, fund.id);
    const brokerage = world.brokerageAccounts.find((item) => item.ownerId === fund.id && item.status === "active");
    if (brokerage) openMarginAccount(world, fund.id, brokerage.id);
  }
}
