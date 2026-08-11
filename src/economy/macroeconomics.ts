import { emitSimpleEvent } from "../core/events.ts";
import {
  accountIds,
  balanceOf,
  bankAccountBalance,
  bankAccountsForOwner,
  depositOf,
  ensureAccount,
  entityBook,
  openBankAccount,
  postTransaction,
  seedDeposit,
  sumAccounts,
} from "../core/ledger.ts";
import type {
  CollateralPledge,
  GovernmentBudgetState,
  MacroMonthlyPoint,
  SovereignAuction,
  SovereignBond,
  SovereignBondHolding,
  SovereignMaturityBucket,
  WorldState,
} from "../domain/model.ts";
import { bankCapitalCents } from "../finance/credit.ts";
import { currencyBankAccount, settleFinancialPayment, transferFinancialPrincipal } from "../finance/financial-settlement.ts";
import { calculateFundNav } from "../finance/institutional.ts";
import { collectCountryMetrics } from "./metrics.ts";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

const MATURITY_MONTHS: Record<SovereignMaturityBucket, number> = { short: 12, "2y": 24, "5y": 60, "10y": 120, long: 240 };
const TERM_PREMIUM_BPS: Record<SovereignMaturityBucket, number> = { short: 20, "2y": 55, "5y": 105, "10y": 165, long: 235 };
const INITIAL_DEBT_MINOR: Record<string, number> = {
  ru: 12_000_000_00,
  de: 36_000_000_00,
  fr: 52_000_000_00,
  gb: 36_000_000_00,
  us: 52_000_000_00,
  jp: 132_000_000_00,
  ca: 56_000_000_00,
  it: 28_000_000_00,
  es: 42_000_000_00,
  nl: 22_000_000_00,
  kr: 24_000_000_00,
};
const INITIAL_MATURITY_WEIGHTS_BPS = [1_500, 1_750, 2_000, 2_250, 2_500] as const;

function countryBudget(world: WorldState, countryId: string): GovernmentBudgetState | null {
  return world.governmentBudgets.find((budget) => budget.countryId === countryId) ?? null;
}

function activeSovereignDebt(world: WorldState, governmentId: string): number {
  return world.sovereignBonds.filter((bond) => bond.governmentId === governmentId && (bond.status === "active" || bond.status === "restructured")).reduce((sum, bond) => sum + bond.outstandingFaceValueMinor, 0);
}

function ownerCountryId(world: WorldState, ownerId: string): string | null {
  const bank = world.banks.find((item) => item.id === ownerId);
  if (bank) return bank.countryId;
  const fund = world.funds.find((item) => item.id === ownerId);
  if (fund) return world.assetManagers.find((manager) => manager.id === fund.managerId)?.countryId ?? null;
  const household = world.households.find((item) => item.id === ownerId);
  if (household) return world.cities.find((city) => city.id === household.cityId)?.countryId ?? null;
  return null;
}

function getOrCreateSovereignHolding(world: WorldState, bondId: string, holderId: string): SovereignBondHolding {
  let holding = world.sovereignBondHoldings.find((item) => item.bondId === bondId && item.holderId === holderId);
  if (!holding) {
    holding = { id: `sovereign-holding-${String(world.nextSovereignHoldingId++).padStart(8, "0")}`, bondId, holderId, faceValueMinor: 0, bookValueMinor: 0, couponsReceivedMinor: 0 };
    world.sovereignBondHoldings.push(holding);
  }
  return holding;
}

function investorCapacity(world: WorldState, investorId: string, currencyId: string): number {
  const cash = currencyBankAccount(world, investorId, currencyId);
  if (!cash) return 0;
  const balance = bankAccountBalance(world, cash.id);
  const bank = world.banks.find((item) => item.id === investorId);
  if (bank) return Math.max(0, Math.min(balance * 0.55, bankCapitalCents(world, bank.id) * 2.5));
  const fund = world.funds.find((item) => item.id === investorId);
  if (fund) return Math.max(0, balance - Math.round(fund.navMinor * fund.mandate.cashBufferBps / 10_000));
  return Math.max(0, balance * 0.12);
}

function auctionYieldBps(world: WorldState, auction: SovereignAuction, demandMinor: number): number {
  const country = world.countries.find((item) => item.id === auction.countryId)!;
  const area = world.monetaryAreas.find((item) => item.id === country.monetaryAreaId);
  const policyRate = world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId)?.policyRateBps ?? 0;
  const macro = world.countryMacroStates.find((state) => state.countryId === country.id);
  const budget = countryBudget(world, country.id);
  const latest = [...world.countryMetricsHistory].reverse().find((point) => point.countryId === country.id);
  const debtToGdpBps = latest?.nominalGdpMinor ? Math.round(activeSovereignDebt(world, auction.governmentId) * 10_000 / (latest.nominalGdpMinor * 12)) : 0;
  const deficitPressure = budget && latest?.nominalGdpMinor ? Math.max(0, Math.round(-budget.budgetBalanceMinor * 10_000 / Math.max(1, latest.nominalGdpMinor))) : 0;
  const demandCoverageBps = Math.round(demandMinor * 10_000 / Math.max(1, auction.targetFaceValueMinor));
  return clamp(
    policyRate
      + Math.round((macro?.inflationExpectationsBps ?? 0) * 0.35)
      + TERM_PREMIUM_BPS[auction.maturityBucket]
      + Math.max(0, debtToGdpBps - 6_000) / 18
      + deficitPressure / 12
      + (macro?.sovereignRiskBps ?? 0)
      - clamp(Math.round((demandCoverageBps - 10_000) / 12), -250, 180),
    0,
    6_000,
  );
}

export function createSovereignAuction(world: WorldState, countryId: string, maturityBucket: SovereignMaturityBucket, targetFaceValueMinor: number): SovereignAuction | null {
  const country = world.countries.find((item) => item.id === countryId);
  const government = country && world.governments.find((item) => item.id === country.governmentId);
  targetFaceValueMinor = Math.floor(targetFaceValueMinor);
  if (!country || !government || targetFaceValueMinor <= 0) return null;
  const auction: SovereignAuction = {
    id: `sovereign-auction-${String(world.nextSovereignAuctionId++).padStart(8, "0")}`,
    governmentId: government.id,
    countryId,
    currencyId: country.currencyReference,
    maturityBucket,
    targetFaceValueMinor,
    allocatedFaceValueMinor: 0,
    clearingYieldBps: null,
    bidCount: 0,
    announcedAtMonth: world.clock.elapsedMonths,
    settledAtMonth: null,
    status: "announced",
  };
  world.sovereignAuctions.push(auction);
  return auction;
}

function financeSovereignPurchase(world: WorldState, investorId: string, bond: SovereignBond, amountMinor: number): string[] | null {
  const governmentAccount = currencyBankAccount(world, bond.governmentId, bond.currencyId);
  const investorAccount = currencyBankAccount(world, investorId, bond.currencyId);
  if (!governmentAccount || !investorAccount || bankAccountBalance(world, investorAccount.id) < amountMinor) return null;
  const cashTx = transferFinancialPrincipal(world, investorId, bond.governmentId, bond.currencyId, amountMinor, "SOVEREIGN_ISSUE", `Размещение ${bond.id}`);
  if (!cashTx) return null;
  const investorAsset = accountIds.sovereignBondAsset(investorId, bond.id);
  const governmentLiability = accountIds.sovereignBondLiability(bond.governmentId, bond.id);
  ensureAccount(world.ledger, investorAsset, investorId, `Государственная облигация ${bond.id}`, "asset", bond.currencyId);
  ensureAccount(world.ledger, governmentLiability, bond.governmentId, `Государственный долг ${bond.id}`, "liability", bond.currencyId);
  const positionTx = postTransaction(world, "SOVEREIGN_ISSUE", `Требование по ${bond.id}`, [
    { accountId: investorAsset, side: "debit", amountCents: amountMinor },
    { accountId: governmentLiability, side: "credit", amountCents: amountMinor },
  ], [cashTx]);
  const holding = getOrCreateSovereignHolding(world, bond.id, investorId);
  holding.faceValueMinor += amountMinor;
  holding.bookValueMinor += amountMinor;
  return [cashTx, positionTx];
}

export function runSovereignAuction(world: WorldState, auctionId: string, demandMultiplierBps = 10_000): { ok: boolean; bondId?: string; coverageBps: number } {
  const auction = world.sovereignAuctions.find((item) => item.id === auctionId && item.status === "announced");
  if (!auction) return { ok: false, coverageBps: 0 };
  const localBanks = world.banks.filter((bank) => bank.countryId === auction.countryId);
  const localFunds = world.funds.filter((fund) => ownerCountryId(world, fund.id) === auction.countryId && fund.status === "active");
  const investors = [...localBanks.map((bank) => bank.id), ...localFunds.map((fund) => fund.id)];
  const capacities = investors.map((id) => ({ id, capacity: Math.floor(investorCapacity(world, id, auction.currencyId) * demandMultiplierBps / 10_000) })).filter((item) => item.capacity > 0);
  const demandMinor = capacities.reduce((sum, item) => sum + item.capacity, 0);
  const coverageBps = Math.round(demandMinor * 10_000 / Math.max(1, auction.targetFaceValueMinor));
  auction.bidCount = capacities.length;
  auction.clearingYieldBps = auctionYieldBps(world, auction, demandMinor);
  if (coverageBps < 6_000 || capacities.length === 0) {
    auction.status = "failed";
    auction.settledAtMonth = world.clock.elapsedMonths;
    const state = world.countryMacroStates.find((item) => item.countryId === auction.countryId);
    if (state) state.sovereignRiskBps = Math.min(4_000, state.sovereignRiskBps + 120);
    emitSimpleEvent(world, "SovereignAuctionFailed", "Аукцион государственного долга не состоялся", auction.countryId, [auction.governmentId], "critical", [], { coverageBps });
    return { ok: false, coverageBps };
  }
  const allocatedFaceValueMinor = Math.min(auction.targetFaceValueMinor, demandMinor);
  const bond: SovereignBond = {
    id: `sovereign-bond-${String(world.nextSovereignBondId++).padStart(8, "0")}`,
    governmentId: auction.governmentId,
    countryId: auction.countryId,
    currencyId: auction.currencyId,
    maturityBucket: auction.maturityBucket,
    faceValueMinor: allocatedFaceValueMinor,
    outstandingFaceValueMinor: allocatedFaceValueMinor,
    couponBps: auction.clearingYieldBps,
    issuePriceMinor: allocatedFaceValueMinor,
    marketPriceMinor: allocatedFaceValueMinor,
    yieldBps: auction.clearingYieldBps,
    issuedAtMonth: world.clock.elapsedMonths,
    maturityMonth: world.clock.elapsedMonths + MATURITY_MONTHS[auction.maturityBucket],
    missedPayments: 0,
    status: "active",
  };
  world.sovereignBonds.push(bond);
  let remaining = allocatedFaceValueMinor;
  for (const investor of capacities.sort((left, right) => right.capacity - left.capacity || left.id.localeCompare(right.id))) {
    const allocation = Math.min(remaining, investor.capacity);
    if (allocation <= 0) break;
    const transactions = financeSovereignPurchase(world, investor.id, bond, allocation);
    if (!transactions) continue;
    remaining -= allocation;
  }
  const actuallyAllocated = allocatedFaceValueMinor - remaining;
  if (actuallyAllocated <= 0) {
    world.sovereignBonds.splice(world.sovereignBonds.indexOf(bond), 1);
    auction.status = "failed";
    auction.settledAtMonth = world.clock.elapsedMonths;
    return { ok: false, coverageBps };
  }
  bond.faceValueMinor = actuallyAllocated;
  bond.outstandingFaceValueMinor = actuallyAllocated;
  bond.issuePriceMinor = actuallyAllocated;
  bond.marketPriceMinor = actuallyAllocated;
  auction.allocatedFaceValueMinor = actuallyAllocated;
  auction.status = "settled";
  auction.settledAtMonth = world.clock.elapsedMonths;
  emitSimpleEvent(world, "SovereignBondIssued", "Размещён государственный долг", bond.id, [bond.governmentId, ...world.sovereignBondHoldings.filter((holding) => holding.bondId === bond.id).map((holding) => holding.holderId)], "info", [], { faceValueMinor: actuallyAllocated, yieldBps: bond.yieldBps });
  return { ok: true, bondId: bond.id, coverageBps };
}

function paySovereignCoupon(world: WorldState, bond: SovereignBond, holding: SovereignBondHolding): string | null {
  const amountMinor = Math.max(1, Math.round(holding.faceValueMinor * bond.couponBps / 10_000 / 12));
  const payer = currencyBankAccount(world, bond.governmentId, bond.currencyId);
  if (!payer || bankAccountBalance(world, payer.id) < amountMinor) return null;
  const expenseId = accountIds.sovereignInterestExpense(bond.governmentId, bond.currencyId);
  const incomeId = accountIds.sovereignInterestIncome(holding.holderId, bond.currencyId);
  ensureAccount(world.ledger, expenseId, bond.governmentId, "Проценты по государственному долгу", "expense", bond.currencyId);
  ensureAccount(world.ledger, incomeId, holding.holderId, "Доход по государственным облигациям", "income", bond.currencyId);
  const cashTx = transferFinancialPrincipal(world, bond.governmentId, holding.holderId, bond.currencyId, amountMinor, "SOVEREIGN_COUPON", `Купон ${bond.id}`);
  if (!cashTx) return null;
  const pnlTx = postTransaction(world, "SOVEREIGN_COUPON", `Купон ${bond.id}`, [
    { accountId: expenseId, side: "debit", amountCents: amountMinor },
    { accountId: incomeId, side: "credit", amountCents: amountMinor },
  ], [cashTx]);
  holding.couponsReceivedMinor += amountMinor;
  return pnlTx;
}

function repaySovereignPrincipal(world: WorldState, bond: SovereignBond, holding: SovereignBondHolding): string[] | null {
  const amountMinor = holding.faceValueMinor;
  const payer = currencyBankAccount(world, bond.governmentId, bond.currencyId);
  if (!payer || bankAccountBalance(world, payer.id) < amountMinor) return null;
  const cashTx = transferFinancialPrincipal(world, bond.governmentId, holding.holderId, bond.currencyId, amountMinor, "SOVEREIGN_REPAYMENT", `Погашение ${bond.id}`);
  if (!cashTx) return null;
  const liabilityId = accountIds.sovereignBondLiability(bond.governmentId, bond.id);
  const assetId = accountIds.sovereignBondAsset(holding.holderId, bond.id);
  const carryingValue = balanceOf(world, assetId);
  const holderGainId = accountIds.sovereignInterestIncome(holding.holderId, bond.currencyId);
  const holderLossId = accountIds.sovereignLoss(holding.holderId, bond.currencyId);
  ensureAccount(world.ledger, holderGainId, holding.holderId, "Доход от погашения государственного долга", "income", bond.currencyId);
  ensureAccount(world.ledger, holderLossId, holding.holderId, "Убыток от погашения государственного долга", "expense", bond.currencyId);
  const closeTx = postTransaction(world, "SOVEREIGN_REPAYMENT", `Закрытие ${bond.id}`, [
    { accountId: liabilityId, side: "debit", amountCents: amountMinor },
    ...(carryingValue > amountMinor ? [{ accountId: holderLossId, side: "debit" as const, amountCents: carryingValue - amountMinor }] : []),
    { accountId: assetId, side: "credit", amountCents: carryingValue },
    ...(carryingValue < amountMinor ? [{ accountId: holderGainId, side: "credit" as const, amountCents: amountMinor - carryingValue }] : []),
  ]);
  holding.faceValueMinor = 0;
  holding.bookValueMinor = 0;
  return [cashTx, closeTx];
}

export function serviceSovereignDebt(world: WorldState): void {
  for (const bond of world.sovereignBonds.filter((item) => item.status === "active" || item.status === "restructured")) {
    const holdings = world.sovereignBondHoldings.filter((holding) => holding.bondId === bond.id && holding.faceValueMinor > 0);
    let couponFailed = false;
    for (const holding of holdings) if (!paySovereignCoupon(world, bond, holding)) { couponFailed = true; break; }
    if (couponFailed) {
      bond.missedPayments += 1;
      if (bond.missedPayments >= 1) bond.status = "defaulted";
      continue;
    }
    if (world.clock.elapsedMonths < bond.maturityMonth) continue;
    const governmentCash = depositOf(world, bond.governmentId);
    if (governmentCash < bond.outstandingFaceValueMinor) {
      const auction = createSovereignAuction(world, bond.countryId, bond.maturityBucket, bond.outstandingFaceValueMinor - governmentCash + Math.round(bond.outstandingFaceValueMinor * 0.1));
      if (auction) runSovereignAuction(world, auction.id);
    }
    let principalFailed = false;
    for (const holding of holdings) if (!repaySovereignPrincipal(world, bond, holding)) { principalFailed = true; break; }
    if (principalFailed) {
      bond.missedPayments += 1;
      bond.status = "defaulted";
      emitSimpleEvent(world, "SovereignDefault", "Пропущен платёж по государственному долгу", bond.id, [bond.governmentId], "critical", [], { outstandingMinor: bond.outstandingFaceValueMinor });
    } else {
      bond.outstandingFaceValueMinor = 0;
      bond.status = "matured";
    }
  }
}

export function restructureSovereignBond(world: WorldState, bondId: string, principalHaircutBps: number, extensionMonths: number, couponReductionBps: number): boolean {
  const bond = world.sovereignBonds.find((item) => item.id === bondId && item.status === "defaulted");
  if (!bond) return false;
  principalHaircutBps = clamp(Math.floor(principalHaircutBps), 0, 9_500);
  couponReductionBps = clamp(Math.floor(couponReductionBps), 0, bond.couponBps);
  let totalHaircut = 0;
  for (const holding of world.sovereignBondHoldings.filter((item) => item.bondId === bond.id && item.faceValueMinor > 0)) {
    const haircut = Math.round(holding.faceValueMinor * principalHaircutBps / 10_000);
    if (haircut <= 0) continue;
    const assetId = accountIds.sovereignBondAsset(holding.holderId, bond.id);
    const lossId = accountIds.sovereignLoss(holding.holderId, bond.currencyId);
    const liabilityId = accountIds.sovereignBondLiability(bond.governmentId, bond.id);
    const gainId = accountIds.sovereignRestructuringGain(bond.governmentId, bond.currencyId);
    ensureAccount(world.ledger, lossId, holding.holderId, "Убыток от реструктуризации", "expense", bond.currencyId);
    ensureAccount(world.ledger, gainId, bond.governmentId, "Доход от реструктуризации", "income", bond.currencyId);
    postTransaction(world, "SOVEREIGN_RESTRUCTURE", `Реструктуризация ${bond.id}`, [
      { accountId: lossId, side: "debit", amountCents: haircut },
      { accountId: liabilityId, side: "debit", amountCents: haircut },
      { accountId: assetId, side: "credit", amountCents: haircut },
      { accountId: gainId, side: "credit", amountCents: haircut },
    ]);
    holding.faceValueMinor -= haircut;
    holding.bookValueMinor = Math.max(0, holding.bookValueMinor - haircut);
    totalHaircut += haircut;
  }
  bond.outstandingFaceValueMinor -= totalHaircut;
  bond.faceValueMinor -= totalHaircut;
  bond.couponBps -= couponReductionBps;
  bond.maturityMonth += Math.max(0, Math.floor(extensionMonths));
  bond.status = "restructured";
  bond.missedPayments = 0;
  return true;
}

function durationYears(bucket: SovereignMaturityBucket): number {
  return MATURITY_MONTHS[bucket] / 12;
}

export function updateSovereignValuations(world: WorldState): void {
  for (const country of world.countries) {
    const macro = world.countryMacroStates.find((state) => state.countryId === country.id);
    const area = world.monetaryAreas.find((item) => item.id === country.monetaryAreaId);
    const policy = world.centralBanks.find((bank) => bank.id === area?.monetaryAuthorityId)?.policyRateBps ?? 0;
    const active = world.sovereignBonds.filter((bond) => bond.countryId === country.id && (bond.status === "active" || bond.status === "restructured"));
    for (const bond of active) {
      const targetYield = clamp(policy + Math.round((macro?.inflationExpectationsBps ?? 0) * 0.35) + TERM_PREMIUM_BPS[bond.maturityBucket] + (macro?.sovereignRiskBps ?? 0), 0, 8_000);
      const oldPrice = bond.marketPriceMinor;
      const duration = Math.max(0.5, Math.min(durationYears(bond.maturityBucket), (bond.maturityMonth - world.clock.elapsedMonths) / 12));
      const priceFactorBps = clamp(10_000 - Math.round(duration * (targetYield - bond.couponBps) * 0.75), 4_000, 13_000);
      const newPrice = Math.max(1, Math.round(bond.outstandingFaceValueMinor * priceFactorBps / 10_000));
      bond.yieldBps = targetYield;
      bond.marketPriceMinor = newPrice;
      if (oldPrice <= 0 || newPrice === oldPrice) continue;
      for (const holding of world.sovereignBondHoldings.filter((item) => item.bondId === bond.id && item.faceValueMinor > 0)) {
        const newBook = Math.round(newPrice * holding.faceValueMinor / Math.max(1, bond.outstandingFaceValueMinor));
        const difference = newBook - holding.bookValueMinor;
        if (difference === 0) continue;
        const assetId = accountIds.sovereignBondAsset(holding.holderId, bond.id);
        if (difference < 0) {
          const lossId = accountIds.sovereignLoss(holding.holderId, bond.currencyId);
          ensureAccount(world.ledger, lossId, holding.holderId, "Убыток от переоценки госдолга", "expense", bond.currencyId);
          postTransaction(world, "SOVEREIGN_WRITE_DOWN", `Переоценка ${bond.id}`, [{ accountId: lossId, side: "debit", amountCents: -difference }, { accountId: assetId, side: "credit", amountCents: -difference }]);
        } else {
          const incomeId = accountIds.derivativeIncome(holding.holderId, bond.currencyId);
          ensureAccount(world.ledger, incomeId, holding.holderId, "Доход от переоценки госдолга", "income", bond.currencyId);
          postTransaction(world, "SECURITY_REVALUATION", `Переоценка ${bond.id}`, [{ accountId: assetId, side: "debit", amountCents: difference }, { accountId: incomeId, side: "credit", amountCents: difference }]);
        }
        holding.bookValueMinor = newBook;
      }
    }
    const grouped = (["short", "2y", "5y", "10y", "long"] as SovereignMaturityBucket[]).map((bucket) => {
      const bonds = active.filter((bond) => bond.maturityBucket === bucket);
      return { maturityMonths: MATURITY_MONTHS[bucket], yieldBps: bonds.length ? Math.round(bonds.reduce((sum, bond) => sum + bond.yieldBps * bond.outstandingFaceValueMinor, 0) / Math.max(1, bonds.reduce((sum, bond) => sum + bond.outstandingFaceValueMinor, 0))) : policy + TERM_PREMIUM_BPS[bucket] + (macro?.sovereignRiskBps ?? 0) };
    });
    world.yieldCurveHistory.push({ countryId: country.id, elapsedMonth: world.clock.elapsedMonths, points: grouped });
    if (macro) macro.tenYearYieldBps = grouped.find((point) => point.maturityMonths === 120)?.yieldBps ?? policy;
  }
  if (world.yieldCurveHistory.length > world.countries.length * 360) world.yieldCurveHistory.splice(0, world.yieldCurveHistory.length - world.countries.length * 360);
  for (const fund of world.funds) calculateFundNav(world, fund.id);
}

export function collectPropertyTaxes(world: WorldState): number {
  let total = 0;
  for (const budget of world.governmentBudgets) {
    const government = world.governments.find((item) => item.id === budget.governmentId)!;
    const sectors = world.housingCohorts.filter((cohort) => world.cities.find((city) => city.id === cohort.cityId)?.countryId === budget.countryId);
    for (const cohort of sectors) {
      const ownerId = `housing-sector:${cohort.cityId}`;
      const taxableBase = Math.round(cohort.salePriceCents * cohort.totalUnits * 0.02);
      const tax = Math.max(0, Math.round(taxableBase * budget.propertyTaxBps / 10_000 / 12));
      const available = currencyBankAccount(world, ownerId, government.currencyId);
      const paid = available ? settleFinancialPayment(world, ownerId, government.id, government.currencyId, Math.min(tax, bankAccountBalance(world, available.id)), "PROPERTY_TAX", `Налог на недвижимость ${cohort.cityId}`) : null;
      if (paid) total += tax;
    }
  }
  return total;
}

export function recalculateGovernmentBudgets(world: WorldState): void {
  const byGovernment = new Map(world.governmentBudgets.map((budget) => [budget.governmentId, budget]));
  for (const budget of world.governmentBudgets) {
    budget.personalTaxRevenueMinor = 0;
    budget.corporateTaxRevenueMinor = 0;
    budget.consumptionTaxRevenueMinor = 0;
    budget.propertyTaxRevenueMinor = 0;
    budget.governmentConsumptionMinor = 0;
    budget.publicInvestmentMinor = 0;
    budget.transfersMinor = 0;
    budget.educationSpendingMinor = 0;
    budget.interestSpendingMinor = 0;
  }
  for (const transaction of world.ledger.transactions) {
    if (transaction.elapsedMonth !== world.clock.elapsedMonths) continue;
    for (const entry of transaction.entries) {
      const account = world.ledger.accounts[entry.accountId];
      const budget = account && byGovernment.get(account.ownerId);
      if (!budget) continue;
      const income = account.category === "income" ? (entry.side === "credit" ? entry.amountCents : -entry.amountCents) : 0;
      const expense = account.category === "expense" ? (entry.side === "debit" ? entry.amountCents : -entry.amountCents) : 0;
      if (transaction.kind === "INCOME_TAX") budget.personalTaxRevenueMinor += income;
      else if (transaction.kind === "CORPORATE_TAX") budget.corporateTaxRevenueMinor += income;
      else if (transaction.kind === "SALES_TAX") budget.consumptionTaxRevenueMinor += income;
      else if (transaction.kind === "PROPERTY_TAX") budget.propertyTaxRevenueMinor += income;
      else if (transaction.kind === "GOODS_CLEARING") budget.governmentConsumptionMinor += expense;
      else if (transaction.kind === "PUBLIC_INVESTMENT" && entry.accountId === accountIds.infrastructure(budget.governmentId) && entry.side === "debit") budget.publicInvestmentMinor += entry.amountCents;
      else if (transaction.kind === "SOCIAL_TRANSFER") budget.transfersMinor += expense;
      else if (transaction.kind === "EDUCATION") budget.educationSpendingMinor += expense;
      else if (transaction.kind === "SOVEREIGN_COUPON") budget.interestSpendingMinor += expense;
    }
  }
  for (const budget of world.governmentBudgets) {
    budget.personalTaxRevenueMinor = Math.max(0, budget.personalTaxRevenueMinor);
    budget.corporateTaxRevenueMinor = Math.max(0, budget.corporateTaxRevenueMinor);
    budget.consumptionTaxRevenueMinor = Math.max(0, budget.consumptionTaxRevenueMinor);
    budget.propertyTaxRevenueMinor = Math.max(0, budget.propertyTaxRevenueMinor);
    budget.totalRevenueMinor = budget.personalTaxRevenueMinor + budget.corporateTaxRevenueMinor + budget.consumptionTaxRevenueMinor + budget.propertyTaxRevenueMinor;
    budget.governmentConsumptionMinor = Math.max(0, budget.governmentConsumptionMinor);
    budget.transfersMinor = Math.max(0, budget.transfersMinor);
    budget.educationSpendingMinor = Math.max(0, budget.educationSpendingMinor);
    budget.interestSpendingMinor = Math.max(0, budget.interestSpendingMinor);
    budget.totalSpendingMinor = budget.governmentConsumptionMinor + budget.publicInvestmentMinor + budget.transfersMinor + budget.educationSpendingMinor + budget.interestSpendingMinor;
    budget.primaryBalanceMinor = budget.totalRevenueMinor - (budget.totalSpendingMinor - budget.interestSpendingMinor);
    budget.budgetBalanceMinor = budget.totalRevenueMinor - budget.totalSpendingMinor;
    budget.publicDebtMinor = activeSovereignDebt(world, budget.governmentId);
    budget.infrastructureCapitalMinor = balanceOf(world, accountIds.infrastructure(budget.governmentId));
    const active = world.sovereignBonds.filter((bond) => bond.governmentId === budget.governmentId && (bond.status === "active" || bond.status === "restructured"));
    budget.debtDueNext12MonthsMinor = active.filter((bond) => bond.maturityMonth <= world.clock.elapsedMonths + 12).reduce((sum, bond) => sum + bond.outstandingFaceValueMinor, 0);
    budget.averageMaturityMonths = budget.publicDebtMinor ? Math.round(active.reduce((sum, bond) => sum + Math.max(0, bond.maturityMonth - world.clock.elapsedMonths) * bond.outstandingFaceValueMinor, 0) / budget.publicDebtMinor) : 0;
  }
}

function updateCountryMacroStates(world: WorldState): void {
  const localMetrics = collectCountryMetrics(world);
  for (const metric of localMetrics) {
    const state = world.countryMacroStates.find((item) => item.countryId === metric.countryId)!;
    const budget = countryBudget(world, metric.countryId)!;
    const previous = [...world.macroHistory].reverse().find((point) => point.countryId === metric.countryId);
    const countryCompanies = world.companies.filter((company) => company.headquartersCountryId === metric.countryId && company.active);
    const productiveCapacityValue = countryCompanies.reduce((sum, company) => sum + Math.round(company.capacityMilliUnits * Math.max(1, company.marginalCostCents) / 1_000), 0);
    const labourUtilizationBps = 10_000 - metric.unemploymentBps;
    const estimatedPotential = Math.max(metric.realGdpMinor, Math.round(productiveCapacityValue * labourUtilizationBps / 10_000));
    state.potentialOutputMinor = previous ? Math.round(previous.potentialOutputMinor * 0.9 + estimatedPotential * 0.1) : estimatedPotential;
    state.outputGapBps = Math.round((metric.realGdpMinor - state.potentialOutputMinor) * 10_000 / Math.max(1, state.potentialOutputMinor));
    const target = world.centralBanks.find((bank) => bank.id === world.countries.find((country) => country.id === metric.countryId)?.centralBankId)?.inflationTargetBps ?? 200;
    state.centralBankCredibilityBps = clamp(Math.round(state.centralBankCredibilityBps * 0.92 + Math.max(0, 10_000 - Math.abs(metric.inflationBps - target) * 3) * 0.08), 0, 10_000);
    const anchoring = state.centralBankCredibilityBps / 10_000;
    state.inflationExpectationsBps = Math.round((previous?.inflationExpectationsBps ?? target) * 0.68 + metric.inflationBps * (0.32 - anchoring * 0.12) + target * anchoring * 0.12);
    const previousCreditMinor = previous?.creditToGdpBps && previous.nominalGdpMinor ? Math.round(previous.creditToGdpBps * previous.nominalGdpMinor * 12 / 10_000) : 0;
    state.creditGrowthBps = previousCreditMinor ? Math.round((metric.creditMinor - previousCreditMinor) * 10_000 / previousCreditMinor) : 0;
    const annualizedGdpMinor = Math.max(1, metric.nominalGdpMinor * 12);
    state.creditToGdpBps = Math.round(metric.creditMinor * 10_000 / annualizedGdpMinor);
    const localBanks = world.countries.find((country) => country.id === metric.countryId)?.bankIds ?? [];
    const localLoans = world.loans.filter((loan) => localBanks.includes(loan.lenderBankId));
    state.defaultRateBps = Math.round(localLoans.filter((loan) => loan.status === "defaulted").length * 10_000 / Math.max(1, localLoans.length));
    const localDerivativeNotional = world.derivativeContracts.filter((contract) => contract.status === "active" && contract.counterpartyIds.some((id) => ownerCountryId(world, id) === metric.countryId)).reduce((sum, contract) => sum + contract.notionalMinor, 0);
    state.leverageBps = Math.round((metric.creditMinor + localDerivativeNotional) * 10_000 / annualizedGdpMinor);
    const policy = world.centralBanks.find((bank) => bank.id === world.monetaryAreas.find((area) => area.id === world.countries.find((country) => country.id === metric.countryId)?.monetaryAreaId)?.monetaryAuthorityId)?.policyRateBps ?? 0;
    state.lendingStandardsBps = clamp(3_500 + state.defaultRateBps * 2 + Math.max(0, policy - 500) - Math.round(state.creditGrowthBps / 8), 1_000, 9_500);
    state.depositRateBps = clamp(Math.round(policy * 0.62 + Math.max(0, state.lendingStandardsBps - 4_000) * 0.08), 0, 5_000);
    const activeLoans = localLoans.filter((loan) => loan.status === "active");
    state.averageLoanRateBps = activeLoans.length ? Math.round(activeLoans.reduce((sum, loan) => sum + loan.annualRateBps, 0) / activeLoans.length) : policy + 400;
    const debtToGdpBps = Math.round(budget.publicDebtMinor * 10_000 / annualizedGdpMinor);
    const deficitToGdpBps = Math.max(0, Math.round(-budget.budgetBalanceMinor * 10_000 / Math.max(1, metric.nominalGdpMinor)));
    const failedAuctions = world.sovereignAuctions.filter((auction) => auction.countryId === metric.countryId && auction.status === "failed" && auction.announcedAtMonth >= world.clock.elapsedMonths - 12).length;
    state.sovereignRiskBps = clamp(Math.round(Math.max(0, debtToGdpBps - 6_000) / 18 + deficitToGdpBps / 20 + Math.max(0, -metric.gdpGrowthBps) / 12 + failedAuctions * 90), 0, 4_500);
    budget.fiscalStressBps = clamp(Math.round(state.sovereignRiskBps + budget.debtDueNext12MonthsMinor * 10_000 / Math.max(1, budget.publicDebtMinor) / 4), 0, 10_000);
    const priorCycle = state.businessCycle;
    state.businessCycle = metric.gdpGrowthBps < -50 && metric.unemploymentBps > (previous?.unemploymentBps ?? metric.unemploymentBps)
      ? "recession"
      : priorCycle === "recession" && metric.gdpGrowthBps > 0
        ? "recovery"
        : metric.gdpGrowthBps > 80
          ? "expansion"
          : "slowdown";
    state.demandPressureBps = clamp(Math.round(state.outputGapBps * 0.3 + (metric.consumptionMinor - (previous?.consumptionContributionMinor ?? metric.consumptionMinor)) * 10_000 / Math.max(1, previous?.consumptionContributionMinor ?? metric.consumptionMinor) * 0.2), -2_000, 3_000);
    state.wagePressureBps = clamp(Math.round((600 - metric.unemploymentBps) * 0.7), -1_500, 2_500);
    const pricePressures = world.goods.map((good) => {
      const prices = world.cities.filter((city) => city.countryId === metric.countryId).map((city) => city.localPriceByGoodCents[good.id] ?? good.basePriceCents);
      return { id: good.id, pressure: prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length * 10_000 / good.basePriceCents) - 10_000 : 0 };
    });
    state.inputPressureBps = pricePressures.filter((item) => item.id === "energy" || item.id === "materials").reduce((sum, item) => sum + item.pressure, 0) / 2;
    state.housingServicesPressureBps = pricePressures.find((item) => item.id === "services")?.pressure ?? 0;
    const investment = countryCompanies.reduce((sum, company) => sum + company.lastCapitalInvestmentCents, 0);
    const inventory = countryCompanies.reduce((sum, company) => sum + Math.round((company.lastProductionMilliUnits - company.lastSalesMilliUnits) * company.marginalCostCents / 1_000), 0);
    const point: MacroMonthlyPoint = {
      ...state,
      elapsedMonth: world.clock.elapsedMonths,
      nominalGdpMinor: metric.nominalGdpMinor,
      realGdpMinor: metric.realGdpMinor,
      gdpGrowthBps: metric.gdpGrowthBps,
      inflationBps: metric.inflationBps,
      unemploymentBps: metric.unemploymentBps,
      policyRateBps: policy,
      budgetBalanceMinor: budget.budgetBalanceMinor,
      primaryBalanceMinor: budget.primaryBalanceMinor,
      publicDebtMinor: budget.publicDebtMinor,
      debtToGdpBps,
      governmentConsumptionMinor: budget.governmentConsumptionMinor,
      publicInvestmentMinor: budget.publicInvestmentMinor,
      consumptionContributionMinor: metric.consumptionMinor,
      investmentContributionMinor: investment,
      governmentContributionMinor: budget.governmentConsumptionMinor + budget.publicInvestmentMinor,
      inventoryContributionMinor: inventory,
    };
    world.macroHistory.push(point);
  }
  if (world.macroHistory.length > world.countries.length * 360) world.macroHistory.splice(0, world.macroHistory.length - world.countries.length * 360);
}

export function runMonetaryPolicy(world: WorldState): void {
  if (world.clock.elapsedMonths % 3 !== 0) return;
  for (const centralBank of world.centralBanks.filter((bank) => bank.setsPolicyRate)) {
    const area = world.monetaryAreas.find((item) => item.id === centralBank.monetaryAreaId);
    const states = world.countryMacroStates.filter((state) => area?.memberCountryIds.includes(state.countryId));
    const points = states.map((state) => [...world.macroHistory].reverse().find((point) => point.countryId === state.countryId)).filter(Boolean) as MacroMonthlyPoint[];
    if (!points.length) continue;
    const average = (selector: (point: MacroMonthlyPoint) => number) => Math.round(points.reduce((sum, point) => sum + selector(point), 0) / points.length);
    const inflation = average((point) => point.inflationBps);
    const outputGap = average((point) => point.outputGapBps);
    const unemployment = average((point) => point.unemploymentBps);
    const stress = average((point) => point.defaultRateBps + point.sovereignRiskBps);
    const expectations = average((point) => point.inflationExpectationsBps);
    const neutralRate = clamp(150 + Math.round(expectations * 0.45), 0, 1_500);
    const targetRate = clamp(neutralRate + Math.round((inflation - centralBank.inflationTargetBps) * 0.55) + Math.round(outputGap * 0.25) - Math.round(stress * 0.08), 0, 5_000);
    const previousRate = centralBank.policyRateBps;
    const newRate = clamp(Math.round(previousRate * 0.75 + targetRate * 0.25), Math.max(0, previousRate - 125), previousRate + 125);
    centralBank.policyRateBps = newRate;
    centralBank.policyRateHistory.push({ elapsedMonth: world.clock.elapsedMonths, rateBps: newRate });
    const decision = {
      id: `monetary-decision-${String(world.nextMonetaryDecisionId++).padStart(8, "0")}`,
      centralBankId: centralBank.id,
      elapsedMonth: world.clock.elapsedMonths,
      previousRateBps: previousRate,
      newRateBps: newRate,
      observedInflationBps: inflation,
      outputGapBps: outputGap,
      unemploymentBps: unemployment,
      financialStressBps: stress,
      neutralRateBps: neutralRate,
      reason: `Инфляция ${inflation}; разрыв выпуска ${outputGap}; стресс ${stress}`,
    };
    world.monetaryPolicyDecisions.push(decision);
    if (newRate !== previousRate) emitSimpleEvent(world, "InterestRateChanged", "Ключевая ставка изменена", `${centralBank.name}: ${(previousRate / 100).toFixed(2)}% → ${(newRate / 100).toFixed(2)}%`, [centralBank.id], "attention", [], decision);
  }
  for (const nationalBank of world.centralBanks.filter((bank) => !bank.setsPolicyRate)) {
    const authority = world.centralBanks.find((bank) => bank.id === world.monetaryAreas.find((area) => area.id === nationalBank.monetaryAreaId)?.monetaryAuthorityId);
    if (authority) nationalBank.policyRateBps = authority.policyRateBps;
  }
}

function updateCentralBankBalanceSheets(world: WorldState): void {
  for (const sheet of world.centralBankBalanceSheets) {
    sheet.governmentSecuritiesMinor = world.sovereignBondHoldings.filter((holding) => holding.holderId === sheet.centralBankId).reduce((sum, holding) => sum + holding.bookValueMinor, 0);
    sheet.bankLendingMinor = world.bankFunding.filter((funding) => funding.lenderId === sheet.centralBankId && funding.status === "active").reduce((sum, funding) => sum + funding.remainingCents, 0);
    sheet.bankReservesMinor = sumAccounts(world, (account) => account.ownerId === sheet.centralBankId && account.category === "liability" && account.instrument === "reserve");
    sheet.equityMinor = entityBook(world, sheet.centralBankId).capital;
  }
}

export function openMarketPurchase(world: WorldState, centralBankId: string, sellerId: string, bondId: string, faceValueMinor: number, kind: "OPEN_MARKET_PURCHASE" | "QE" = "OPEN_MARKET_PURCHASE"): boolean {
  const centralBank = world.centralBanks.find((bank) => bank.id === centralBankId);
  const bond = world.sovereignBonds.find((item) => item.id === bondId && (item.status === "active" || item.status === "restructured"));
  const sellerHolding = world.sovereignBondHoldings.find((holding) => holding.bondId === bondId && holding.holderId === sellerId);
  faceValueMinor = Math.floor(faceValueMinor);
  if (!centralBank || !bond || centralBank.currencyId !== bond.currencyId || !sellerHolding || faceValueMinor <= 0 || sellerHolding.faceValueMinor < faceValueMinor) return false;
  const consideration = Math.max(1, Math.round(bond.marketPriceMinor * faceValueMinor / Math.max(1, bond.outstandingFaceValueMinor)));
  const sellerBank = world.banks.find((bank) => bank.id === sellerId);
  const cbAsset = accountIds.sovereignBondAsset(centralBank.id, bond.id);
  const sellerAsset = accountIds.sovereignBondAsset(sellerId, bond.id);
  const sellerGain = accountIds.derivativeIncome(sellerId, bond.currencyId);
  const sellerLoss = accountIds.sovereignLoss(sellerId, bond.currencyId);
  const soldBook = Math.round(sellerHolding.bookValueMinor * faceValueMinor / Math.max(1, sellerHolding.faceValueMinor));
  ensureAccount(world.ledger, cbAsset, centralBank.id, `Государственная облигация ${bond.id}`, "asset", bond.currencyId);
  ensureAccount(world.ledger, sellerGain, sellerId, "Доход от продажи государственных облигаций", "income", bond.currencyId);
  ensureAccount(world.ledger, sellerLoss, sellerId, "Убыток от продажи государственных облигаций", "expense", bond.currencyId);
  if (sellerBank) {
    const reserveAsset = accountIds.bankReserve(sellerBank.id);
    const reserveLiability = accountIds.centralBankReserveLiability(centralBank.id, sellerBank.id);
    ensureAccount(world.ledger, reserveAsset, sellerBank.id, "Резервы", "asset", bond.currencyId);
    ensureAccount(world.ledger, reserveLiability, centralBank.id, `Резервы ${sellerBank.id}`, "liability", bond.currencyId);
    postTransaction(world, kind, `Покупка ${bond.id}`, [
      { accountId: cbAsset, side: "debit", amountCents: consideration },
      { accountId: reserveAsset, side: "debit", amountCents: consideration },
      ...(soldBook > consideration ? [{ accountId: sellerLoss, side: "debit" as const, amountCents: soldBook - consideration }] : []),
      { accountId: sellerAsset, side: "credit", amountCents: soldBook },
      { accountId: reserveLiability, side: "credit", amountCents: consideration },
      ...(soldBook < consideration ? [{ accountId: sellerGain, side: "credit" as const, amountCents: consideration - soldBook }] : []),
    ]);
  } else {
    const sellerAccount = currencyBankAccount(world, sellerId, bond.currencyId);
    if (!sellerAccount) return false;
    const bank = world.banks.find((item) => item.id === sellerAccount.bankId)!;
    const reserveAsset = accountIds.bankReserve(bank.id);
    const reserveLiability = accountIds.centralBankReserveLiability(centralBank.id, bank.id);
    postTransaction(world, kind, `Покупка ${bond.id}`, [
      { accountId: cbAsset, side: "debit", amountCents: consideration },
      { accountId: sellerAccount.ledgerDepositAccountId, side: "debit", amountCents: consideration },
      { accountId: reserveAsset, side: "debit", amountCents: consideration },
      ...(soldBook > consideration ? [{ accountId: sellerLoss, side: "debit" as const, amountCents: soldBook - consideration }] : []),
      { accountId: sellerAsset, side: "credit", amountCents: soldBook },
      { accountId: sellerAccount.ledgerBankLiabilityAccountId, side: "credit", amountCents: consideration },
      { accountId: reserveLiability, side: "credit", amountCents: consideration },
      ...(soldBook < consideration ? [{ accountId: sellerGain, side: "credit" as const, amountCents: consideration - soldBook }] : []),
    ]);
  }
  sellerHolding.faceValueMinor -= faceValueMinor;
  sellerHolding.bookValueMinor = Math.max(0, sellerHolding.bookValueMinor - soldBook);
  const cbHolding = getOrCreateSovereignHolding(world, bond.id, centralBank.id);
  cbHolding.faceValueMinor += faceValueMinor;
  cbHolding.bookValueMinor += consideration;
  const sheet = world.centralBankBalanceSheets.find((item) => item.centralBankId === centralBank.id);
  if (sheet && kind === "QE") sheet.qePurchasesMinor += consideration;
  bond.marketPriceMinor = Math.min(Math.round(bond.outstandingFaceValueMinor * 1.3), bond.marketPriceMinor + Math.max(1, Math.round(consideration * 400 / Math.max(1, bond.outstandingFaceValueMinor))));
  bond.yieldBps = Math.max(0, bond.yieldBps - Math.max(1, Math.round(faceValueMinor * 100 / Math.max(1, bond.outstandingFaceValueMinor))));
  updateCentralBankBalanceSheets(world);
  return true;
}

export function openMarketSale(world: WorldState, centralBankId: string, buyerId: string, bondId: string, faceValueMinor: number, kind: "OPEN_MARKET_SALE" | "QT" = "OPEN_MARKET_SALE"): boolean {
  const centralBank = world.centralBanks.find((bank) => bank.id === centralBankId);
  const bond = world.sovereignBonds.find((item) => item.id === bondId);
  const cbHolding = world.sovereignBondHoldings.find((holding) => holding.bondId === bondId && holding.holderId === centralBankId);
  const buyerAccount = bond && currencyBankAccount(world, buyerId, bond.currencyId);
  faceValueMinor = Math.floor(faceValueMinor);
  if (!centralBank || !bond || !cbHolding || !buyerAccount || faceValueMinor <= 0 || cbHolding.faceValueMinor < faceValueMinor) return false;
  const consideration = Math.max(1, Math.round(bond.marketPriceMinor * faceValueMinor / Math.max(1, bond.outstandingFaceValueMinor)));
  if (bankAccountBalance(world, buyerAccount.id) < consideration) return false;
  const bank = world.banks.find((item) => item.id === buyerAccount.bankId)!;
  const cbAsset = accountIds.sovereignBondAsset(centralBank.id, bond.id);
  const buyerAsset = accountIds.sovereignBondAsset(buyerId, bond.id);
  const soldBook = Math.round(cbHolding.bookValueMinor * faceValueMinor / Math.max(1, cbHolding.faceValueMinor));
  const cbGain = accountIds.derivativeIncome(centralBank.id, bond.currencyId);
  const cbLoss = accountIds.sovereignLoss(centralBank.id, bond.currencyId);
  const reserveAsset = accountIds.bankReserve(bank.id);
  const reserveLiability = accountIds.centralBankReserveLiability(centralBank.id, bank.id);
  ensureAccount(world.ledger, buyerAsset, buyerId, `Государственная облигация ${bond.id}`, "asset", bond.currencyId);
  ensureAccount(world.ledger, cbGain, centralBank.id, "Доход от продажи государственных облигаций", "income", bond.currencyId);
  ensureAccount(world.ledger, cbLoss, centralBank.id, "Убыток от продажи государственных облигаций", "expense", bond.currencyId);
  postTransaction(world, kind, `Продажа ${bond.id}`, [
    { accountId: buyerAsset, side: "debit", amountCents: consideration },
    { accountId: buyerAccount.ledgerBankLiabilityAccountId, side: "debit", amountCents: consideration },
    { accountId: reserveLiability, side: "debit", amountCents: consideration },
    ...(soldBook > consideration ? [{ accountId: cbLoss, side: "debit" as const, amountCents: soldBook - consideration }] : []),
    { accountId: cbAsset, side: "credit", amountCents: soldBook },
    { accountId: buyerAccount.ledgerDepositAccountId, side: "credit", amountCents: consideration },
    { accountId: reserveAsset, side: "credit", amountCents: consideration },
    ...(soldBook < consideration ? [{ accountId: cbGain, side: "credit" as const, amountCents: consideration - soldBook }] : []),
  ]);
  cbHolding.faceValueMinor -= faceValueMinor;
  cbHolding.bookValueMinor -= soldBook;
  const buyerHolding = getOrCreateSovereignHolding(world, bond.id, buyerId);
  buyerHolding.faceValueMinor += faceValueMinor;
  buyerHolding.bookValueMinor += consideration;
  const sheet = world.centralBankBalanceSheets.find((item) => item.centralBankId === centralBank.id);
  if (sheet && kind === "QT") sheet.qtSalesMinor += consideration;
  bond.marketPriceMinor = Math.max(Math.round(bond.outstandingFaceValueMinor * 0.4), bond.marketPriceMinor - Math.max(1, Math.round(consideration * 400 / Math.max(1, bond.outstandingFaceValueMinor))));
  bond.yieldBps += Math.max(1, Math.round(faceValueMinor * 100 / Math.max(1, bond.outstandingFaceValueMinor)));
  updateCentralBankBalanceSheets(world);
  return true;
}

export function pledgeSovereignCollateral(world: WorldState, bankId: string, centralBankId: string, bondId: string, faceValueMinor: number): CollateralPledge | null {
  const holding = world.sovereignBondHoldings.find((item) => item.bondId === bondId && item.holderId === bankId);
  const bond = world.sovereignBonds.find((item) => item.id === bondId && item.status !== "defaulted");
  const pledged = world.collateralPledges.filter((pledge) => pledge.ownerId === bankId && pledge.assetType === "sovereign-bond" && pledge.assetId === bondId && pledge.status === "active").reduce((sum, pledge) => sum + pledge.quantity, 0);
  faceValueMinor = Math.floor(faceValueMinor);
  if (!holding || !bond || faceValueMinor <= 0 || holding.faceValueMinor - pledged < faceValueMinor) return null;
  const haircutBps = clamp(500 + TERM_PREMIUM_BPS[bond.maturityBucket] * 3 + (world.countryMacroStates.find((state) => state.countryId === bond.countryId)?.sovereignRiskBps ?? 0), 500, 8_500);
  const pledge: CollateralPledge = { id: `collateral-${String(world.nextCollateralId++).padStart(8, "0")}`, ownerId: bankId, securedPartyId: centralBankId, assetType: "sovereign-bond", assetId: bondId, quantity: faceValueMinor, currencyId: bond.currencyId, haircutBps, markedValueMinor: Math.round(bond.marketPriceMinor * faceValueMinor / Math.max(1, bond.outstandingFaceValueMinor)), purpose: "central-bank", status: "active" };
  world.collateralPledges.push(pledge);
  return pledge;
}

export function requestLenderOfLastResort(world: WorldState, bankId: string, amountMinor: number, collateralBondId: string): boolean {
  const bank = world.banks.find((item) => item.id === bankId);
  const centralBank = bank && world.centralBanks.find((item) => item.id === bank.centralBankId);
  const bond = world.sovereignBonds.find((item) => item.id === collateralBondId);
  if (!bank || !centralBank || !bond || bond.currencyId !== bank.baseCurrency || amountMinor <= 0) return false;
  const requiredFace = Math.ceil(amountMinor * bond.outstandingFaceValueMinor / Math.max(1, bond.marketPriceMinor) * 10_000 / 8_500);
  const pledge = pledgeSovereignCollateral(world, bank.id, centralBank.id, bond.id, requiredFace);
  if (!pledge || Math.round(pledge.markedValueMinor * (10_000 - pledge.haircutBps) / 10_000) < amountMinor) { if (pledge) pledge.status = "released"; return false; }
  const facilityAsset = accountIds.centralBankFacilityAsset(centralBank.id, bank.id);
  const facilityLiability = accountIds.centralBankFacilityLiability(bank.id);
  const reserveAsset = accountIds.bankReserve(bank.id);
  const reserveLiability = accountIds.centralBankReserveLiability(centralBank.id, bank.id);
  ensureAccount(world.ledger, facilityAsset, centralBank.id, `Кредит ликвидности ${bank.id}`, "asset", bank.baseCurrency);
  ensureAccount(world.ledger, facilityLiability, bank.id, "Кредит ликвидности ЦБ", "liability", bank.baseCurrency);
  const tx = postTransaction(world, "CENTRAL_BANK_FACILITY", `Кредит последней инстанции ${bank.id}`, [
    { accountId: facilityAsset, side: "debit", amountCents: amountMinor },
    { accountId: reserveAsset, side: "debit", amountCents: amountMinor },
    { accountId: facilityLiability, side: "credit", amountCents: amountMinor },
    { accountId: reserveLiability, side: "credit", amountCents: amountMinor },
  ], [pledge.id]);
  world.bankFunding.push({ id: `funding-${world.nextFundingId++}`, lenderId: centralBank.id, borrowerBankId: bank.id, principalCents: amountMinor, remainingCents: amountMinor, annualRateBps: centralBank.policyRateBps + 350, issuedAtMonth: world.clock.elapsedMonths, kind: "central-bank", collateralPledgeId: pledge.id, status: "active" });
  emitSimpleEvent(world, "LenderOfLastResort", "Предоставлена ликвидность под обеспечение", bank.name, [centralBank.id, bank.id, pledge.id], "attention", [tx], { amountMinor, haircutBps: pledge.haircutBps });
  updateCentralBankBalanceSheets(world);
  return true;
}

export function insuredDepositAmount(world: WorldState, bankAccountId: string): number {
  const account = world.bankAccounts.find((item) => item.id === bankAccountId && item.status === "active");
  const countryId = account && world.banks.find((bank) => bank.id === account.bankId)?.countryId;
  const scheme = world.depositInsuranceSchemes.find((item) => item.countryId === countryId);
  return account && scheme ? Math.min(bankAccountBalance(world, account.id), scheme.coverageLimitMinor) : 0;
}

export function payDepositInsurance(world: WorldState, failedBankId: string): number {
  const bank = world.banks.find((item) => item.id === failedBankId);
  const scheme = bank && world.depositInsuranceSchemes.find((item) => item.countryId === bank.countryId);
  if (!bank || !scheme) return 0;
  const schemeAccount = world.bankAccounts.find((item) => item.id === scheme.fundBankAccountId && item.status === "active");
  if (!schemeAccount || schemeAccount.bankId === failedBankId) return 0;
  let paid = 0;
  for (const account of world.bankAccounts.filter((item) => item.bankId === failedBankId && item.ownerId !== failedBankId && item.ownerId !== scheme.id && item.status === "active")) {
    const amount = insuredDepositAmount(world, account.id);
    const failedBalance = bankAccountBalance(world, account.id);
    if (failedBalance <= 0) { account.status = "closed"; continue; }
    const receivingBank = world.banks.find((candidate) => candidate.countryId === bank.countryId && candidate.id !== failedBankId);
    if (!receivingBank) continue;
    let replacement = world.bankAccounts.find((candidate) => candidate.ownerId === account.ownerId && candidate.bankId === receivingBank.id && candidate.currencyId === scheme.currencyId && candidate.status === "active");
    if (!replacement) {
      const opened = openBankAccount(world, account.ownerId, receivingBank.id, true);
      replacement = opened.accountId ? world.bankAccounts.find((candidate) => candidate.id === opened.accountId) : undefined;
    }
    if (!replacement) continue;
    const fund = world.funds.find((item) => item.id === account.ownerId && item.bankAccountId === account.id);
    const manager = world.assetManagers.find((item) => (item.id === account.ownerId || item.ownerId === account.ownerId) && item.bankAccountId === account.id);
    const ccp = world.clearingHouses.find((item) => item.id === account.ownerId && item.bankAccountId === account.id);
    const governmentBudget = world.governmentBudgets.find((item) => item.governmentId === account.ownerId && item.cashBankAccountId === account.id);
    if (fund) fund.bankAccountId = replacement.id;
    if (manager) manager.bankAccountId = replacement.id;
    if (ccp) ccp.bankAccountId = replacement.id;
    if (governmentBudget) governmentBudget.cashBankAccountId = replacement.id;
    const ownerLoss = accountIds.sovereignLoss(account.ownerId, scheme.currencyId);
    const bankGain = accountIds.sovereignRestructuringGain(bank.id, scheme.currencyId);
    ensureAccount(world.ledger, ownerLoss, account.ownerId, "Убыток по вкладу в несостоятельном банке", "expense", scheme.currencyId);
    ensureAccount(world.ledger, bankGain, bank.id, "Списание обязательств по вкладам", "income", scheme.currencyId);
    postTransaction(world, "DEPOSIT_INSURANCE", `Закрытие вклада ${account.id}`, [
      { accountId: account.ledgerBankLiabilityAccountId, side: "debit", amountCents: failedBalance },
      { accountId: ownerLoss, side: "debit", amountCents: failedBalance },
      { accountId: account.ledgerDepositAccountId, side: "credit", amountCents: failedBalance },
      { accountId: bankGain, side: "credit", amountCents: failedBalance },
    ]);
    account.status = "closed";
    if (amount <= 0 || scheme.fundBalanceMinor < amount) { if (fund) fund.navMinor = Math.max(0, fund.navMinor - failedBalance); continue; }
    const tx = settleFinancialPayment(world, scheme.id, account.ownerId, scheme.currencyId, amount, "DEPOSIT_INSURANCE", `Страховое возмещение ${account.id}`);
    if (!tx) { if (fund) fund.navMinor = Math.max(0, fund.navMinor - failedBalance); continue; }
    scheme.fundBalanceMinor -= amount;
    if (fund) fund.navMinor = Math.max(0, fund.navMinor - failedBalance + amount);
    paid += amount;
  }
  return paid;
}

export function seedMacroeconomics(world: WorldState): void {
  if (world.governmentBudgets.length) return;
  for (const bank of world.banks) {
    const peers = world.banks.filter((candidate) => candidate.countryId === bank.countryId && candidate.id !== bank.id);
    const settlementBank = peers[0] ?? bank;
    if (!bankAccountsForOwner(world, bank.id, bank.baseCurrency).length) seedDeposit(world, bank.id, settlementBank.id, 120_000_000_00);
  }
  for (const country of world.countries) {
    const government = world.governments.find((item) => item.id === country.governmentId)!;
    const governmentAccount = bankAccountsForOwner(world, government.id, country.currencyReference)[0];
    const countryIndex = world.countries.indexOf(country);
    world.governmentBudgets.push({
      governmentId: government.id, countryId: country.id, currencyId: country.currencyReference, cashBankAccountId: governmentAccount.id,
      propertyTaxBps: 80 + (countryIndex % 4) * 20, governmentConsumptionTargetBps: 1_500 + (countryIndex % 3) * 120, publicInvestmentTargetBps: 280 + (countryIndex % 4) * 45, educationFundingBps: 350,
      personalTaxRevenueMinor: 0, corporateTaxRevenueMinor: 0, consumptionTaxRevenueMinor: 0, propertyTaxRevenueMinor: 0, totalRevenueMinor: 0,
      governmentConsumptionMinor: 0, publicInvestmentMinor: 0, transfersMinor: 0, educationSpendingMinor: 0, interestSpendingMinor: 0, totalSpendingMinor: 0,
      primaryBalanceMinor: 0, budgetBalanceMinor: 0, publicDebtMinor: 0, debtDueNext12MonthsMinor: 0, averageMaturityMonths: 0, infrastructureCapitalMinor: 0, fiscalStressBps: 0,
    });
    const centralBank = world.centralBanks.find((item) => item.id === country.centralBankId)!;
    if (!world.centralBankBalanceSheets.some((sheet) => sheet.centralBankId === centralBank.id)) world.centralBankBalanceSheets.push({ centralBankId: centralBank.id, currencyId: centralBank.currencyId, governmentSecuritiesMinor: 0, bankLendingMinor: 0, otherAssetsMinor: 0, bankReservesMinor: 0, currencyInCirculationMinor: 0, governmentDepositsMinor: 0, equityMinor: 0, qePurchasesMinor: 0, qtSalesMinor: 0 });
    world.countryMacroStates.push({ countryId: country.id, currencyId: country.currencyReference, potentialOutputMinor: 1, outputGapBps: 0, businessCycle: "expansion", inflationExpectationsBps: centralBank.inflationTargetBps, centralBankCredibilityBps: 8_000, creditGrowthBps: 0, creditToGdpBps: 0, defaultRateBps: 0, lendingStandardsBps: 4_000, leverageBps: 0, depositRateBps: Math.round(centralBank.policyRateBps * 0.6), averageLoanRateBps: centralBank.policyRateBps + 450, sovereignRiskBps: 30 + countryIndex * 8, tenYearYieldBps: centralBank.policyRateBps + 180, demandPressureBps: 0, wagePressureBps: 0, inputPressureBps: 0, housingServicesPressureBps: 0 });
    const insuranceId = `deposit-insurance-${country.id}`;
    const insuranceBank = world.banks.filter((bank) => bank.countryId === country.id)[1] ?? world.banks.find((bank) => bank.countryId === country.id)!;
    seedDeposit(world, insuranceId, insuranceBank.id, 80_000_000_00);
    const insuranceAccount = bankAccountsForOwner(world, insuranceId, country.currencyReference)[0];
    world.depositInsuranceSchemes.push({ id: insuranceId, countryId: country.id, currencyId: country.currencyReference, coverageLimitMinor: 1_400_000_00 + countryIndex * 100_000_00, fundBankAccountId: insuranceAccount.id, fundBalanceMinor: bankAccountBalance(world, insuranceAccount.id), premiumBps: 12 });
  }
  for (const country of world.countries) {
    const initialDebtMinor = INITIAL_DEBT_MINOR[country.id] ?? 32_000_000_00;
    for (const [index, bucket] of (["short", "2y", "5y", "10y", "long"] as SovereignMaturityBucket[]).entries()) {
      const auction = createSovereignAuction(world, country.id, bucket, Math.round(initialDebtMinor * INITIAL_MATURITY_WEIGHTS_BPS[index] / 10_000));
      if (auction) runSovereignAuction(world, auction.id);
    }
  }
  recalculateGovernmentBudgets(world);
  updateSovereignValuations(world);
  updateCentralBankBalanceSheets(world);
}

function automaticGovernmentBorrowing(world: WorldState): void {
  for (const budget of world.governmentBudgets) {
    const cash = depositOf(world, budget.governmentId);
    const expectedMonthlySpending = Math.max(10_000_00, budget.totalSpendingMinor || Math.round((budget.totalRevenueMinor || 20_000_00) * 1.05));
    const refinancing = budget.debtDueNext12MonthsMinor;
    if (cash >= expectedMonthlySpending * 3 && refinancing <= cash) continue;
    const need = Math.max(expectedMonthlySpending * 4 - cash, Math.round(refinancing * 0.3));
    if (need <= 0) continue;
    const bucket: SovereignMaturityBucket = budget.averageMaturityMonths < 48 ? "10y" : "5y";
    const auction = createSovereignAuction(world, budget.countryId, bucket, need);
    if (auction) runSovereignAuction(world, auction.id);
  }
}

export function runMacroeconomicMonth(world: WorldState): void {
  collectPropertyTaxes(world);
  serviceSovereignDebt(world);
  recalculateGovernmentBudgets(world);
  automaticGovernmentBorrowing(world);
  recalculateGovernmentBudgets(world);
  updateCountryMacroStates(world);
  runMonetaryPolicy(world);
  updateSovereignValuations(world);
  updateCentralBankBalanceSheets(world);
}
