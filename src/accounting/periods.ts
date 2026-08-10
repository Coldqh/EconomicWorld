import { currentDate } from "../core/clock.ts";
import {
  accountIds,
  balanceOf,
  ensureAccount,
  entityBook,
  postTransaction,
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

function cashFlowForCompany(world: WorldState, companyId: string): { operating: number; investing: number; financing: number } {
  const flows = { operating: 0, investing: 0, financing: 0 };
  const financingKinds = new Set<TransactionKind>(["LOAN_ISSUED", "LOAN_PRINCIPAL", "CAPITAL_CONTRIBUTION"]);
  for (let index = world.ledger.transactions.length - 1; index >= 0; index -= 1) {
    const transaction = world.ledger.transactions[index];
    if (transaction.elapsedMonth < world.clock.elapsedMonths) break;
    if (transaction.elapsedMonth > world.clock.elapsedMonths) continue;
    const depositEntry = transaction.entries.find((entry) => entry.accountId === accountIds.deposit(companyId));
    if (!depositEntry) continue;
    const delta = depositEntry.side === "debit" ? depositEntry.amountCents : -depositEntry.amountCents;
    if (transaction.kind === "CAPITAL_INVESTMENT") flows.investing += delta;
    else if (financingKinds.has(transaction.kind)) flows.financing += delta;
    else flows.operating += delta;
  }
  return flows;
}

function createCompanyReport(world: WorldState, company: Company): CompanyFinancialReport {
  const book = entityBook(world, company.id);
  const cashFlow = cashFlowForCompany(world, company.id);
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
  const income = accounts.filter((account) => account.category === "income").map((account) => ({ account, value: balanceOf(world, account.id) })).filter((item) => item.value > 0);
  const expenses = accounts.filter((account) => account.category === "expense").map((account) => ({ account, value: balanceOf(world, account.id) })).filter((item) => item.value > 0);
  const incomeTotal = income.reduce((sum, item) => sum + item.value, 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + item.value, 0);
  if (incomeTotal === 0 && expenseTotal === 0) return;
  const retained = accountIds.retainedEarnings(ownerId);
  ensureAccount(world.ledger, retained, ownerId, "Нераспределённая прибыль", "equity");
  const entries = [
    ...income.map((item) => ({ accountId: item.account.id, side: "debit" as const, amountCents: item.value })),
    ...expenses.map((item) => ({ accountId: item.account.id, side: "credit" as const, amountCents: item.value })),
  ];
  if (incomeTotal > expenseTotal) entries.push({ accountId: retained, side: "credit", amountCents: incomeTotal - expenseTotal });
  if (expenseTotal > incomeTotal) entries.push({ accountId: retained, side: "debit", amountCents: expenseTotal - incomeTotal });
  postTransaction(world, "ACCOUNTING_CLOSE", `Закрытие месяца: ${ownerId}`, entries);
}

export function closeMonthlyAccounting(world: WorldState): void {
  for (const company of world.companies) {
    if (!company.active) continue;
    const report = createCompanyReport(world, company);
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
    ...world.populationCohorts.map((item) => item.id),
    ...world.firmCohorts.map((item) => item.id),
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
