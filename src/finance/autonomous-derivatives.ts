import { accountIds, bankAccountBalance } from "../core/ledger.ts";
import type { DerivativeContract, DerivativeDecisionMetadata, Fund, InstitutionStrategyProfileId, WorldState } from "../domain/model.ts";
import { openBrokerageAccount, placeOrder } from "../markets/exchange.ts";
import { convertMinor } from "./currencies.ts";
import {
  createCreditDefaultSwap,
  createForward,
  createInterestRateSwap,
  createOptionSeries,
  createTotalReturnSwap,
  floatingReferenceRateBps,
  writeOption,
} from "./derivatives.ts";

export interface InstitutionStrategyProfile {
  id: InstitutionStrategyProfileId;
  hedgeRatioBps: number;
  riskBudgetBps: number;
  minimumExposureMinor: number;
  decisionCadenceMonths: number;
  allowedTypes: DerivativeContract["type"][];
}

export const INSTITUTION_STRATEGY_PROFILES: Record<InstitutionStrategyProfileId, InstitutionStrategyProfile> = {
  PENSION_CONSERVATIVE: { id: "PENSION_CONSERVATIVE", hedgeRatioBps: 6_500, riskBudgetBps: 1_200, minimumExposureMinor: 250_000, decisionCadenceMonths: 3, allowedTypes: ["option", "interest-rate-swap", "fx-forward", "credit-default-swap"] },
  INDEX_FUND: { id: "INDEX_FUND", hedgeRatioBps: 2_500, riskBudgetBps: 1_000, minimumExposureMinor: 500_000, decisionCadenceMonths: 6, allowedTypes: ["future", "option", "fx-forward"] },
  ACTIVE_LONG_ONLY: { id: "ACTIVE_LONG_ONLY", hedgeRatioBps: 3_500, riskBudgetBps: 1_800, minimumExposureMinor: 400_000, decisionCadenceMonths: 3, allowedTypes: ["option", "future", "fx-forward", "credit-default-swap"] },
  HEDGE_RELATIVE_VALUE: { id: "HEDGE_RELATIVE_VALUE", hedgeRatioBps: 4_500, riskBudgetBps: 3_500, minimumExposureMinor: 200_000, decisionCadenceMonths: 3, allowedTypes: ["option", "future", "total-return-swap", "interest-rate-swap"] },
  HEDGE_MACRO: { id: "HEDGE_MACRO", hedgeRatioBps: 6_000, riskBudgetBps: 4_000, minimumExposureMinor: 200_000, decisionCadenceMonths: 3, allowedTypes: ["fx-forward", "interest-rate-swap", "option", "total-return-swap", "credit-default-swap"] },
  BANK_ALM: { id: "BANK_ALM", hedgeRatioBps: 5_000, riskBudgetBps: 2_000, minimumExposureMinor: 1_000_000, decisionCadenceMonths: 3, allowedTypes: ["interest-rate-swap", "fx-forward", "credit-default-swap"] },
  CORPORATE_TREASURY: { id: "CORPORATE_TREASURY", hedgeRatioBps: 5_500, riskBudgetBps: 1_500, minimumExposureMinor: 500_000, decisionCadenceMonths: 3, allowedTypes: ["fx-forward", "interest-rate-swap"] },
};

function activeDecision(world: WorldState, initiatorId: string, motive: DerivativeDecisionMetadata["motive"], key?: string): DerivativeContract | undefined {
  return world.derivativeContracts.find((contract) => (contract.status === "active" || contract.status === "margin-call")
    && contract.decision?.initiatedById === initiatorId
    && contract.decision.motive === motive
    && (!key || JSON.stringify(contract.underlying).includes(key)));
}

function attachDecision(contract: DerivativeContract | null | undefined, decision: DerivativeDecisionMetadata, world: WorldState): DerivativeContract | null {
  if (!contract) return null;
  const prior = [...world.derivativeContracts]
    .filter((item) => item.id !== contract.id && item.decision?.initiatedById === decision.initiatedById && item.decision.motive === decision.motive && item.status !== "active" && item.status !== "margin-call")
    .sort((left, right) => right.maturityMonth - left.maturityMonth)[0];
  if (prior) {
    decision.rolledFromId = prior.id;
    if (prior.decision) prior.decision.rolledToId = contract.id;
  }
  contract.decision = decision;
  return contract;
}

function pairFor(world: WorldState, left: string, right: string) {
  return world.fxPairs.find((pair) => (pair.baseCurrencyId === left && pair.quoteCurrencyId === right) || (pair.baseCurrencyId === right && pair.quoteCurrencyId === left));
}

export function createFxHedgeForFund(world: WorldState, fund: Fund): DerivativeContract | null {
  const profile = INSTITUTION_STRATEGY_PROFILES[fund.strategyProfileId];
  if (!profile.allowedTypes.includes("fx-forward")) return null;
  const foreignAccount = world.bankAccounts
    .filter((account) => account.ownerId === fund.id && account.currencyId !== fund.currencyId && account.status === "active")
    .map((account) => ({ account, balance: bankAccountBalance(world, account.id) }))
    .filter((item) => item.balance >= profile.minimumExposureMinor)
    .sort((left, right) => right.balance - left.balance)[0];
  if (!foreignAccount) return null;
  const pair = pairFor(world, foreignAccount.account.currencyId, fund.currencyId);
  if (!pair || activeDecision(world, fund.id, "FX_HEDGE", pair.id)) return null;
  const dealer = world.fxDealers[0];
  if (!dealer) return null;
  const targetForeign = Math.floor(foreignAccount.balance * profile.hedgeRatioBps / 10_000);
  const baseAmount = pair.baseCurrencyId === foreignAccount.account.currencyId
    ? targetForeign
    : convertMinor(world, targetForeign, foreignAccount.account.currencyId, pair.baseCurrencyId) ?? 0;
  if (baseAmount <= 0) return null;
  const fundSellsBase = pair.baseCurrencyId === foreignAccount.account.currencyId;
  const contract = createForward(world, fundSellsBase ? dealer.id : fund.id, fundSellsBase ? fund.id : dealer.id, { kind: "currency-pair", pairId: pair.id }, baseAmount, pair.lastRatePpm, 6, "physical");
  return attachDecision(contract, {
    motive: "FX_HEDGE", initiatedById: fund.id, strategyProfileId: fund.strategyProfileId,
    targetExposureMinor: targetForeign, expectedBenefitMinor: Math.round(targetForeign * 180 / 10_000), expectedCostMinor: Math.round(targetForeign * pair.spreadBps / 10_000), hedgeRatioBps: profile.hedgeRatioBps,
    decisionInputs: { foreignCurrencyId: foreignAccount.account.currencyId, reportingCurrencyId: fund.currencyId, foreignCashMinor: foreignAccount.balance, pairId: pair.id },
  }, world);
}

function bankTreasuryCash(world: WorldState, bankId: string): number {
  return world.bankAccounts.filter((account) => account.ownerId === bankId && account.status === "active").reduce((sum, account) => sum + bankAccountBalance(world, account.id), 0);
}

export function approvePrimeBrokerCapacity(world: WorldState, fundId: string, primeBrokerId: string, requestedNotionalMinor: number): { approved: boolean; capacityMinor: number; reason: string } {
  const fund = world.funds.find((item) => item.id === fundId && item.status === "active");
  const bank = world.banks.find((item) => item.id === primeBrokerId);
  if (!fund || !bank || !fund.primeBrokerIds.includes(primeBrokerId) || requestedNotionalMinor <= 0) return { approved: false, capacityMinor: 0, reason: "Нет активного мандата прайм-брокера" };
  const capitalMinor = Math.abs(world.ledger.balances[accountIds.bankEquity(bank.id)] ?? 0);
  const cashMinor = bankTreasuryCash(world, bank.id);
  const bilateralExposure = world.derivativeContracts.filter((contract) => (contract.status === "active" || contract.status === "margin-call") && contract.counterpartyIds.includes(bank.id)).reduce((sum, contract) => sum + contract.notionalMinor, 0);
  const capacityMinor = Math.max(0, Math.round((capitalMinor * 1.5 + cashMinor * 2) * bank.minimumLiquidityRatioBps / 10_000) - bilateralExposure);
  const clientLimit = Math.max(0, Math.round(fund.navMinor * 3_000 / 10_000));
  const approved = requestedNotionalMinor <= Math.min(capacityMinor, clientLimit);
  return { approved, capacityMinor: Math.min(capacityMinor, clientLimit), reason: approved ? "Лимиты капитала, ликвидности и клиента соблюдены" : "Превышен лимит капитала, ликвидности или клиента" };
}

function createBankAlmHedges(world: WorldState): number {
  let created = 0;
  const paired = new Set<string>();
  for (const bank of world.banks) {
    const counterparty = world.banks.find((item) => item.countryId === bank.countryId && item.id !== bank.id);
    if (!counterparty) continue;
    const pairKey = [bank.id, counterparty.id].sort().join(":");
    if (paired.has(pairKey) || world.derivativeContracts.some((contract) => contract.type === "interest-rate-swap" && (contract.status === "active" || contract.status === "margin-call") && contract.counterpartyIds.includes(bank.id) && contract.counterpartyIds.includes(counterparty.id))) continue;
    paired.add(pairKey);
    const loanBook = world.loans.filter((loan) => loan.lenderBankId === bank.id && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
    const deposits = world.bankAccounts.filter((account) => account.bankId === bank.id && account.ownerId !== bank.id && account.status === "active").reduce((sum, account) => sum + bankAccountBalance(world, account.id), 0);
    const mismatch = loanBook - deposits;
    if (Math.abs(mismatch) < INSTITUTION_STRATEGY_PROFILES.BANK_ALM.minimumExposureMinor) continue;
    const notional = Math.min(5_000_000_00, Math.max(1_000_000, Math.round(Math.abs(mismatch) * 2_500 / 10_000)));
    const area = world.monetaryAreas.find((item) => item.currencyId === bank.baseCurrency);
    if (!area) continue;
    const reference = floatingReferenceRateBps(world, area.id);
    const contract = mismatch > 0
      ? createInterestRateSwap(world, bank.id, counterparty.id, area.id, notional, reference, 24)
      : createInterestRateSwap(world, counterparty.id, bank.id, area.id, notional, reference, 24);
    if (attachDecision(contract, {
      motive: "RATE_HEDGE", initiatedById: bank.id, strategyProfileId: "BANK_ALM", targetExposureMinor: Math.abs(mismatch), expectedBenefitMinor: Math.round(notional * 90 / 10_000), expectedCostMinor: Math.round(notional * 12 / 10_000), hedgeRatioBps: 2_500,
      decisionInputs: { loanBookMinor: loanBook, depositFundingMinor: deposits, mismatchMinor: mismatch, floatingReferenceRateBps: reference },
    }, world)) created += 1;
  }
  return created;
}

function createFundEquityHedges(world: WorldState, fund: Fund): number {
  if (!fund.mandate.assetClasses.includes("derivative")) return 0;
  const holding = world.equityHoldings.filter((item) => item.ownerId === fund.id && item.shares >= 100).sort((left, right) => right.costBasisCents - left.costBasisCents)[0];
  const listing = holding && world.listings.find((item) => item.securityId === holding.securityId);
  const exchange = listing && world.exchanges.find((item) => item.id === listing.exchangeId);
  if (!holding || !listing || !exchange || activeDecision(world, fund.id, "EQUITY_HEDGE", holding.securityId)) return 0;
  const bankWriter = fund.primeBrokerIds.map((id) => world.banks.find((bank) => bank.id === id)).find(Boolean);
  if (!bankWriter) return 0;
  const series = createOptionSeries(world, exchange.id, holding.securityId, 6, Math.max(1, Math.round(listing.lastPriceCents * 9_500 / 10_000)), "put");
  if (!series) return 0;
  const quantity = Math.max(1, Math.min(5, Math.floor(holding.shares / series.contractMultiplier)));
  const written = writeOption(world, series.id, fund.id, bankWriter.id, quantity);
  const contract = written.contractId ? world.derivativeContracts.find((item) => item.id === written.contractId) : undefined;
  if (!attachDecision(contract, {
    motive: "EQUITY_HEDGE", initiatedById: fund.id, strategyProfileId: fund.strategyProfileId, targetExposureMinor: holding.shares * listing.lastPriceCents,
    expectedBenefitMinor: Math.round(holding.shares * listing.lastPriceCents * 250 / 10_000), expectedCostMinor: (series.askMinor ?? 0) * quantity, hedgeRatioBps: Math.round(quantity * series.contractMultiplier * 10_000 / holding.shares),
    decisionInputs: { securityId: holding.securityId, shares: holding.shares, strikeMinor: series.strikeMinor, optionType: "put" },
  }, world)) return 0;
  return 1;
}

function createCoveredCall(world: WorldState, fund: Fund): number {
  if (fund.strategyProfileId !== "HEDGE_MACRO") return 0;
  const holding = world.equityHoldings.filter((item) => item.ownerId === fund.id && item.shares >= 100).sort((left, right) => right.shares - left.shares)[0];
  const listing = holding && world.listings.find((item) => item.securityId === holding.securityId);
  if (!holding || !listing || activeDecision(world, fund.id, "COVERED_INCOME", holding.securityId)) return 0;
  const exchange = world.exchanges.find((item) => item.id === listing.exchangeId)!;
  const holder = world.assetManagers.find((item) => item.id === fund.managerId);
  const series = createOptionSeries(world, exchange.id, holding.securityId, 6, Math.round(listing.lastPriceCents * 10_500 / 10_000), "call");
  if (!holder || !series) return 0;
  const written = writeOption(world, series.id, holder.id, fund.id, 1);
  const contract = written.contractId ? world.derivativeContracts.find((item) => item.id === written.contractId) : undefined;
  if (!attachDecision(contract, {
    motive: "COVERED_INCOME", initiatedById: fund.id, strategyProfileId: fund.strategyProfileId, targetExposureMinor: series.contractMultiplier * listing.lastPriceCents,
    expectedBenefitMinor: series.bidMinor ?? 0, expectedCostMinor: 0, hedgeRatioBps: Math.round(series.contractMultiplier * 10_000 / holding.shares),
    decisionInputs: { securityId: holding.securityId, coveredShares: series.contractMultiplier, existingShares: holding.shares },
  }, world)) return 0;
  const brokerage = openBrokerageAccount(world, fund.id).ok ? world.brokerageAccounts.find((item) => item.ownerId === fund.id && item.currencyId === listing.currencyId && item.status === "active") : null;
  if (brokerage) placeOrder(world, brokerage.id, holding.securityId, "buy", "limit", Math.min(10, series.contractMultiplier), listing.lastPriceCents);
  return 1;
}

function createTrsExposure(world: WorldState, fund: Fund): number {
  if (fund.type !== "hedge" || activeDecision(world, fund.id, "SYNTHETIC_EXPOSURE")) return 0;
  const listing = world.listings.find((item) => item.currencyId === fund.currencyId && !item.companyId.startsWith("fund-"));
  if (!listing) return 0;
  const quantity = Math.max(1, Math.min(250, Math.floor(fund.navMinor * 1_000 / 10_000 / Math.max(1, listing.lastPriceCents))));
  const notional = quantity * listing.lastPriceCents;
  const candidates = fund.primeBrokerIds.map((id) => ({ id, approval: approvePrimeBrokerCapacity(world, fund.id, id, notional) })).filter((item) => item.approval.approved).sort((left, right) => right.approval.capacityMinor - left.approval.capacityMinor);
  const prime = candidates[0];
  if (!prime) return 0;
  const contract = createTotalReturnSwap(world, fund.id, prime.id, listing.securityId, quantity, 12);
  if (!attachDecision(contract, {
    motive: "SYNTHETIC_EXPOSURE", initiatedById: fund.id, strategyProfileId: fund.strategyProfileId, targetExposureMinor: notional,
    expectedBenefitMinor: Math.round(notional * 650 / 10_000), expectedCostMinor: Math.round(notional * 350 / 10_000), hedgeRatioBps: 1_000,
    decisionInputs: { securityId: listing.securityId, primeBrokerId: prime.id, approvedCapacityMinor: prime.approval.capacityMinor, clientNavMinor: fund.navMinor },
  }, world)) return 0;
  return 1;
}

function createCreditHedges(world: WorldState): number {
  let created = 0;
  for (const holding of world.sovereignBondHoldings.filter((item) => item.faceValueMinor >= 1_000_000)) {
    const buyerId = holding.holderId;
    if (!world.banks.some((bank) => bank.id === buyerId) || activeDecision(world, buyerId, "CREDIT_HEDGE", holding.bondId)) continue;
    const bond = world.sovereignBonds.find((item) => item.id === holding.bondId && item.status === "active");
    const buyer = world.banks.find((bank) => bank.id === buyerId);
    const seller = buyer && world.banks.find((bank) => bank.countryId === buyer.countryId && bank.id !== buyer.id);
    if (!bond || !buyer || !seller) continue;
    const notional = Math.min(holding.faceValueMinor, 2_000_000);
    const contract = createCreditDefaultSwap(world, buyer.id, seller.id, bond.id, notional, 36);
    if (attachDecision(contract, {
      motive: "CREDIT_HEDGE", initiatedById: buyer.id, strategyProfileId: "BANK_ALM", targetExposureMinor: holding.faceValueMinor,
      expectedBenefitMinor: Math.round(notional * (world.countryMacroStates.find((state) => state.countryId === bond.countryId)?.sovereignRiskBps ?? 100) / 10_000), expectedCostMinor: Math.round(notional * 100 / 10_000), hedgeRatioBps: Math.round(notional * 10_000 / holding.faceValueMinor),
      decisionInputs: { bondId: bond.id, sovereignHoldingMinor: holding.faceValueMinor, countryId: bond.countryId },
    }, world)) created += 1;
  }
  return created;
}

export function runAutonomousDerivativeDecisions(world: WorldState): number {
  if (world.clock.elapsedMonths % 3 !== 0) return 0;
  let created = createBankAlmHedges(world) + createCreditHedges(world);
  for (const fund of world.funds.filter((item) => item.status === "active")) {
    if (createFxHedgeForFund(world, fund)) created += 1;
    created += createFundEquityHedges(world, fund);
    created += createCoveredCall(world, fund);
    created += createTrsExposure(world, fund);
  }
  return created;
}
