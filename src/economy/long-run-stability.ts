import { balanceOf, accountIds } from "../core/ledger.ts";
import type { LongRunCountryPoint, LongRunWarning, WorldState } from "../domain/model.ts";

const ratio = (value: number, annualGdp: number): number => Math.round(value * 12 * 10_000 / Math.max(1, annualGdp));
const stockRatio = (value: number, annualGdp: number): number => Math.round(value * 10_000 / Math.max(1, annualGdp));

export function collectLongRunDiagnostics(world: WorldState, force = false): LongRunCountryPoint[] {
  world.longRunDiagnostics ??= { points: [], warnings: [], lastRecordedMonth: -1 };
  if (!force && world.clock.elapsedMonths % 60 !== 0) return [];
  if (world.longRunDiagnostics.lastRecordedMonth === world.clock.elapsedMonths) return [];
  const points = world.countries.map((country): LongRunCountryPoint => {
    const metric = [...world.countryMetricsHistory].reverse().find((item) => item.countryId === country.id);
    const period = world.countryEconomicAccounts.closedByCountry[country.id];
    const budget = world.governmentBudgets.find((item) => item.countryId === country.id)!;
    const householdAccounts = world.countryEconomicAccounts.householdAccounts.filter((item) => item.countryId === country.id);
    const firmAccounts = world.countryEconomicAccounts.firmAccounts.filter((item) => item.countryId === country.id);
    const actualMonthly = Math.max(1, period?.production.valueAddedMinor ?? metric?.nominalGdpMinor ?? 1);
    const annualGdp = actualMonthly * 12;
    const previous = [...world.longRunDiagnostics.points].reverse().find((item) => item.countryId === country.id);
    const bankCapitalMinor = world.banks.filter((item) => item.countryId === country.id).reduce((sum, bank) => sum + Math.max(0, balanceOf(world, accountIds.bankEquity(bank.id))), 0)
      + (world.bankingSectorCohorts.find((item) => item.countryId === country.id)?.capitalMinor ?? 0);
    const householdIncomeMinor = householdAccounts.reduce((sum, item) => sum + item.labourIncomeMinor + item.capitalIncomeMinor + item.transfersReceivedMinor, 0);
    const householdTaxesMinor = householdAccounts.reduce((sum, item) => sum + item.personalTaxesMinor + item.otherTaxesMinor, 0);
    const firmRevenueMinor = firmAccounts.reduce((sum, item) => sum + item.revenueMinor, 0);
    const firmWagesMinor = firmAccounts.reduce((sum, item) => sum + item.wagesMinor, 0);
    const firmProfitMinor = firmAccounts.reduce((sum, item) => sum + item.profitMinor, 0);
    const primarySpending = (period?.fiscal.consumptionMinor ?? 0) + (period?.fiscal.investmentMinor ?? 0) + (period?.fiscal.transfersMinor ?? 0) + (period?.fiscal.subsidiesMinor ?? 0);
    const revenue = (period?.fiscal.personalTaxMinor ?? 0) + (period?.fiscal.corporateTaxMinor ?? 0) + (period?.fiscal.consumptionTaxMinor ?? 0) + (period?.fiscal.tariffsMinor ?? 0) + (period?.fiscal.propertyOtherTaxMinor ?? 0) + (period?.fiscal.otherRevenueMinor ?? 0) + (period?.fiscal.soeDividendsMinor ?? 0);
    return {
      countryId: country.id, elapsedMonth: world.clock.elapsedMonths,
      structuralNominalGdpMinor: metric?.structuralNominalGdpMinor ?? world.countryScaleReconciliations.find((item) => item.countryId === country.id)?.targetMonthlyNominalGdpMinor ?? actualMonthly,
      actualNominalGdpMinor: actualMonthly, actualRealGdpMinor: metric?.realGdpMinor ?? actualMonthly, gdpDeflatorBps: metric?.gdpDeflatorBps ?? 10_000,
      nominalGdpGrowthBps: previous ? Math.round((actualMonthly - previous.actualNominalGdpMinor) * 10_000 / Math.max(1, previous.actualNominalGdpMinor)) : 0,
      realGdpGrowthBps: previous ? Math.round(((metric?.realGdpMinor ?? actualMonthly) - previous.actualRealGdpMinor) * 10_000 / Math.max(1, previous.actualRealGdpMinor)) : 0,
      population: world.populationCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.populationCount, 0),
      householdIncomeMinor, householdConsumptionMinor: period?.expenditure.householdConsumptionMinor ?? 0, householdSavingsMinor: householdAccounts.reduce((sum, item) => sum + item.savingsMinor, 0), householdTaxesMinor,
      firmRevenueMinor, firmWagesMinor, firmProfitMinor, corporateTaxesMinor: period?.fiscal.corporateTaxMinor ?? 0,
      investmentMinor: (period?.expenditure.privateInvestmentMinor ?? 0) + (period?.expenditure.governmentInvestmentMinor ?? 0),
      governmentRevenueMinor: revenue, governmentPrimarySpendingMinor: primarySpending, governmentInterestMinor: period?.fiscal.interestMinor ?? 0,
      debtMinor: budget.publicDebtMinor, effectiveDebtRateBps: budget.effectiveAverageDebtRateBps, marginalDebtRateBps: budget.marginalNewIssueYieldBps, averageMaturityMonths: budget.averageMaturityMonths,
      wagesToGdpBps: ratio(period?.income.employeeCompensationMinor ?? firmWagesMinor, annualGdp), profitsToGdpBps: ratio(period?.income.operatingSurplusMinor ?? firmProfitMinor, annualGdp),
      consumptionToGdpBps: ratio(period?.expenditure.householdConsumptionMinor ?? 0, annualGdp), investmentToGdpBps: ratio((period?.expenditure.privateInvestmentMinor ?? 0) + (period?.expenditure.governmentInvestmentMinor ?? 0), annualGdp),
      revenueToGdpBps: ratio(revenue, annualGdp), primarySpendingToGdpBps: ratio(primarySpending, annualGdp), interestToGdpBps: ratio(period?.fiscal.interestMinor ?? 0, annualGdp), debtToGdpBps: stockRatio(budget.publicDebtMinor, annualGdp),
      creditToGdpBps: stockRatio(metric?.creditMinor ?? 0, annualGdp), bankCapitalMinor, unemploymentBps: metric?.unemploymentBps ?? 0, inflationBps: metric?.inflationBps ?? 0,
      activeCompanies: world.companies.filter((item) => item.headquartersCountryId === country.id && item.active).length,
      representedFirms: world.firmCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.firmCountEquivalent, 0),
    };
  });
  const warnings: LongRunWarning[] = [];
  const push = (point: LongRunCountryPoint, code: string, reason: string, evidence: Record<string, number>, severity: LongRunWarning["severity"] = "warning") => warnings.push({ id: `long-run:${point.countryId}:${point.elapsedMonth}:${code}`, countryId: point.countryId, elapsedMonth: point.elapsedMonth, severity, code, reason, evidence });
  for (const point of points) {
    const values = Object.values(point).filter((value): value is number => typeof value === "number");
    if (values.some((value) => !Number.isFinite(value))) push(point, "non-finite", "Обнаружено NaN или Infinity", {}, "failure");
    if (point.actualNominalGdpMinor <= 0 || point.population <= 0 || point.debtMinor < 0 || point.bankCapitalMinor < 0) push(point, "impossible-stock", "Невозможное значение экономического запаса", { gdp: point.actualNominalGdpMinor, population: point.population, debt: point.debtMinor, bankCapital: point.bankCapitalMinor }, "failure");
    if (point.actualNominalGdpMinor > point.structuralNominalGdpMinor * 0.35 && point.wagesToGdpBps < 1_500) push(point, "wage-collapse", "Доля оплаты труда исчезает при продолжающемся выпуске", { wagesToGdpBps: point.wagesToGdpBps });
    if (point.actualNominalGdpMinor > point.structuralNominalGdpMinor * 0.35 && point.consumptionToGdpBps < 1_500) push(point, "consumption-collapse", "Потребление исчезает при продолжающемся выпуске", { consumptionToGdpBps: point.consumptionToGdpBps });
    if (point.actualNominalGdpMinor > point.structuralNominalGdpMinor * 0.35 && point.revenueToGdpBps < 200) push(point, "tax-base-collapse", "Налоговая база исчезает без общего коллапса выпуска", { revenueToGdpBps: point.revenueToGdpBps });
    if (point.actualNominalGdpMinor > point.structuralNominalGdpMinor * 0.35 && point.primarySpendingToGdpBps < 150) push(point, "government-ceased", "Первичные государственные обязательства почти не исполняются", { primarySpendingToGdpBps: point.primarySpendingToGdpBps });
    if (point.activeCompanies + point.representedFirms <= 0) push(point, "all-firms-gone", "Исчезли все явные и агрегированные фирмы", {}, "failure");
  }
  world.longRunDiagnostics.points.push(...points);
  world.longRunDiagnostics.warnings.push(...warnings);
  world.longRunDiagnostics.points = world.longRunDiagnostics.points.filter((item) => item.elapsedMonth >= world.clock.elapsedMonths - 600);
  world.longRunDiagnostics.warnings = world.longRunDiagnostics.warnings.filter((item) => item.elapsedMonth >= world.clock.elapsedMonths - 600);
  world.longRunDiagnostics.lastRecordedMonth = world.clock.elapsedMonths;
  return points;
}

export function longRunDegenerationWarnings(world: WorldState): LongRunWarning[] {
  return world.longRunDiagnostics?.warnings ?? [];
}
