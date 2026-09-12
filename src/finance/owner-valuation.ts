import { bankAccountBalance, bankAccountsForOwner } from "../core/ledger.ts";
import { companyValuation } from "../corporate/finance.ts";
import type { WorldState } from "../domain/model.ts";
import { calculateFundNav } from "./institutional.ts";
import { convertMinor } from "./currencies.ts";

export interface OwnerBalanceSheetValue {
  reportingCurrencyId: string;
  assetsMinor: number;
  liabilitiesMinor: number;
  totalMinor: number;
  translationEffectMinor: number;
  components: Record<string, number>;
}

function ownerHomeCurrency(world: WorldState, ownerId: string, fallback: string): string {
  return bankAccountsForOwner(world, ownerId).find((item) => item.isPrimary)?.currencyId
    ?? bankAccountsForOwner(world, ownerId)[0]?.currencyId
    ?? fallback;
}

function translate(world: WorldState, amountMinor: number, currencyId: string, reportingCurrencyId: string): number {
  if (!amountMinor) return 0;
  if (currencyId === reportingCurrencyId) return amountMinor;
  return convertMinor(world, amountMinor, currencyId, reportingCurrencyId) ?? 0;
}

export function valueOwnerBalanceSheet(world: WorldState, ownerId: string, reportingCurrencyId: string): OwnerBalanceSheetValue {
  const components: Record<string, number> = {};
  let assetsMinor = 0;
  let liabilitiesMinor = 0;
  let translationEffectMinor = 0;
  const add = (bucket: string, amountMinor: number, currencyId: string, liability = false) => {
    const converted = translate(world, Math.max(0, Math.round(amountMinor)), currencyId, reportingCurrencyId);
    if (!converted) return;
    components[bucket] = (components[bucket] ?? 0) + converted;
    if (liability) liabilitiesMinor += converted;
    else assetsMinor += converted;
    if (currencyId !== reportingCurrencyId) translationEffectMinor += liability ? -converted : converted;
  };

  for (const account of bankAccountsForOwner(world, ownerId)) add("cash", bankAccountBalance(world, account.id), account.currencyId);

  for (const holding of world.equityHoldings.filter((item) => item.ownerId === ownerId && item.shares > 0)) {
    const security = world.equitySecurities.find((item) => item.id === holding.securityId);
    if (!security) continue;
    const listing = world.listings.find((item) => item.securityId === holding.securityId);
    const issuer = world.companies.find((item) => item.id === security.companyId);
    let price = listing?.lastPriceCents ?? 0;
    if (!price && issuer && security.sharesOutstanding > 0) price = Math.max(1, Math.round(companyValuation(world, issuer.id).equityValueCents / security.sharesOutstanding));
    if (!price) price = Math.max(1, Math.round(holding.costBasisCents / Math.max(1, holding.shares)));
    add("equity", holding.shares * price, security.currencyId);
  }

  // ETF investors also have a mirror FundUnitHolding for creation/redemption bookkeeping.
  // Count only non-ETF fund units here to avoid double counting the listed ETF security above.
  for (const holding of world.fundUnitHoldings.filter((item) => item.investorId === ownerId && item.unitsMicros > 0)) {
    const fund = world.funds.find((item) => item.id === holding.fundId);
    if (!fund || fund.type === "etf") continue;
    const nav = calculateFundNav(world, fund.id);
    add("funds", Math.round(holding.unitsMicros * nav.navPerUnitMinor / 1_000_000), fund.currencyId);
  }

  for (const holding of world.bondHoldings.filter((item) => item.holderId === ownerId && item.faceValueCents > 0)) {
    const bond = world.corporateBonds.find((item) => item.id === holding.bondId);
    if (bond) add("corporate-bonds", holding.costBasisCents, bond.currencyId);
  }
  for (const holding of world.sovereignBondHoldings.filter((item) => item.holderId === ownerId && item.faceValueMinor > 0)) {
    const bond = world.sovereignBonds.find((item) => item.id === holding.bondId);
    if (!bond) continue;
    const marked = bond.outstandingFaceValueMinor > 0
      ? Math.round(bond.marketPriceMinor * holding.faceValueMinor / bond.outstandingFaceValueMinor)
      : holding.bookValueMinor;
    add("sovereign-bonds", marked, bond.currencyId);
  }

  for (const property of world.properties.filter((item) => item.ownerId === ownerId)) {
    const countryId = world.cities.find((item) => item.id === property.cityId)?.countryId;
    const currency = world.countries.find((item) => item.id === countryId)?.currencyReference ?? reportingCurrencyId;
    add("property", property.currentValueCents, currency);
  }
  const homeCurrency = ownerHomeCurrency(world, ownerId, reportingCurrencyId);
  for (const asset of world.durableAssets.filter((item) => item.ownerId === ownerId)) add("durables", asset.resaleValueCents, homeCurrency);

  for (const loan of world.loans.filter((item) => item.borrowerId === ownerId && item.status === "active")) add("loans", loan.remainingPrincipalCents, loan.currencyId, true);
  for (const margin of world.marginAccounts.filter((item) => item.ownerId === ownerId && item.status !== "closed" && item.borrowedMinor > 0)) add("margin", margin.borrowedMinor, margin.currencyId, true);
  for (const repo of world.repoAgreements.filter((item) => item.cashBorrowerId === ownerId && item.status === "active")) add("repo", repo.cashAmountMinor, repo.currencyId, true);

  for (const contract of world.derivativeContracts.filter((item) => (item.status === "active" || item.status === "margin-call") && item.counterpartyIds.includes(ownerId))) {
    // Futures are variation-margined into cash and FX swaps store a rate rather
    // than a currency MTM in lastMarkMinor, so counting either would duplicate or
    // misstate wealth. Options carry an explicit value; OTC contracts use signed
    // lastMarkMinor from the perspective of counterpartyIds[0].
    let signedMark = 0;
    if (contract.type === "option") signedMark = (contract.holderId === ownerId ? 1 : -1) * contract.carryingValueMinor * contract.quantity;
    else if (contract.type !== "future" && contract.type !== "fx-swap") signedMark = (contract.counterpartyIds[0] === ownerId ? 1 : -1) * contract.lastMarkMinor;
    if (signedMark > 0) add("derivative-assets", signedMark, contract.currencyId);
    else if (signedMark < 0) add("derivative-liabilities", -signedMark, contract.currencyId, true);
  }

  return { reportingCurrencyId, assetsMinor, liabilitiesMinor, totalMinor: assetsMinor - liabilitiesMinor, translationEffectMinor, components };
}
