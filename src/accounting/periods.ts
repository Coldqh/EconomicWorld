import { currentDate } from "../core/clock.ts";
import {
  accountIds,
  balanceOf,
  ensureAccount,
  entityBook,
  postTransaction,
  transactionsForMonth,
} from "../core/ledger.ts";
import { emitSimpleEvent } from "../core/events.ts";
import type { Company, CompanyFinancialReport, TransactionKind, WorldState } from "../domain/model.ts";

export function resetCompanyPeriod(company: Company): void {
  company.lastProductionMilliUnits = 0;
  company.lastSalesMilliUnits = 0;
  company.lastGrossRevenueCents = 0;
  company.lastOperatingExpenseCents = 0;
  company.lastCogsCents = 0;
  company.lastIntermediateConsumptionCents = 0;
  company.lastIntermediateConsumptionBaseCents = 0;
  company.lastWagesCents = 0;
  company.lastDepreciationCents = 0;
  company.lastInterestCents = 0;
  company.lastTaxCents = 0;
  company.lastCapitalInvestmentCents = 0;
  company.lastHouseholdSalesCents = 0;
  company.lastGovernmentSalesCents = 0;
}

type CompanyCashFlow = { operating: number; investing: number; financing: number };

function companyCashFlows(world: WorldState): Map<string, CompanyCashFlow> {
  const companyIdsByDeposit = new Map(world.companies.map((company) => [accountIds.deposit(company.id), company.id]));
  for (const account of world.bankAccounts) {
    if (world.companies.some((company) => company.id === account.ownerId)) companyIdsByDeposit.set(account.ledgerDepositAccountId, account.ownerId);
  }
  const byCompany = new Map<string, CompanyCashFlow>();
  const financingKinds = new Set<TransactionKind>(["LOAN_ISSUED", "LOAN_PRINCIPAL", "CAPITAL_CONTRIBUTION"]);
  for (const transaction of transactionsForMonth(world, world.clock.elapsedMonths)) {
    for (const entry of transaction.entries) {
      const companyId = companyIdsByDeposit.get(entry.accountId);
      if (!companyId) continue;
      const flows = byCompany.get(companyId) ?? { operating: 0, investing: 0, financing: 0 };
      const delta = entry.side === "debit" ? entry.amountCents : -entry.amountCents;
      if (transaction.kind === "CAPITAL_INVESTMENT") flows.investing += delta;
      else if (financingKinds.has(transaction.kind)) flows.financing += delta;
      else flows.operating += delta;
      byCompany.set(companyId, flows);
    }
  }
  return byCompany;
}

function createCompanyReport(world: WorldState, company: Company, cashFlow: CompanyCashFlow): CompanyFinancialReport {
  const book = entityBook(world, company.id);
  const grossProfitCents = company.lastGrossRevenueCents - company.lastCogsCents;
  const netIncomeCents = grossProfitCents
    - company.lastWagesCents
    - company.lastDepreciationCents
    - company.lastInterestCents
    - company.lastTaxCents;
  const date = currentDate(world.clock);
  return {
    elapsedMonth: world.clock.elapsedMonths,
    quarter: date.quarter,
    year: date.year,
    revenueCents: company.lastGrossRevenueCents,
    cogsCents: company.lastCogsCents,
    grossProfitCents,
    wagesCents: company.lastWagesCents,
    depreciationCents: company.lastDepreciationCents,
    interestCents: company.lastInterestCents,
    taxesCents: company.lastTaxCents,
    netIncomeCents,
    operatingCashFlowCents: cashFlow.operating,
    investingCashFlowCents: cashFlow.investing,
    financingCashFlowCents: cashFlow.financing,
    assetsCents: book.assets,
    liabilitiesCents: book.liabilities,
    equityCents: book.capital,
    inventoryCents: company.inventoryValueCents + Object.values(company.inputInventoryValueCents).reduce((sum, value) => sum + value, 0),
    productiveCapitalCents: company.productiveCapital.bookValueCents,
  };
}

function closeOwnerProfitAndLoss(world: WorldState, ownerId: string, accounts: Array<(typeof world.ledger.accounts)[string]>): void {
  const currencies = [...new Set(accounts.map((account) => account.currency))];
  for (const currency of currencies) {
    const currencyAccounts = accounts.filter((account) => account.currency === currency);
    const income = currencyAccounts.filter((account) => account.category === "income").map((account) => ({ account, value: balanceOf(world, account.id) })).filter((item) => item.value > 0);
    const expenses = currencyAccounts.filter((account) => account.category === "expense").map((account) => ({ account, value: balanceOf(world, account.id) })).filter((item) => item.value > 0);
    const incomeTotal = income.reduce((sum, item) => sum + item.value, 0);
    const expenseTotal = expenses.reduce((sum, item) => sum + item.value, 0);
    if (incomeTotal === 0 && expenseTotal === 0) continue;
    const baseRetained = accountIds.retainedEarnings(ownerId);
    const retained = world.ledger.accounts[baseRetained]?.currency === currency ? baseRetained : `${baseRetained}:${currency}`;
    ensureAccount(world.ledger, retained, ownerId, `Нераспределённая прибыль · ${currency}`, "equity", currency);
    const entries = [
      ...income.map((item) => ({ accountId: item.account.id, side: "debit" as const, amountCents: item.value })),
      ...expenses.map((item) => ({ accountId: item.account.id, side: "credit" as const, amountCents: item.value })),
    ];
    if (incomeTotal > expenseTotal) entries.push({ accountId: retained, side: "credit", amountCents: incomeTotal - expenseTotal });
    if (expenseTotal > incomeTotal) entries.push({ accountId: retained, side: "debit", amountCents: expenseTotal - incomeTotal });
    postTransaction(world, "ACCOUNTING_CLOSE", `Закрытие месяца: ${ownerId} · ${currency}`, entries);
  }
}

export function closeMonthlyAccounting(world: WorldState): void {
  const cashFlows = companyCashFlows(world);
  for (const company of world.companies) {
    if (!company.active) continue;
    const report = createCompanyReport(world, company, cashFlows.get(company.id) ?? { operating: 0, investing: 0, financing: 0 });
    company.financialReports.push(report);
  }
  const owners = [
    ...world.households.map((item) => item.id),
    ...world.companies.map((item) => item.id),
    ...world.banks.map((item) => item.id),
    ...world.governments.map((item) => item.id),
    ...world.centralBanks.map((item) => item.id),
    ...world.brokers.map((item) => item.id),
    ...world.exchanges.map((item) => item.id),
    ...world.assetManagers.map((item) => item.id),
    ...world.funds.map((item) => item.id),
    // Aggregate cohorts close through CountryEconomicPeriod subaccounts. They
    // do not need a second ledger P&L close for every representative cohort.
    "goods-market",
    "academy-provider",
  ];
  const accountsByOwner = new Map<string, Array<(typeof world.ledger.accounts)[string]>>();
  for (const account of Object.values(world.ledger.accounts)) {
    if (account.category !== "income" && account.category !== "expense") continue;
    const accounts = accountsByOwner.get(account.ownerId) ?? [];
    accounts.push(account);
    accountsByOwner.set(account.ownerId, accounts);
  }
  owners.forEach((ownerId) => closeOwnerProfitAndLoss(world, ownerId, accountsByOwner.get(ownerId) ?? []));
  for (const company of world.companies) {
    company.retainedEarningsCents = balanceOf(world, accountIds.retainedEarnings(company.id));
  }
  emitSimpleEvent(world, "AccountingPeriodClosed", "Бухгалтерский период закрыт", "Доходы и расходы перенесены в нераспределённую прибыль; денежные остатки не изменились.", [], "info");
}
