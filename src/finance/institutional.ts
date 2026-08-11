import { emitSimpleEvent } from "../core/events.ts";
import {
  accountIds,
  bankAccountBalance,
  bankAccountsForOwner,
  ensureAccount,
  postTransaction,
  seedDeposit,
  settleDepositPayment,
  transferBankAccountBalance,
} from "../core/ledger.ts";
import type { Fund, FundMandate, WorldState } from "../domain/model.ts";
import { openBrokerageAccount, placeOrder } from "../markets/exchange.ts";
import { transferShares } from "../corporate/finance.ts";

const UNIT_MICROS = 1_000_000;
const INITIAL_NAV_PER_UNIT_MINOR = 10_000;

export function calculateFundNav(world: WorldState, fundId: string): { assetsMinor: number; liabilitiesMinor: number; navMinor: number; navPerUnitMinor: number } {
  const fund = world.funds.find((item) => item.id === fundId);
  if (!fund) return { assetsMinor: 0, liabilitiesMinor: 0, navMinor: 0, navPerUnitMinor: 0 };
  const cashMinor = bankAccountBalance(world, fund.bankAccountId);
  const securitiesMinor = world.equityHoldings.filter((holding) => holding.ownerId === fund.id && holding.shares > 0).reduce((sum, holding) => {
    const listing = world.listings.find((item) => item.securityId === holding.securityId);
    return sum + holding.shares * (listing?.lastPriceCents ?? Math.round(holding.costBasisCents / Math.max(1, holding.shares)));
  }, 0);
  const corporateBondsMinor = world.bondHoldings
    .filter((holding) => holding.holderId === fund.id && holding.faceValueCents > 0)
    .reduce((sum, holding) => sum + holding.costBasisCents, 0);
  const sovereignBondsMinor = world.sovereignBondHoldings
    .filter((holding) => holding.holderId === fund.id && holding.faceValueMinor > 0)
    .reduce((sum, holding) => {
      const bond = world.sovereignBonds.find((item) => item.id === holding.bondId);
      if (!bond || bond.outstandingFaceValueMinor <= 0) return sum;
      return sum + Math.round(bond.marketPriceMinor * holding.faceValueMinor / bond.outstandingFaceValueMinor);
    }, 0);
  const liabilitiesMinor = world.marginAccounts.filter((account) => account.ownerId === fund.id && account.status !== "closed").reduce((sum, account) => sum + account.borrowedMinor, 0)
    + world.repoAgreements.filter((repo) => repo.cashBorrowerId === fund.id && repo.status === "active").reduce((sum, repo) => sum + repo.cashAmountMinor, 0);
  const assetsMinor = cashMinor + securitiesMinor + corporateBondsMinor + sovereignBondsMinor;
  const navMinor = assetsMinor - liabilitiesMinor;
  const navPerUnitMinor = fund.unitsOutstandingMicros > 0 ? Math.max(0, Math.round(navMinor * UNIT_MICROS / fund.unitsOutstandingMicros)) : INITIAL_NAV_PER_UNIT_MINOR;
  fund.navMinor = navMinor;
  return { assetsMinor, liabilitiesMinor, navMinor, navPerUnitMinor };
}

export function assetManagerAum(world: WorldState, managerId: string): number {
  return world.funds.filter((fund) => fund.managerId === managerId && fund.status !== "closed").reduce((sum, fund) => sum + calculateFundNav(world, fund.id).navMinor, 0);
}

function upsertFundUnitHolding(world: WorldState, fund: Fund, investorId: string, unitsMicros: number, costMinor: number): void {
  let holding = world.fundUnitHoldings.find((item) => item.fundId === fund.id && item.investorId === investorId);
  if (!holding) {
    holding = { id: `fund-unit-${String(world.nextFundUnitHoldingId++).padStart(8, "0")}`, fundId: fund.id, investorId, unitsMicros: 0, costBasisMinor: 0 };
    world.fundUnitHoldings.push(holding);
  }
  holding.unitsMicros += unitsMicros;
  holding.costBasisMinor += costMinor;
  if (fund.type === "etf" && fund.unitSecurityId) {
    let equity = world.equityHoldings.find((item) => item.ownerId === investorId && item.securityId === fund.unitSecurityId);
    if (!equity) {
      equity = { id: `holding-${world.nextHoldingId++}`, securityId: fund.unitSecurityId, ownerId: investorId, shares: 0, costBasisCents: 0, dividendsReceivedCents: 0 };
      world.equityHoldings.push(equity);
    }
    equity.shares += Math.floor(unitsMicros / UNIT_MICROS);
    equity.costBasisCents += costMinor;
    const security = world.equitySecurities.find((item) => item.id === fund.unitSecurityId);
    if (security) security.sharesOutstanding = Math.floor(fund.unitsOutstandingMicros / UNIT_MICROS);
  }
}

export function subscribeFund(world: WorldState, fundId: string, investorId: string, amountMinor: number, investorBankAccountId?: string): { ok: boolean; message: string; unitsMicros?: number } {
  const fund = world.funds.find((item) => item.id === fundId && item.status === "active");
  const source = investorBankAccountId
    ? world.bankAccounts.find((account) => account.id === investorBankAccountId && account.ownerId === investorId && account.currencyId === fund?.currencyId && account.status === "active")
    : bankAccountsForOwner(world, investorId, fund?.currencyId)[0];
  amountMinor = Math.floor(amountMinor);
  if (!fund || !source || amountMinor <= 0 || bankAccountBalance(world, source.id) < amountMinor) return { ok: false, message: "Недостаточно денег или фонд недоступен" };
  const before = calculateFundNav(world, fund.id);
  const unitsMicros = Math.max(1, Math.floor(amountMinor * UNIT_MICROS / Math.max(1, before.navPerUnitMinor)));
  const cashTx = transferBankAccountBalance(world, source.id, fund.bankAccountId, amountMinor, "FUND_SUBSCRIPTION", `Подписка на ${fund.name}`, [fund.id]);
  if (!cashTx) return { ok: false, message: "Платёж подписки отклонён" };
  const assetId = accountIds.fundUnits(investorId, fund.id);
  const capitalId = accountIds.fundUnitCapital(fund.id);
  ensureAccount(world.ledger, assetId, investorId, `Паи ${fund.name}`, "asset", fund.currencyId);
  ensureAccount(world.ledger, capitalId, fund.id, "Капитал владельцев паёв", "equity", fund.currencyId);
  const unitTx = postTransaction(world, "FUND_SUBSCRIPTION", `Выпуск паёв ${fund.name}`, [
    { accountId: assetId, side: "debit", amountCents: amountMinor },
    { accountId: capitalId, side: "credit", amountCents: amountMinor },
  ], [cashTx]);
  fund.unitsOutstandingMicros += unitsMicros;
  upsertFundUnitHolding(world, fund, investorId, unitsMicros, amountMinor);
  calculateFundNav(world, fund.id);
  emitSimpleEvent(world, "FundSubscribed", "Куплены паи фонда", fund.name, [investorId, fund.id], "positive", [cashTx, unitTx], { amountMinor, unitsMicros });
  return { ok: true, message: "Подписка исполнена по NAV", unitsMicros };
}

export function redeemFund(world: WorldState, fundId: string, investorId: string, unitsMicros: number): { ok: boolean; message: string; amountMinor?: number } {
  const fund = world.funds.find((item) => item.id === fundId && item.status === "active");
  const holding = world.fundUnitHoldings.find((item) => item.fundId === fundId && item.investorId === investorId);
  const target = fund && bankAccountsForOwner(world, investorId, fund.currencyId)[0];
  unitsMicros = Math.floor(unitsMicros);
  if (!fund || !holding || !target || unitsMicros <= 0 || holding.unitsMicros < unitsMicros) return { ok: false, message: "Недостаточно паёв" };
  const nav = calculateFundNav(world, fund.id);
  const amountMinor = Math.floor(unitsMicros * nav.navPerUnitMinor / UNIT_MICROS);
  if (bankAccountBalance(world, fund.bankAccountId) < amountMinor) return { ok: false, message: "Фонду нужно продать активы перед погашением" };
  const cashTx = transferBankAccountBalance(world, fund.bankAccountId, target.id, amountMinor, "FUND_REDEMPTION", `Погашение паёв ${fund.name}`, [fund.id]);
  if (!cashTx) return { ok: false, message: "Погашение отклонено" };
  postTransaction(world, "FUND_REDEMPTION", `Аннулирование паёв ${fund.name}`, [
    { accountId: accountIds.fundUnitCapital(fund.id), side: "debit", amountCents: amountMinor },
    { accountId: accountIds.fundUnits(investorId, fund.id), side: "credit", amountCents: amountMinor },
  ], [cashTx]);
  const priorUnits = holding.unitsMicros;
  const priorFundUnits = fund.unitsOutstandingMicros;
  holding.unitsMicros -= unitsMicros;
  holding.costBasisMinor = Math.max(0, holding.costBasisMinor - Math.round(holding.costBasisMinor * unitsMicros / Math.max(1, priorUnits)));
  fund.unitsOutstandingMicros -= unitsMicros;
  if (fund.type === "etf" && fund.unitSecurityId) {
    const sharesRedeemed = Math.max(0, Math.floor(priorFundUnits / UNIT_MICROS) - Math.floor(fund.unitsOutstandingMicros / UNIT_MICROS));
    const equity = world.equityHoldings.find((item) => item.ownerId === investorId && item.securityId === fund.unitSecurityId);
    if (equity && sharesRedeemed > 0) {
      const removed = Math.min(equity.shares, sharesRedeemed);
      const priorShares = equity.shares;
      equity.shares -= removed;
      equity.costBasisCents = Math.max(0, equity.costBasisCents - Math.round(equity.costBasisCents * removed / Math.max(1, priorShares)));
      if (equity.shares === 0) world.equityHoldings.splice(world.equityHoldings.indexOf(equity), 1);
    }
    const security = world.equitySecurities.find((item) => item.id === fund.unitSecurityId);
    if (security) security.sharesOutstanding = Math.floor(fund.unitsOutstandingMicros / UNIT_MICROS);
  }
  calculateFundNav(world, fund.id);
  emitSimpleEvent(world, "FundRedeemed", "Паи погашены", fund.name, [investorId, fund.id], "info", [cashTx], { amountMinor, unitsMicros });
  return { ok: true, message: "Паи погашены по NAV", amountMinor };
}

export const createEtfUnits = subscribeFund;
export const redeemEtfUnits = redeemFund;

export function chargeFundFees(world: WorldState): void {
  for (const fund of world.funds.filter((item) => item.status === "active")) {
    const manager = world.assetManagers.find((item) => item.id === fund.managerId);
    if (!manager) continue;
    const nav = calculateFundNav(world, fund.id);
    const fee = Math.min(bankAccountBalance(world, fund.bankAccountId), Math.max(0, Math.round(nav.navMinor * fund.managementFeeBps / 10_000 / 12)));
    if (fee <= 0) continue;
    ensureAccount(world.ledger, accountIds.operatingExpense(fund.id), fund.id, "Комиссия за управление", "expense", fund.currencyId);
    ensureAccount(world.ledger, accountIds.operatingIncome(manager.id), manager.id, "Комиссия за управление", "income", fund.currencyId);
    const tx = settleDepositPayment(world, fund.id, manager.id, fee, "MANAGEMENT_FEE", `Управление ${fund.name}`, accountIds.operatingExpense(fund.id), accountIds.operatingIncome(manager.id));
    if (tx) {
      manager.revenueMinor += fee;
      calculateFundNav(world, fund.id);
      emitSimpleEvent(world, "FundFeeCharged", "Комиссия фонда начислена", fund.name, [fund.id, manager.id], "info", [tx], { feeMinor: fee });
    }
  }
}

export function contributeToPensionFund(world: WorldState, fundId: string, contributorId: string, amountMinor: number): boolean {
  const result = subscribeFund(world, fundId, contributorId, amountMinor);
  if (!result.ok) return false;
  const last = world.ledger.transactions.at(-1);
  if (last) last.kind = "PENSION_CONTRIBUTION";
  return true;
}

export function rebalanceInstitutionalPortfolios(world: WorldState): void {
  for (const fund of world.funds.filter((item) => item.status === "active" && item.type !== "private-capital")) {
    const nav = calculateFundNav(world, fund.id);
    if (nav.navMinor <= 0 || bankAccountBalance(world, fund.bankAccountId) < nav.navMinor * fund.mandate.cashBufferBps / 10_000) continue;
    const account = openBrokerageAccount(world, fund.id).ok ? world.brokerageAccounts.find((item) => item.ownerId === fund.id && item.currencyId === fund.currencyId && item.status === "active") : null;
    if (!account) continue;
    const candidates = world.listings.filter((listing) => listing.currencyId === fund.currencyId && fund.mandate.countryIds.includes(world.exchanges.find((exchange) => exchange.id === listing.exchangeId)?.countryId ?? ""));
    const scored = candidates.map((listing) => {
      const company = world.companies.find((item) => item.id === listing.companyId);
      if (!company) return { listing, score: -Infinity };
      const earnings = company.financialReports.slice(-12).reduce((sum, report) => sum + report.netIncomeCents, 0);
      const yieldBps = Math.round(earnings * 10_000 / Math.max(1, listing.lastPriceCents * world.equitySecurities.find((security) => security.id === listing.securityId)!.sharesOutstanding));
      return { listing, score: yieldBps + company.qualityBps / 20 - company.distressMonths * 500 };
    }).sort((left, right) => right.score - left.score);
    const selected = scored[0]?.listing;
    if (!selected) continue;
    const positionValue = world.equityHoldings.filter((holding) => holding.ownerId === fund.id && holding.securityId === selected.securityId).reduce((sum, holding) => sum + holding.shares * selected.lastPriceCents, 0);
    const maxPosition = nav.navMinor * fund.mandate.maxPositionBps / 10_000;
    const budget = Math.min(bankAccountBalance(world, fund.bankAccountId) - Math.round(nav.navMinor * fund.mandate.cashBufferBps / 10_000), maxPosition - positionValue);
    const quantity = Math.max(0, Math.floor(budget / Math.max(1, selected.lastPriceCents)));
    if (quantity > 0) placeOrder(world, account.id, selected.securityId, "buy", "limit", Math.min(quantity, 100), Math.round(selected.lastPriceCents * 1.01));
  }
}

export function createUnderwritingMandate(world: WorldState, investmentBankId: string, clientCompanyId: string, type: "ipo" | "bond" | "ma", targetAmountMinor: number, feeBps = 180) {
  const mandate = { id: `underwriting-${world.investmentBankMandates.length + 1}`, investmentBankId, clientCompanyId, type, feeBps, targetAmountMinor, placedAmountMinor: 0, status: "active" as const };
  world.investmentBankMandates.push(mandate);
  return mandate;
}

export function closeUnderwritingMandate(world: WorldState, mandateId: string, placedAmountMinor: number): boolean {
  const mandate = world.investmentBankMandates.find((item) => item.id === mandateId && item.status === "active");
  if (!mandate) return false;
  const fee = Math.max(1, Math.round(placedAmountMinor * mandate.feeBps / 10_000));
  ensureAccount(world.ledger, accountIds.operatingExpense(mandate.clientCompanyId), mandate.clientCompanyId, "Услуги андеррайтера", "expense");
  ensureAccount(world.ledger, accountIds.operatingIncome(mandate.investmentBankId), mandate.investmentBankId, "Андеррайтинг", "income");
  const tx = settleDepositPayment(world, mandate.clientCompanyId, mandate.investmentBankId, fee, "UNDERWRITING_FEE", `Андеррайтинг ${mandate.type}`, accountIds.operatingExpense(mandate.clientCompanyId), accountIds.operatingIncome(mandate.investmentBankId));
  if (!tx) { mandate.status = "failed"; return false; }
  mandate.placedAmountMinor = placedAmountMinor;
  mandate.status = "closed";
  const manager = world.assetManagers.find((item) => item.id === mandate.investmentBankId);
  if (manager) manager.revenueMinor += fee;
  return true;
}

function defaultMandate(countryId: string): FundMandate {
  return { assetClasses: ["equity", "cash"], countryIds: [countryId], benchmarkIndexId: `index-${countryId}`, cashBufferBps: 1_500, maxPositionBps: 2_500, riskTargetBps: 5_000 };
}

function strategyFor(type: Fund["type"]) {
  if (type === "hedge") return "HEDGE_MACRO" as const;
  if (type === "pension") return "PENSION_CONSERVATIVE" as const;
  if (type === "etf") return "INDEX_FUND" as const;
  return "ACTIVE_LONG_ONLY" as const;
}

export function seedInstitutionalFinance(world: WorldState): void {
  const managerSeeds = [
    ["ru", "Север Капитал"], ["us", "Union Asset Management"], ["de", "Rhein Vermögen"],
    ["gb", "Crown Asset Partners"], ["jp", "Sakura Asset Management"], ["ca", "Maple Funds"], ["kr", "Han River Asset Management"],
  ] as const;
  const fundTypes: Fund["type"][] = ["open-end", "etf", "hedge", "pension", "private-capital"];
  for (const [managerIndex, [countryId, name]] of managerSeeds.entries()) {
    const bank = world.banks.find((item) => item.countryId === countryId)!;
    const managerId = `asset-manager-${countryId}`;
    seedDeposit(world, managerId, bank.id, 80_000_000_00);
    const bankAccount = bankAccountsForOwner(world, managerId, bank.baseCurrency)[0];
    const manager = { id: managerId, name, countryId, ownerId: world.households.find((household) => world.cities.find((city) => city.id === household.cityId)?.countryId === countryId)?.id ?? world.player.householdId, bankAccountId: bankAccount.id, fundIds: [] as string[], employeeCount: 18 + managerIndex * 4, revenueMinor: 0, expensesMinor: 0 };
    world.assetManagers.push(manager);
    const types = managerIndex === 0 ? ["open-end", "pension"] as Fund["type"][] : managerIndex === 1 ? ["etf", "hedge", "private-capital"] as Fund["type"][] : [fundTypes[(managerIndex + 1) % fundTypes.length]];
    for (const [localIndex, type] of types.entries()) {
      const fundId = `fund-${countryId}-${type}-${localIndex + 1}`;
      seedDeposit(world, fundId, bank.id, 1);
      const fundAccount = bankAccountsForOwner(world, fundId, bank.baseCurrency)[0];
      const fund: Fund = {
        id: fundId,
        name: `${name} · ${type === "open-end" ? "Открытый фонд" : type === "etf" ? "Биржевой фонд" : type === "hedge" ? "Хедж-фонд" : type === "pension" ? "Пенсионный фонд" : "Фонд частного капитала"}`,
        type,
        managerId,
        currencyId: bank.baseCurrency,
        bankAccountId: fundAccount.id,
        unitSecurityId: type === "etf" ? `security-${fundId}` : null,
        unitsOutstandingMicros: 0,
        navMinor: 0,
        highWaterMarkMinorPerUnit: INITIAL_NAV_PER_UNIT_MINOR,
        managementFeeBps: type === "hedge" ? 180 : type === "pension" ? 45 : 90,
        performanceFeeBps: type === "hedge" ? 1_500 : 0,
        mandate: { ...defaultMandate(countryId), assetClasses: type === "hedge" || type === "pension" ? ["equity", "sovereign-bond", "cash", "derivative"] : defaultMandate(countryId).assetClasses },
        strategyProfileId: strategyFor(type),
        primeBrokerIds: world.banks.filter((item) => item.countryId === countryId).slice(0, 2).map((item) => item.id),
        status: "active",
      };
      world.funds.push(fund);
      manager.fundIds.push(fund.id);
      subscribeFund(world, fund.id, manager.id, 8_000_000_00, manager.bankAccountId);
      if (type === "etf" && fund.unitSecurityId) {
        const exchange = world.exchanges.find((item) => item.countryId === countryId)!;
        const shares = Math.floor(fund.unitsOutstandingMicros / UNIT_MICROS);
        world.equitySecurities.push({ id: fund.unitSecurityId, companyId: fund.id, className: "Паи ETF", currencyId: fund.currencyId, sharesOutstanding: shares, votesPerShare: 0, status: "listed" });
        world.listings.push({ id: `listing-${fund.id}`, exchangeId: exchange.id, companyId: fund.id, securityId: fund.unitSecurityId, ticker: `${countryId.toUpperCase()}ETF`, currencyId: fund.currencyId, listedAtMonth: 0, lastPriceCents: INITIAL_NAV_PER_UNIT_MINOR, previousCloseCents: INITIAL_NAV_PER_UNIT_MINOR });
        exchange.listedSecurityIds.push(fund.unitSecurityId);
        world.marketIndices.find((index) => index.exchangeId === exchange.id)?.constituentSecurityIds.push(fund.unitSecurityId);
      }
    }
  }
  // Реальная стартовая мультивалютная позиция глобального hedge-фонда.
  const globalFund = world.funds.find((fund) => fund.type === "hedge" && fund.currencyId === "USD");
  const euroBank = world.banks.find((bank) => bank.baseCurrency === "EUR");
  if (globalFund && euroBank) {
    seedDeposit(world, globalFund.id, euroBank.id, 1_500_000_00);
  }
  for (const fund of world.funds.filter((item) => item.mandate.assetClasses.includes("derivative"))) {
    const countryId = world.assetManagers.find((manager) => manager.id === fund.managerId)?.countryId;
    const localListings = world.listings.filter((item) => world.exchanges.find((exchange) => exchange.id === item.exchangeId)?.countryId === countryId && !item.companyId.startsWith("fund-"));
    const listing = localListings[1] ?? localListings[0];
    const seller = listing && world.equityHoldings.find((holding) => holding.securityId === listing.securityId && holding.shares >= 300);
    const sellerAccount = seller && world.bankAccounts.find((account) => account.ownerId === seller.ownerId && account.currencyId === fund.currencyId && account.status === "active");
    if (listing && seller && sellerAccount) {
      transferShares(world, listing.securityId, seller.ownerId, fund.id, 300, listing.lastPriceCents, "EQUITY_SECONDARY", { buyerBankAccountId: fund.bankAccountId, sellerBankAccountId: sellerAccount.id });
      calculateFundNav(world, fund.id);
    }
  }
}

export function runInstitutionalFinance(world: WorldState): void {
  chargeFundFees(world);
  if (world.clock.elapsedMonths % 3 === 0) rebalanceInstitutionalPortfolios(world);
  for (const fund of world.funds) calculateFundNav(world, fund.id);
}
