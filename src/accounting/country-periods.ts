import { bankAccountBalance, depositOf } from "../core/ledger.ts";
import { convertMinor } from "../finance/currencies.ts";
import type { CountryEconomicPeriod, LedgerTransaction, WorldState } from "../domain/model.ts";

type PeriodRouting = { month: number; governmentCountry: Map<string, string>; governmentCashAccounts: Set<string>; ownerCountry: Map<string, string>; householdOwners: Set<string>; companyOwners: Set<string>; householdAccounts: Map<string, import("../domain/model.ts").HouseholdCohortMonthlyAccount>; firmAccounts: Map<string, import("../domain/model.ts").FirmCohortMonthlyAccount> };
const periodRouting = new WeakMap<WorldState, PeriodRouting>();
const COUNTRY_FLOW_KINDS = new Set([
  "WAGE", "COHORT_INCOME", "SOCIAL_TRANSFER", "DIVIDEND", "LOAN_INTEREST", "SOVEREIGN_COUPON",
  "INCOME_TAX", "PROPERTY_TAX", "SALES_TAX", "CORPORATE_TAX", "COHORT_CONSUMPTION", "GOODS_CLEARING",
  "RENT", "DURABLE_PURCHASE", "LOAN_ISSUED", "LOAN_PRINCIPAL", "INPUT_PURCHASE", "CAPITAL_INVESTMENT",
  "PUBLIC_INVESTMENT", "EDUCATION", "TARIFF", "SUBSIDY", "FOREIGN_AID", "SOVEREIGN_LOAN", "PROCUREMENT", "CORRUPTION_LEAKAGE",
  "SOVEREIGN_ISSUE", "SOVEREIGN_REPAYMENT", "SOVEREIGN_RESTRUCTURE", "SOVEREIGN_WRITE_DOWN",
] as const);

const zeroPeriod = (world: WorldState, countryId: string): CountryEconomicPeriod => {
  const country = world.countries.find((item) => item.id === countryId)!;
  const budget = world.governmentBudgets.find((item) => item.countryId === countryId);
  const government = world.governments.find((item) => item.countryId === countryId);
  const openingCashMinor = government ? world.bankAccounts.filter((item) => item.ownerId === government.id && item.status === "active").reduce((sum, item) => sum + (convertMinor(world, bankAccountBalance(world, item.id), item.currencyId, country.currencyReference) ?? 0), 0) : budget ? bankAccountBalance(world, budget.cashBankAccountId) : 0;
  const openingGrossDebtMinor = world.sovereignBonds.filter((bond) => bond.countryId === countryId).reduce((sum, bond) => sum + bond.outstandingFaceValueMinor + bond.arrearsCouponMinor, 0);
  return {
    countryId, currencyId: country.currencyReference, elapsedMonth: world.clock.elapsedMonths, status: "open",
    production: { grossOutputMinor: 0, intermediateConsumptionMinor: 0, valueAddedMinor: 0, explicitValueAddedMinor: 0, cohortValueAddedMinor: 0, publicOtherValueAddedMinor: 0 },
    expenditure: { householdConsumptionMinor: 0, privateInvestmentMinor: 0, governmentConsumptionMinor: 0, governmentInvestmentMinor: 0, exportsMinor: 0, importsMinor: 0, inventoryChangeMinor: 0, gdpMinor: 0 },
    income: { employeeCompensationMinor: 0, operatingSurplusMinor: 0, mixedIncomeMinor: 0, taxesOnProductionNetMinor: 0, propertyIncomeMinor: 0, gdpMinor: 0 },
    fiscal: { openingCashMinor, personalTaxMinor: 0, corporateTaxMinor: 0, consumptionTaxMinor: 0, tariffsMinor: 0, propertyOtherTaxMinor: 0, otherRevenueMinor: 0, soeDividendsMinor: 0, consumptionMinor: 0, investmentMinor: 0, transfersMinor: 0, subsidiesMinor: 0, interestMinor: 0, bondIssuanceMinor: 0, loanFinancingMinor: 0, otherFinancingMinor: 0, principalRepaymentMinor: 0, closingCashMinor: openingCashMinor, primaryBalanceMinor: 0, overallBalanceMinor: 0, cashGapMinor: 0, cashGapBps: 0 },
    external: { reportingCurrencyId: "USD", goodsExportsMinor: 0, goodsImportsMinor: 0, servicesExportsMinor: 0, servicesImportsMinor: 0, primaryIncomeReceivedMinor: 0, primaryIncomePaidMinor: 0, transfersReceivedMinor: 0, transfersPaidMinor: 0, fdiAssetsMinor: 0, fdiLiabilitiesMinor: 0, portfolioAssetsMinor: 0, portfolioLiabilitiesMinor: 0, crossBorderLoanAssetsMinor: 0, crossBorderLoanLiabilitiesMinor: 0, bankFlowsMinor: 0, reserveChangeMinor: 0, currentAccountMinor: 0, financialAccountMinor: 0, reconciliationGapMinor: 0 },
    financial: { openingGrossDebtMinor, newIssuanceMinor: 0, newArrearsMinor: 0, principalRepaymentMinor: 0, haircutsMinor: 0, writeOffsMinor: 0, closingGrossDebtMinor: openingGrossDebtMinor, debtBridgeGapMinor: 0, debtBridgeGapBps: 0 },
    labour: { explicitEmployment: 0, cohortEmployment: 0, labourForce: 0, employeeCompensationPaidMinor: 0, employeeCompensationReceivedMinor: 0, wageGapMinor: 0 },
    reconciliation: { productionGdpMinor: 0, expenditureGdpMinor: 0, incomeGdpMinor: 0, productionExpenditureGapMinor: 0, productionIncomeGapMinor: 0, productionExpenditureGapBps: 0, productionIncomeGapBps: 0 },
  };
};

export function initializeCountryEconomicAccounts(world: WorldState): void {
  world.countryEconomicAccounts.currentByCountry ??= {};
  world.countryEconomicAccounts.closedByCountry ??= {};
  world.countryEconomicAccounts.history ??= [];
  world.countryEconomicAccounts.hotHistoryMonths ??= 24;
  world.countryEconomicAccounts.householdAccounts ??= [];
  world.countryEconomicAccounts.firmAccounts ??= [];
  world.countryEconomicAccounts.representations ??= [];
}

export function openCountryEconomicPeriods(world: WorldState): void {
  world.countryEconomicAccounts.currentByCountry = Object.fromEntries(world.countries.map((country) => [country.id, zeroPeriod(world, country.id)]));
  world.countryEconomicAccounts.householdAccounts = world.populationCohorts.map((cohort) => ({ cohortId: cohort.id, countryId: cohort.countryId, elapsedMonth: world.clock.elapsedMonths, status: "open", openingFinancialPositionMinor: depositOf(world, cohort.id), labourIncomeMinor: 0, capitalIncomeMinor: 0, transfersReceivedMinor: 0, personalTaxesMinor: 0, otherTaxesMinor: 0, disposableIncomeMinor: 0, consumptionMinor: 0, savingsMinor: 0, debtBorrowingMinor: 0, debtRepaymentMinor: 0, financialInvestmentMinor: 0, budgetGapMinor: 0, budgetGapBps: 0 }));
  world.countryEconomicAccounts.firmAccounts = world.firmCohorts.map((cohort) => ({ cohortId: cohort.id, countryId: cohort.countryId, elapsedMonth: world.clock.elapsedMonths, status: "open", revenueMinor: 0, intermediateInputExpenseMinor: 0, wagesMinor: 0, interestMinor: 0, taxesMinor: 0, otherOperatingExpenseMinor: 0, profitMinor: 0, investmentMinor: 0, borrowingMinor: 0, debtRepaymentMinor: 0, dividendsMinor: 0, pnlGapMinor: 0, pnlGapBps: 0 }));
  const governmentCountry = new Map(world.governments.map((item) => [item.id, item.countryId]));
  const governmentCashAccounts = new Set(world.bankAccounts.filter((item) => governmentCountry.has(item.ownerId)).map((item) => item.ledgerDepositAccountId));
  const ownerCountry = new Map<string, string>();
  world.companies.forEach((item) => ownerCountry.set(item.id, item.headquartersCountryId));
  world.firmCohorts.forEach((item) => ownerCountry.set(item.id, item.countryId));
  world.populationCohorts.forEach((item) => ownerCountry.set(item.id, item.countryId));
  world.governments.forEach((item) => ownerCountry.set(item.id, item.countryId));
  const cityCountry = new Map(world.cities.map((item) => [item.id, item.countryId]));
  world.households.forEach((item) => ownerCountry.set(item.id, cityCountry.get(item.cityId) ?? ""));
  periodRouting.set(world, { month: world.clock.elapsedMonths, governmentCountry, governmentCashAccounts, ownerCountry, householdOwners: new Set([...world.households.map((item) => item.id), ...world.populationCohorts.map((item) => item.id)]), companyOwners: new Set([...world.companies.map((item) => item.id), ...world.firmCohorts.map((item) => item.id)]), householdAccounts: new Map(world.countryEconomicAccounts.householdAccounts.map((item) => [item.cohortId, item])), firmAccounts: new Map(world.countryEconomicAccounts.firmAccounts.map((item) => [item.cohortId, item])) });
}

/** Records direct fiscal and sovereign contributions once per semantic ledger leg. */
export function recordCountryTransaction(world: WorldState, transaction: LedgerTransaction): void {
  if (!world.countryEconomicAccounts?.currentByCountry) return;
  if (!COUNTRY_FLOW_KINDS.has(transaction.kind as (typeof COUNTRY_FLOW_KINDS extends Set<infer T> ? T : never))) return;
  const routing = periodRouting.get(world);
  if (!routing || routing.month !== world.clock.elapsedMonths) return;
  let household: import("../domain/model.ts").HouseholdCohortMonthlyAccount | undefined;
  let firm: import("../domain/model.ts").FirmCohortMonthlyAccount | undefined;
  for (const entry of transaction.entries) {
    const ownerId = world.ledger.accounts[entry.accountId]?.ownerId;
    household ??= routing.householdAccounts.get(ownerId);
    firm ??= routing.firmAccounts.get(ownerId);
    if (household && firm) break;
  }
  const payerCash = transaction.entries.find((entry) => entry.side === "credit" && world.ledger.accounts[entry.accountId]?.category === "asset" && world.ledger.accounts[entry.accountId]?.instrument === "deposit");
  const recipientCash = transaction.entries.find((entry) => entry.side === "debit" && world.ledger.accounts[entry.accountId]?.category === "asset" && world.ledger.accounts[entry.accountId]?.instrument === "deposit");
  const payerId = payerCash ? world.ledger.accounts[payerCash.accountId].ownerId : "";
  const recipientId = recipientCash ? world.ledger.accounts[recipientCash.accountId].ownerId : "";
  if ((transaction.kind === "WAGE" || transaction.kind === "COHORT_INCOME") && recipientCash) {
    const period = world.countryEconomicAccounts.currentByCountry[routing.ownerCountry.get(recipientId) ?? ""];
    if (period) { period.income.employeeCompensationMinor += recipientCash.amountCents; period.labour.employeeCompensationReceivedMinor += recipientCash.amountCents; period.labour.employeeCompensationPaidMinor += recipientCash.amountCents; }
  }
  if ((transaction.kind === "GOODS_CLEARING" || transaction.kind === "COHORT_CONSUMPTION") && payerCash && routing.householdOwners.has(payerId)) {
    const period = world.countryEconomicAccounts.currentByCountry[routing.ownerCountry.get(payerId) ?? ""];
    if (period) period.expenditure.householdConsumptionMinor += payerCash.amountCents;
  }
  if (transaction.kind === "CAPITAL_INVESTMENT" && payerCash && routing.companyOwners.has(payerId)) {
    const period = world.countryEconomicAccounts.currentByCountry[routing.ownerCountry.get(payerId) ?? ""];
    if (period) period.expenditure.privateInvestmentMinor += payerCash.amountCents;
  }
  if (household) {
    const received = transaction.entries.filter((entry) => world.ledger.accounts[entry.accountId]?.ownerId === household.cohortId && world.ledger.accounts[entry.accountId]?.instrument === "deposit" && entry.side === "debit").reduce((sum, entry) => sum + entry.amountCents, 0);
    const paid = transaction.entries.filter((entry) => world.ledger.accounts[entry.accountId]?.ownerId === household.cohortId && world.ledger.accounts[entry.accountId]?.instrument === "deposit" && entry.side === "credit").reduce((sum, entry) => sum + entry.amountCents, 0);
    if (transaction.kind === "COHORT_INCOME" || transaction.kind === "WAGE") household.labourIncomeMinor += received;
    else if (transaction.kind === "SOCIAL_TRANSFER") household.transfersReceivedMinor += received;
    else if (transaction.kind === "DIVIDEND" || transaction.kind === "LOAN_INTEREST" || transaction.kind === "SOVEREIGN_COUPON") household.capitalIncomeMinor += received;
    else if (transaction.kind === "INCOME_TAX") household.personalTaxesMinor += paid;
    else if (transaction.kind === "PROPERTY_TAX" || transaction.kind === "SALES_TAX") household.otherTaxesMinor += paid;
    else if (transaction.kind === "COHORT_CONSUMPTION" || transaction.kind === "GOODS_CLEARING" || transaction.kind === "RENT" || transaction.kind === "DURABLE_PURCHASE") household.consumptionMinor += paid;
    else if (transaction.kind === "LOAN_ISSUED") household.debtBorrowingMinor += received;
    else if (transaction.kind === "LOAN_PRINCIPAL") household.debtRepaymentMinor += paid;
  }
  if (firm) {
    const received = transaction.entries.filter((entry) => world.ledger.accounts[entry.accountId]?.ownerId === firm.cohortId && world.ledger.accounts[entry.accountId]?.instrument === "deposit" && entry.side === "debit").reduce((sum, entry) => sum + entry.amountCents, 0);
    const paid = transaction.entries.filter((entry) => world.ledger.accounts[entry.accountId]?.ownerId === firm.cohortId && world.ledger.accounts[entry.accountId]?.instrument === "deposit" && entry.side === "credit").reduce((sum, entry) => sum + entry.amountCents, 0);
    if (transaction.kind === "COHORT_CONSUMPTION" || transaction.kind === "GOODS_CLEARING" || transaction.kind === "INPUT_PURCHASE" || transaction.kind === "CAPITAL_INVESTMENT") firm.revenueMinor += received;
    if (transaction.kind === "COHORT_INCOME" || transaction.kind === "WAGE") firm.wagesMinor += paid;
    else if (transaction.kind === "LOAN_INTEREST") firm.interestMinor += paid;
    else if (transaction.kind === "CORPORATE_TAX" || transaction.kind === "SALES_TAX" || transaction.kind === "PROPERTY_TAX") firm.taxesMinor += paid;
    else if (transaction.kind === "INPUT_PURCHASE") firm.intermediateInputExpenseMinor += paid;
    else if (transaction.kind === "CAPITAL_INVESTMENT") firm.investmentMinor += paid;
    else if (transaction.kind === "LOAN_ISSUED") firm.borrowingMinor += received;
    else if (transaction.kind === "LOAN_PRINCIPAL") firm.debtRepaymentMinor += paid;
    else if (transaction.kind === "DIVIDEND") firm.dividendsMinor += paid;
  }
  for (const entry of transaction.entries) {
    const account = world.ledger.accounts[entry.accountId];
    const countryId = account && routing.governmentCountry.get(account.ownerId);
    const period = countryId ? world.countryEconomicAccounts.currentByCountry[countryId] : null;
    if (!period) continue;
    const cashAccount = account.category === "asset" && account.instrument === "deposit";
    const localAmount = convertMinor(world, entry.amountCents, account.currency, period.currencyId) ?? entry.amountCents;
    const inflow = cashAccount && entry.side === "debit" ? localAmount : 0;
    const outflow = cashAccount && entry.side === "credit" ? localAmount : 0;
    if (inflow) {
      if (transaction.kind === "INCOME_TAX") period.fiscal.personalTaxMinor += inflow;
      else if (transaction.kind === "CORPORATE_TAX") period.fiscal.corporateTaxMinor += inflow;
      else if (transaction.kind === "SALES_TAX") period.fiscal.consumptionTaxMinor += inflow;
      else if (transaction.kind === "PROPERTY_TAX") period.fiscal.propertyOtherTaxMinor += inflow;
      else if (transaction.kind === "TARIFF") period.fiscal.tariffsMinor += inflow;
      else if (transaction.kind === "FOREIGN_AID") period.fiscal.otherRevenueMinor += inflow;
      else if (transaction.kind === "SOVEREIGN_ISSUE") period.fiscal.bondIssuanceMinor += inflow;
      else if (transaction.kind === "LOAN_ISSUED") period.fiscal.loanFinancingMinor += inflow;
      else if (transaction.kind === "SOVEREIGN_LOAN") period.fiscal.loanFinancingMinor += inflow;
      else if (transaction.kind === "LOBBYING") period.fiscal.otherRevenueMinor += inflow;
    }
    if (outflow) {
      if (transaction.kind === "SOCIAL_TRANSFER") period.fiscal.transfersMinor += outflow;
      else if (transaction.kind === "SOVEREIGN_COUPON") period.fiscal.interestMinor += outflow;
      else if (transaction.kind === "SOVEREIGN_REPAYMENT") period.fiscal.principalRepaymentMinor += outflow;
      else if (transaction.kind === "PUBLIC_INVESTMENT") period.fiscal.investmentMinor += outflow;
      else if (transaction.kind === "SUBSIDY") period.fiscal.subsidiesMinor += outflow;
      else if (transaction.kind === "FOREIGN_AID") period.fiscal.transfersMinor += outflow;
      else if (transaction.kind === "SOVEREIGN_LOAN") period.fiscal.otherFinancingMinor -= outflow;
      else if (transaction.kind === "PROCUREMENT" || transaction.kind === "CORRUPTION_LEAKAGE") period.fiscal.consumptionMinor += outflow;
      else if (transaction.kind === "GOODS_CLEARING" || transaction.kind === "EDUCATION") period.fiscal.consumptionMinor += outflow;
    }
    if (account.instrument !== "sovereign-bond") continue;
    if (transaction.kind === "SOVEREIGN_ISSUE" && entry.side === "credit") period.financial.newIssuanceMinor += entry.amountCents;
    else if (transaction.kind === "SOVEREIGN_REPAYMENT" && entry.side === "debit") period.financial.principalRepaymentMinor += entry.amountCents;
    else if (transaction.kind === "SOVEREIGN_RESTRUCTURE" && entry.side === "debit") period.financial.haircutsMinor += entry.amountCents;
    else if (transaction.kind === "SOVEREIGN_WRITE_DOWN" && entry.side === "debit") period.financial.writeOffsMinor += entry.amountCents;
  }
}

export function recordSovereignArrearFlow(world: WorldState, countryId: string, amountMinor: number): void {
  const period = world.countryEconomicAccounts.currentByCountry[countryId];
  if (period) period.financial.newArrearsMinor += Math.max(0, Math.floor(amountMinor));
}

export type ExternalFlowField = Exclude<keyof CountryEconomicPeriod["external"], "reportingCurrencyId" | "currentAccountMinor" | "financialAccountMinor" | "reconciliationGapMinor">;
export function recordExternalFlow(world: WorldState, countryId: string, field: ExternalFlowField, amountUsdMinor: number): void {
  const period = world.countryEconomicAccounts.currentByCountry[countryId];
  if (period) period.external[field] += Math.floor(amountUsdMinor);
}

export function recordBilateralExternalFlow(world: WorldState, sourceCountryId: string, destinationCountryId: string, sourceField: ExternalFlowField, destinationField: ExternalFlowField, amountUsdMinor: number): void {
  recordExternalFlow(world, sourceCountryId, sourceField, amountUsdMinor);
  recordExternalFlow(world, destinationCountryId, destinationField, amountUsdMinor);
}

const relativeGapBps = (gap: number, scale: number): number => scale === 0 ? (gap === 0 ? 0 : 10_000) : Math.round(Math.abs(gap) * 10_000 / Math.abs(scale));

export function closeHouseholdAccount<T extends Pick<import("../domain/model.ts").HouseholdCohortMonthlyAccount, "labourIncomeMinor" | "capitalIncomeMinor" | "transfersReceivedMinor" | "personalTaxesMinor" | "otherTaxesMinor" | "consumptionMinor" | "debtBorrowingMinor" | "debtRepaymentMinor">>(account: T) {
  const disposableIncomeMinor = account.labourIncomeMinor + account.capitalIncomeMinor + account.transfersReceivedMinor - account.personalTaxesMinor - account.otherTaxesMinor;
  const savingsMinor = disposableIncomeMinor - account.consumptionMinor;
  const financialInvestmentMinor = savingsMinor + account.debtBorrowingMinor - account.debtRepaymentMinor;
  const budgetGapMinor = disposableIncomeMinor - account.consumptionMinor - savingsMinor;
  return { disposableIncomeMinor, savingsMinor, financialInvestmentMinor, budgetGapMinor, budgetGapBps: relativeGapBps(budgetGapMinor, disposableIncomeMinor) };
}

export function closeFirmAccount<T extends Pick<import("../domain/model.ts").FirmCohortMonthlyAccount, "revenueMinor" | "intermediateInputExpenseMinor" | "wagesMinor" | "interestMinor" | "taxesMinor" | "otherOperatingExpenseMinor">>(account: T) {
  const profitMinor = account.revenueMinor - account.intermediateInputExpenseMinor - account.wagesMinor - account.interestMinor - account.taxesMinor - account.otherOperatingExpenseMinor;
  const pnlGapMinor = account.revenueMinor - account.intermediateInputExpenseMinor - account.wagesMinor - account.interestMinor - account.taxesMinor - account.otherOperatingExpenseMinor - profitMinor;
  return { profitMinor, pnlGapMinor, pnlGapBps: relativeGapBps(pnlGapMinor, account.revenueMinor) };
}

export function closeFiscalBridge<T extends Pick<CountryEconomicPeriod["fiscal"], "openingCashMinor" | "personalTaxMinor" | "corporateTaxMinor" | "consumptionTaxMinor" | "tariffsMinor" | "propertyOtherTaxMinor" | "otherRevenueMinor" | "soeDividendsMinor" | "consumptionMinor" | "investmentMinor" | "transfersMinor" | "subsidiesMinor" | "interestMinor" | "bondIssuanceMinor" | "loanFinancingMinor" | "otherFinancingMinor" | "principalRepaymentMinor" | "closingCashMinor">>(fiscal: T) {
  const revenue = fiscal.personalTaxMinor + fiscal.corporateTaxMinor + fiscal.consumptionTaxMinor + fiscal.tariffsMinor + fiscal.propertyOtherTaxMinor + fiscal.otherRevenueMinor + fiscal.soeDividendsMinor;
  const primarySpending = fiscal.consumptionMinor + fiscal.investmentMinor + fiscal.transfersMinor + fiscal.subsidiesMinor;
  const financing = fiscal.bondIssuanceMinor + fiscal.loanFinancingMinor + fiscal.otherFinancingMinor;
  const primaryBalanceMinor = revenue - primarySpending;
  const overallBalanceMinor = primaryBalanceMinor - fiscal.interestMinor;
  const cashGapMinor = fiscal.openingCashMinor + revenue + financing - primarySpending - fiscal.interestMinor - fiscal.principalRepaymentMinor - fiscal.closingCashMinor;
  return { primaryBalanceMinor, overallBalanceMinor, cashGapMinor, cashGapBps: relativeGapBps(cashGapMinor, fiscal.openingCashMinor + revenue + financing) };
}

export function closeDebtBridge<T extends Pick<CountryEconomicPeriod["financial"], "openingGrossDebtMinor" | "newIssuanceMinor" | "newArrearsMinor" | "principalRepaymentMinor" | "haircutsMinor" | "writeOffsMinor" | "closingGrossDebtMinor">>(financial: T) {
  const debtBridgeGapMinor = financial.openingGrossDebtMinor + financial.newIssuanceMinor + financial.newArrearsMinor - financial.principalRepaymentMinor - financial.haircutsMinor - financial.writeOffsMinor - financial.closingGrossDebtMinor;
  return { debtBridgeGapMinor, debtBridgeGapBps: relativeGapBps(debtBridgeGapMinor, financial.closingGrossDebtMinor) };
}

export function closeCountryEconomicPeriods(world: WorldState): void {
  for (const account of world.countryEconomicAccounts.householdAccounts) {
    Object.assign(account, closeHouseholdAccount(account));
    account.status = "closed";
  }
  for (const account of world.countryEconomicAccounts.firmAccounts) {
    const cohort = world.firmCohorts.find((item) => item.id === account.cohortId);
    account.revenueMinor = Math.max(account.revenueMinor, cohort?.revenueCents ?? 0);
    account.intermediateInputExpenseMinor = Math.max(account.intermediateInputExpenseMinor, cohort?.intermediateConsumptionMinor ?? 0);
    Object.assign(account, closeFirmAccount(account));
    account.status = "closed";
  }
  for (const country of world.countries) {
    const period = world.countryEconomicAccounts.currentByCountry[country.id] ?? zeroPeriod(world, country.id);
    const companies = world.companies.filter((item) => item.active && item.headquartersCountryId === country.id);
    const cohorts = world.firmCohorts.filter((item) => item.countryId === country.id);
    const logistics = world.logisticsSectors.find((item) => item.countryId === country.id);
    const logisticsValueAdded = logistics ? convertMinor(world, Math.max(0, logistics.profitUsdMinor), "USD", country.currencyReference) ?? 0 : 0;
    // Government purchases already become supplier revenue. Only public output
    // without a supplier counterpart belongs in this residual representation.
    period.production.publicOtherValueAddedMinor = Math.max(0, logisticsValueAdded);
    period.production.explicitValueAddedMinor = companies.reduce((sum, item) => sum + Math.max(0, item.lastGrossRevenueCents - item.lastIntermediateConsumptionCents), 0);
    period.production.cohortValueAddedMinor = cohorts.reduce((sum, item) => sum + Math.max(0, item.valueAddedMinor), 0);
    period.production.grossOutputMinor = companies.reduce((sum, item) => sum + Math.max(0, item.lastGrossRevenueCents), 0) + cohorts.reduce((sum, item) => sum + Math.max(0, item.revenueCents), 0) + period.production.publicOtherValueAddedMinor;
    period.production.intermediateConsumptionMinor = companies.reduce((sum, item) => sum + Math.max(0, item.lastIntermediateConsumptionCents), 0) + cohorts.reduce((sum, item) => sum + Math.max(0, item.intermediateConsumptionMinor), 0);
    period.production.valueAddedMinor = Math.max(0, period.production.grossOutputMinor - period.production.intermediateConsumptionMinor);
    period.income.mixedIncomeMinor = period.production.publicOtherValueAddedMinor;
    period.income.operatingSurplusMinor = Math.max(0, period.production.valueAddedMinor - period.income.employeeCompensationMinor - period.income.mixedIncomeMinor);
    period.income.gdpMinor = period.income.employeeCompensationMinor + period.income.operatingSurplusMinor + period.income.mixedIncomeMinor + period.income.taxesOnProductionNetMinor;
    period.expenditure.exportsMinor = convertMinor(world, period.external.goodsExportsMinor + period.external.servicesExportsMinor, "USD", country.currencyReference) ?? 0;
    period.expenditure.importsMinor = convertMinor(world, period.external.goodsImportsMinor + period.external.servicesImportsMinor, "USD", country.currencyReference) ?? 0;
    const budget = world.governmentBudgets.find((item) => item.countryId === country.id);
    if (budget) {
      const government = world.governments.find((item) => item.countryId === country.id);
      period.fiscal.closingCashMinor = government ? world.bankAccounts.filter((item) => item.ownerId === government.id && item.status === "active").reduce((sum, item) => sum + (convertMinor(world, bankAccountBalance(world, item.id), item.currencyId, country.currencyReference) ?? 0), 0) : bankAccountBalance(world, budget.cashBankAccountId);
      Object.assign(period.fiscal, closeFiscalBridge(period.fiscal));
      period.expenditure.governmentConsumptionMinor = period.fiscal.consumptionMinor; period.expenditure.governmentInvestmentMinor = period.fiscal.investmentMinor;
    }
    period.financial.closingGrossDebtMinor = world.sovereignBonds.filter((bond) => bond.countryId === country.id).reduce((sum, bond) => sum + bond.outstandingFaceValueMinor + bond.arrearsCouponMinor, 0);
    Object.assign(period.financial, closeDebtBridge(period.financial));
    const finalDemand = period.expenditure.householdConsumptionMinor + period.expenditure.privateInvestmentMinor + period.expenditure.governmentConsumptionMinor + period.expenditure.governmentInvestmentMinor + period.expenditure.exportsMinor - period.expenditure.importsMinor;
    period.expenditure.inventoryChangeMinor = period.production.valueAddedMinor - finalDemand;
    period.expenditure.gdpMinor = finalDemand + period.expenditure.inventoryChangeMinor;
    period.labour.explicitEmployment = companies.reduce((sum, item) => sum + item.employees.length, 0); period.labour.cohortEmployment = world.populationCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.employedCount, 0); period.labour.labourForce = world.populationCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.populationCount, 0) + world.households.filter((item) => world.cities.find((city) => city.id === item.cityId)?.countryId === country.id).length;
    const productionExpenditureGapMinor = period.production.valueAddedMinor - period.expenditure.gdpMinor;
    const productionIncomeGapMinor = period.production.valueAddedMinor - period.income.gdpMinor;
    period.reconciliation = { productionGdpMinor: period.production.valueAddedMinor, expenditureGdpMinor: period.expenditure.gdpMinor, incomeGdpMinor: period.income.gdpMinor, productionExpenditureGapMinor, productionIncomeGapMinor, productionExpenditureGapBps: relativeGapBps(productionExpenditureGapMinor, period.production.valueAddedMinor), productionIncomeGapBps: relativeGapBps(productionIncomeGapMinor, period.production.valueAddedMinor) };
    period.status = "closed";
    world.countryEconomicAccounts.closedByCountry[country.id] = period;
    world.countryEconomicAccounts.history.push(period);
  }
  const cutoff = world.clock.elapsedMonths - world.countryEconomicAccounts.hotHistoryMonths;
  world.countryEconomicAccounts.history = world.countryEconomicAccounts.history.filter((item) => item.elapsedMonth >= cutoff);
}
