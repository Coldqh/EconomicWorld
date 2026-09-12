import { accountIds, bankAccountBalance, ensureAccount, postTransaction, primaryBankAccount, transferBankAccountBalance } from "../core/ledger.ts";
import type { Company, CompanyDecisionState, WorldState } from "../domain/model.ts";
import { issueLoan } from "../finance/credit.ts";
import { getBelief, PUBLIC_INFORMATION_AGENT, recordDecisionTrace } from "../information/system.ts";

function recentAverage(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

interface CompanyDecisionContext {
  priceByGood: Map<string, { sum: number; count: number }>;
  debtByBorrower: Map<string, number>;
  companiesWithActiveProject: Set<string>;
  macroByCountry: Map<string, WorldState["countryMacroStates"][number]>;
}

function buildCompanyDecisionContext(world: WorldState): CompanyDecisionContext {
  const priceByGood = new Map<string, { sum: number; count: number }>();
  for (const company of world.companies) if (company.active) {
    const aggregate = priceByGood.get(company.goodId) ?? { sum: 0, count: 0 };
    aggregate.sum += company.priceCents;
    aggregate.count += 1;
    priceByGood.set(company.goodId, aggregate);
  }
  const debtByBorrower = new Map<string, number>();
  for (const loan of world.loans) if (loan.status === "active") debtByBorrower.set(loan.borrowerId, (debtByBorrower.get(loan.borrowerId) ?? 0) + loan.remainingPrincipalCents);
  return {
    priceByGood,
    debtByBorrower,
    companiesWithActiveProject: new Set(world.capitalProjects.filter((project) => !["commissioned", "cancelled"].includes(project.status)).map((project) => project.companyId)),
    macroByCountry: new Map(world.countryMacroStates.map((state) => [state.countryId, state])),
  };
}

export function decideCompanyMonth(world: WorldState, company: Company, context = buildCompanyDecisionContext(world)): CompanyDecisionState {
  const reports = company.financialReports.slice(-6);
  const recentSales = [company.lastSalesMilliUnits, ...reports.slice(-3).map((report) => Math.round(report.revenueCents * 1_000 / Math.max(1, company.priceCents)))];
  const salesTrend = recentSales.length > 1 ? (recentSales[0] - recentSales.at(-1)!) / Math.max(1, recentSales.at(-1)!) : 0;
  const macro = context.macroByCountry.get(company.headquartersCountryId);
  const macroBelief = getBelief(world, company.id, "gdp-growth-bps", company.headquartersCountryId) ?? getBelief(world, PUBLIC_INFORMATION_AGENT, "gdp-growth-bps", company.headquartersCountryId);
  const observedGrowthBps = macroBelief?.observedValue ?? Math.round((macro?.outputGapBps ?? 0) / 2);
  const macroDemand = 1 + Math.max(-0.2, Math.min(0.2, observedGrowthBps / 25_000));
  const expectedDemand = Math.max(1_000, Math.round(recentAverage(recentSales) * (1 + salesTrend * 0.35) * macroDemand));
  const desiredInventory = Math.round(expectedDemand * (company.goodId === "services" ? 0.08 : 0.7));
  const unconstrained = Math.max(0, expectedDemand + desiredInventory - company.inventoryMilliUnits);
  const productionTarget = Math.min(company.capacityMilliUnits, unconstrained);
  const inventoryPressure = (company.inventoryMilliUnits - desiredInventory) / Math.max(1, desiredInventory);
  const utilization = Math.round(productionTarget * 10_000 / Math.max(1, company.capacityMilliUnits));
  const peerPrices = context.priceByGood.get(company.goodId);
  const competitorPrice = peerPrices && peerPrices.count > 1 ? (peerPrices.sum - company.priceCents) / (peerPrices.count - 1) : company.priceCents;
  const costFloor = Math.max(1, company.marginalCostCents);
  const targetPrice = Math.max(costFloor, Math.round((costFloor * 1.12 + competitorPrice * 0.45) / 1.57 * (1 - Math.max(-0.12, Math.min(0.12, inventoryPressure * 0.08)))));
  const cash = bankAccountBalance(world, primaryBankAccount(world, company.id)?.id ?? "");
  const profit = recentAverage(reports.map((report) => report.operatingCashFlowCents));
  const debt = context.debtByBorrower.get(company.id) ?? 0;
  const projectCost = Math.max(100_000, Math.round(company.productiveCapital.bookValueCents * 0.08));
  const needsCapex = utilization > 8_500 && profit > 0 && !context.companiesWithActiveProject.has(company.id);
  let financingChoice: CompanyDecisionState["financingChoice"] = "none";
  if (needsCapex) financingChoice = cash >= projectCost * 1.5 ? "cash" : debt < Math.max(profit * 24, projectCost) ? "credit" : company.corporateStatus === "public" ? "bond" : "equity";
  if (needsCapex) recordDecisionTrace(world, company.id, "CAPEX", company.id, macroBelief ? [macroBelief] : [], `Расширение мощности; финансирование: ${financingChoice}`);
  if (needsCapex) world.capitalProjects.push({ id: `capex-${company.id}-${world.clock.elapsedMonths}`, companyId: company.id, title: "Расширение производственной мощности", status: "proposed", costMinor: projectCost, spentMinor: 0, expectedMonthlyCashFlowMinor: Math.round(profit * 0.15), capacityAddedMilliUnits: Math.round(company.capacityMilliUnits * 0.08), constructionMonths: 6, monthsRemaining: 6, financing: financingChoice === "none" ? "cash" : financingChoice, proposedAtMonth: world.clock.elapsedMonths });
  const state: CompanyDecisionState = { companyId: company.id, expectedDemandMilliUnits: expectedDemand, desiredInventoryMilliUnits: desiredInventory, productionTargetMilliUnits: productionTarget, procurementBudgetMinor: Math.round(productionTarget * costFloor / 1_000 * 0.4), labourDemand: Math.max(1, Math.ceil(productionTarget / Math.max(1, company.productivityBps * 4))), targetPriceMinor: targetPrice, targetLeverageBps: company.industry.includes("bank") ? 75_000 : company.goodId === "services" ? 15_000 : 30_000, liquidityBufferMinor: Math.max(company.wageCents * company.employees.length * 3, Math.round(company.lastOperatingExpenseCents * 2)), financingChoice, distressAction: company.distressMonths >= 6 ? "equity-raise" : company.distressMonths >= 3 ? "refinance" : company.distressMonths > 0 ? "cut-capex" : "none", confidenceBps: macroBelief ? macroBelief.confidenceBps : Math.max(2_500, Math.min(9_000, 7_000 - Math.abs(salesTrend) * 5_000)), lastDecisionMonth: world.clock.elapsedMonths, reasons: [`ожидаемый спрос ${expectedDemand}`, `наблюдаемый рост ${(observedGrowthBps / 100).toFixed(1)}%`, `запасы ${company.inventoryMilliUnits}/${desiredInventory}`, `загрузка ${utilization / 100}%`] };
  company.capacityUtilizationBps = utilization;
  return state;
}

export function runCompanyDecisionCycle(world: WorldState): void {
  const context = buildCompanyDecisionContext(world);
  world.companyDecisionStates = world.companies.filter((company) => company.active).map((company) => decideCompanyMonth(world, company, context));
  for (const project of world.capitalProjects.filter((item) => item.status !== "commissioned" && item.status !== "cancelled")) {
    const company = world.companies.find((item) => item.id === project.companyId && item.active); if (!company) { project.status = "cancelled"; continue; }
    if (project.status === "proposed") project.status = project.expectedMonthlyCashFlowMinor * 120 > project.costMinor ? "approved" : "cancelled";
    if (project.status === "approved" && project.financing === "credit") {
      const loan = issueLoan(world, company.bankId, company.id, project.costMinor, 60, Math.max(150, company.distressMonths * 120));
      if (!loan) { project.status = "cancelled"; continue; }
    }
    if (project.status === "approved") project.status = "construction";
    if (project.status !== "construction") continue;
    const cash = bankAccountBalance(world, primaryBankAccount(world, company.id)?.id ?? "");
    const installment = Math.min(project.costMinor - project.spentMinor, Math.ceil(project.costMinor / project.constructionMonths));
    const supplier = world.companies.find((item) => item.active && item.id !== company.id && item.headquartersCountryId === company.headquartersCountryId && (item.goodId === "goods" || item.industry.toLowerCase().includes("стро")));
    const payer = primaryBankAccount(world, company.id); const recipient = supplier && primaryBankAccount(world, supplier.id);
    if (cash < installment || !supplier || !payer || !recipient || payer.currencyId !== recipient.currencyId) continue;
    const cashTx = transferBankAccountBalance(world, payer.id, recipient.id, installment, "CAPITAL_INVESTMENT", `Строительство ${project.title}`, [project.id]);
    if (!cashTx) continue;
    const cipId = accountIds.constructionInProgress(company.id, project.id); const incomeId = accountIds.operatingIncome(supplier.id);
    ensureAccount(world.ledger, cipId, company.id, `Незавершённое строительство ${project.title}`, "asset", payer.currencyId);
    ensureAccount(world.ledger, incomeId, supplier.id, "Выручка строительного поставщика", "income", payer.currencyId);
    postTransaction(world, "CAPITAL_INVESTMENT", `Капитализация затрат ${project.title}`, [{ accountId: cipId, side: "debit", amountCents: installment }, { accountId: incomeId, side: "credit", amountCents: installment }], [cashTx, project.id]);
    supplier.lastGrossRevenueCents += installment; project.spentMinor += installment; project.monthsRemaining -= 1;
    if (project.spentMinor >= project.costMinor || project.monthsRemaining <= 0) {
      const capitalId = accountIds.productiveCapital(company.id); ensureAccount(world.ledger, capitalId, company.id, "Производственный капитал", "asset", payer.currencyId);
      postTransaction(world, "CAPITAL_INVESTMENT", `Ввод в эксплуатацию ${project.title}`, [{ accountId: capitalId, side: "debit", amountCents: project.spentMinor }, { accountId: cipId, side: "credit", amountCents: project.spentMinor }], [project.id]);
      project.status = "commissioned"; company.capacityMilliUnits += project.capacityAddedMilliUnits; company.productiveCapital.capacityMilliUnits += project.capacityAddedMilliUnits; company.productiveCapital.acquisitionCostCents += project.spentMinor; company.productiveCapital.bookValueCents += project.spentMinor;
    }
  }
}
