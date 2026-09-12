import { bankAccountBalance, seedDeposit } from "../core/ledger.ts";
import type { DataFieldStatus, ProfileField, WorldState } from "../domain/model.ts";
import { initializePrivateEquityFund } from "../private-equity/engine.ts";
import { transferShares } from "../corporate/finance.ts";
import { registerEtfBasket } from "../finance/etf-ecosystem.ts";
function status(value: string | undefined): DataFieldStatus { const normalized = value?.toUpperCase(); return normalized === "OBSERVED" || normalized === "ESTIMATED" || normalized === "CALIBRATED" ? normalized : "MISSING"; }
function field(value: number | null | undefined, source: string | undefined): ProfileField { return { valueMinor: value ?? null, status: value == null ? "MISSING" : status(source) }; }
export function seedEconomicMarketsCompletion(world: WorldState): void {
  if (!world.realCompanyProfiles.length) world.realCompanyProfiles = world.companies.filter((company) => company.baselineFinancials).map((company) => { const b = company.baselineFinancials!; return { companyId: company.id, industry: company.industry, homeCountryId: company.headquartersCountryId, currencyId: world.banks.find((bank) => bank.id === company.bankId)?.baseCurrency ?? "USD", baselineYear: world.baselineReference.referenceYear, sourceId: world.baselineReference.countryPackVersion, revenue: field(b.revenueMinor, b.sourceType), operatingProfit: field(b.profitMinor, b.sourceType), netIncome: field(null, undefined), assets: field(b.assetsMinor, b.sourceType), debt: field(b.debtMinor, b.sourceType), cash: field(b.cashMinor, b.sourceType), employees: field(b.employees, b.sourceType), marketCapitalization: field(b.marketCapMinor, b.sourceType), sharesOutstanding: field(world.equitySecurities.find((security) => security.companyId === company.id)?.sharesOutstanding, "calibrated") }; });
  if (!world.realBankProfiles.length) world.realBankProfiles = world.banks.filter((bank) => bank.baselineFinancials).map((bank) => { const b = bank.baselineFinancials!; return { bankId: bank.id, homeCountryId: bank.countryId, currencyId: bank.baseCurrency, baselineYear: world.baselineReference.referenceYear, sourceId: world.baselineReference.countryPackVersion, assets: field(b.assetsMinor, b.sourceType), loans: field(b.loansMinor, b.sourceType), deposits: field(b.depositsMinor, b.sourceType), equity: field(b.capitalMinor, b.sourceType), liquidity: field(b.liquidityMinor, b.sourceType), employees: field(null, undefined), marketCapitalization: field(null, undefined) }; });
  if (!world.insurers.length) for (const country of world.countries) { const bank = world.banks.find((item) => item.countryId === country.id); if (!bank) continue; for (let index = 1; index <= 2; index += 1) { const id = `insurer-${country.id}-${index}`; seedDeposit(world, id, bank.id, 100_000_000 - index * 10_000_000); const account = world.bankAccounts.find((item) => item.ownerId === id && item.currencyId === bank.baseCurrency)!; world.insurers.push({ id, name: `${country.name} Страхование ${index}`, countryId: country.id, currencyId: bank.baseCurrency, bankAccountId: account.id, capitalMinor: 50_000_000 - index * 2_000_000, reservesMinor: 0, premiumIncomeMinor: 0, claimsPaidMinor: 0, operatingExpenseMinor: 0, investmentAssetsMinor: 0, reinsuranceRecoverableMinor: 0 }); } }
  if (!world.privateEquityFunds.length) {
    const fund = world.funds.find((item) => item.type === "private-capital" && item.status === "active");
    const paidHolding = fund && world.fundUnitHoldings.find((item) => item.fundId === fund.id && item.costBasisMinor > 0);
    if (fund && paidHolding) {
      const state = initializePrivateEquityFund(world, fund.id, fund.managerId, [{ lpId: paidHolding.investorId, committedMinor: paidHolding.costBasisMinor }]);
      state.calledCapitalMinor = paidHolding.costBasisMinor;
      state.dryPowderMinor = Math.min(paidHolding.costBasisMinor, bankAccountBalance(world, fund.bankAccountId));
      state.lpCommitments[0].calledMinor = paidHolding.costBasisMinor;
    }
  }
  if (!world.etfBaskets.length) {
    for (const fund of world.funds.filter((item) => item.type === "etf" && item.unitSecurityId && item.status === "active")) {
      const manager = world.assetManagers.find((item) => item.id === fund.managerId);
      const exchange = world.exchanges.find((item) => item.countryId === manager?.countryId && item.currencyId === fund.currencyId);
      const managerAccount = manager && world.bankAccounts.find((item) => item.ownerId === manager.id && item.currencyId === fund.currencyId && item.status === "active");
      if (!manager || !exchange || !managerAccount) continue;
      const components: Array<{ securityId: string; quantity: number }> = [];
      for (const listing of world.listings.filter((item) => item.exchangeId === exchange.id && item.securityId !== fund.unitSecurityId).slice(0, 2)) {
        const seller = world.equityHoldings.find((item) => item.securityId === listing.securityId && item.ownerId !== fund.id && item.ownerId !== manager.id && item.shares >= 10);
        const sellerAccount = seller && world.bankAccounts.find((item) => item.ownerId === seller.ownerId && item.currencyId === fund.currencyId && item.status === "active");
        if (!seller || !sellerAccount) continue;
        const fundLeg = transferShares(world, listing.securityId, seller.ownerId, fund.id, 5, listing.lastPriceCents, "EQUITY_SECONDARY", { buyerBankAccountId: fund.bankAccountId, sellerBankAccountId: sellerAccount.id });
        const managerLeg = transferShares(world, listing.securityId, seller.ownerId, manager.id, 5, listing.lastPriceCents, "EQUITY_SECONDARY", { buyerBankAccountId: managerAccount.id, sellerBankAccountId: sellerAccount.id });
        if (fundLeg.ok && managerLeg.ok) components.push({ securityId: listing.securityId, quantity: 5 });
      }
      if (components.length) registerEtfBasket(world, { fundId: fund.id, creationUnitSize: 10, components, authorizedParticipantIds: [manager.id] });
    }
  }
  if (!world.dataCoverageHistory.length) {
    const counts = (values: DataFieldStatus[]) => ({ observedBps: Math.round(values.filter((value) => value === "OBSERVED").length * 10_000 / Math.max(1, values.length)), estimatedBps: Math.round(values.filter((value) => value === "ESTIMATED").length * 10_000 / Math.max(1, values.length)), calibratedBps: Math.round(values.filter((value) => value === "CALIBRATED").length * 10_000 / Math.max(1, values.length)), missingBps: Math.round(values.filter((value) => value === "MISSING").length * 10_000 / Math.max(1, values.length)) });
    const companyFields = world.realCompanyProfiles.flatMap((profile) => [profile.revenue.status, profile.operatingProfit.status, profile.netIncome.status, profile.assets.status, profile.debt.status, profile.cash.status, profile.employees.status, profile.marketCapitalization.status, profile.sharesOutstanding.status]); const bankFields = world.realBankProfiles.flatMap((profile) => [profile.assets.status, profile.loans.status, profile.deposits.status, profile.equity.status, profile.liquidity.status, profile.employees.status, profile.marketCapitalization.status]);
    world.dataCoverageHistory.push({ elapsedMonth: 0, category: "companies", ...counts(companyFields) }, { elapsedMonth: 0, category: "banks", ...counts(bankFields) });
  }
}
