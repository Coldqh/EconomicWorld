import { closeCountryEconomicPeriods, openCountryEconomicPeriods } from "../accounting/country-periods.ts";
import { closeMonthlyAccounting, resetCompanyPeriod } from "../accounting/periods.ts";
import { formatSimulationDate, isQuarterEnd, isYearEnd } from "../core/clock.ts";
import { emitSimpleEvent, recordGoodsMovement } from "../core/events.ts";
import {
  accountIds,
  capitalContribution,
  depositOf,
  ensureAccount,
  postTransaction,
  settleDepositPayment,
  transferDeposit,
} from "../core/ledger.ts";
import type { Company, GoodDefinition, Household, LedgerEntry, WorldState } from "../domain/model.ts";
import { defaultBorrowerLoans, issueLoan, settleBorrowerLoansFromCash, serviceLoans } from "../finance/credit.ts";
import { recordPlayerMonth } from "../player/system.ts";
import { progressPlayerWorld } from "../player/world-commands.ts";
import { compactLedgerHistory, migratePopulationCohorts, updateAggregateEconomies, updateWorldDiagnostics } from "../world/systems.ts";
import { runGlobalEconomyMonth } from "./global-economy.ts";
import { runGeoeconomicMonth } from "../geoeconomics/engine.ts";
import { runPoliticalEconomyMonth } from "../political-economy/engine.ts";
import { runDefenseEconomyMonth } from "../defense-economy/engine.ts";
import { runConflictPostEconomy, runConflictPreEconomy } from "../conflict/engine.ts";
import { checkLongRunStage } from "./long-run-invariant-harness.ts";
import { collectCountryMetrics, collectMetrics } from "./metrics.ts";
import { calculateFundNav, runInstitutionalFinance } from "../finance/institutional.ts";
import { processMarginRisk } from "../finance/leverage.ts";
import { allocateConsumptionBudget } from "./consumer-choice.ts";
import { runBankruptcyWaterfall, serviceCorporateBonds } from "../corporate/finance.ts";
import { runMarketAgents } from "../markets/exchange.ts";
import { processDerivativeMonth } from "../finance/derivatives.ts";
import { runAutonomousDerivativeDecisions } from "../finance/autonomous-derivatives.ts";
import { settleFinancialPayment } from "../finance/financial-settlement.ts";
import { prepareGovernmentCommitments, runMacroeconomicMonth, serviceSovereignDebt } from "./macroeconomics.ts";
import { collectLongRunDiagnostics } from "./long-run-stability.ts";
import { runCompanyDecisionCycle } from "../company/decision-engine.ts";
import { runBankAlm } from "../banking/alm-engine.ts";
import { runMarketMakers } from "../markets/market-makers/engine.ts";
import { runEtfArbitrage } from "../finance/etf-ecosystem.ts";
import { runInsuranceMonth } from "../insurance/engine.ts";
import { advanceMAndA, advanceIPO, runMAndAIntegration } from "../corporate-finance/transactions.ts";
import { captureEconomicExplanations } from "./why-engine.ts";
import { processFundRedemptions } from "../finance/fund-liquidity.ts";
import { runHeterogeneousMarketAgents } from "../markets/agents/engine.ts";
import { evaluateCashAndCarry, runAutonomousTriangularFxArbitrage, runCrossVenueArbitrage } from "../markets/arbitrage/engine.ts";
import { runPrivateEquityMonth } from "../private-equity/engine.ts";
import { activeIpoProcesses, activeMAndADeals } from "../corporate-finance/pipeline-index.ts";
import { runInformationMonth } from "../information/system.ts";
import { syncPlayerProgression } from "../player/progression.ts";
import {
  beginSimulationMonthTiming,
  finishSimulationMonthTiming,
  finishSimulationPhaseTiming,
  startSimulationPhaseTiming,
} from "./performance-timing.ts";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

function activeCompanies(world: WorldState): Company[] {
  return world.companies.filter((company) => company.active);
}

function goodById(world: WorldState, id: string): GoodDefinition {
  const good = world.goods.find((item) => item.id === id);
  if (!good) throw new Error(`Товар ${id} не найден`);
  return good;
}

function companyById(world: WorldState, id: string): Company | undefined {
  return world.companies.find((company) => company.id === id);
}

function countryIdForCity(world: WorldState, cityId: string): string {
  return world.cities.find((city) => city.id === cityId)?.countryId ?? "ru";
}

function currencyForEntity(world: WorldState, entityId: string): string {
  const account = world.bankAccounts.find((item) => item.ownerId === entityId && item.isPrimary && item.status === "active")
    ?? world.bankAccounts.find((item) => item.ownerId === entityId && item.status === "active");
  return account?.currencyId ?? "RUB";
}

function governmentForCountry(world: WorldState, countryId: string) {
  return world.governments.find((government) => government.countryId === countryId) ?? world.government;
}

function leaveCompany(world: WorldState, household: Household, reason: string): void {
  if (!household.employerId) return;
  const formerEmployerId = household.employerId;
  const employer = companyById(world, formerEmployerId);
  if (employer) employer.employees = employer.employees.filter((id) => id !== household.id);
  household.employerId = null;
  household.monthsUnemployed = 0;
  const person = world.people.find((item) => item.householdId === household.id);
  if (person) person.occupationId = null;
  emitSimpleEvent(world, "EmployeeLeft", "Трудовой договор завершён", `${household.displayName}: ${reason}.`, [household.id, formerEmployerId], "attention");
}

function runLabourMarket(world: WorldState): void {
  for (const household of world.households) if (!household.employerId) household.monthsUnemployed += 1;
  if (isQuarterEnd(world.clock)) {
    for (const company of activeCompanies(world)) {
      if (company.distressMonths < 2 && company.inventoryMilliUnits < company.capacityMilliUnits * 2.2) continue;
      const worker = company.employees
        .filter((id) => id !== world.player.householdId)
        .map((id) => world.households.find((item) => item.id === id)!)
        .sort((left, right) => left.productivityBps - right.productivityBps)[0];
      if (worker && company.employees.length > 3) leaveCompany(world, worker, `${company.name} сократила штат`);
    }
  }
  const unemployed = world.households
    .filter((household) => !household.employerId && household.id !== world.player.householdId)
    .sort((left, right) => right.monthsUnemployed - left.monthsUnemployed || right.skillBps + right.productivityBps - left.skillBps - left.productivityBps);
  const employers = activeCompanies(world)
    .filter((company) => company.distressMonths < 2)
    .map((company) => ({ company, vacancies: Math.max(0, clamp(Math.ceil(company.capacityMilliUnits / 55_000), 4, 12) - company.employees.length) }))
    .filter((item) => item.vacancies > 0)
    .sort((left, right) => right.company.wageCents - left.company.wageCents);
  for (const employer of employers) {
    while (employer.vacancies > 0) {
      const candidateIndex = unemployed.findIndex((household) => household.cityId === employer.company.cityId && employer.company.wageCents >= household.reservationWageCents);
      if (candidateIndex < 0) break;
      const household = unemployed.splice(candidateIndex, 1)[0];
      household.employerId = employer.company.id;
      household.monthsUnemployed = 0;
      employer.company.employees.push(household.id);
      employer.vacancies -= 1;
      emitSimpleEvent(world, "EmployeeHired", "Заключён трудовой договор", `${employer.company.name} · ${household.displayName}`, [employer.company.id, household.id], "positive", [], { wageCents: employer.company.wageCents });
    }
  }
}

function companyDebt(world: WorldState, companyId: string): number {
  return world.loans.filter((loan) => loan.borrowerId === companyId && loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
}

function fundPayrollIfNeeded(world: WorldState, company: Company, payrollCents: number): void {
  const target = Math.round(payrollCents * 1.25);
  if (payrollCents <= 0 || depositOf(world, company.id) >= target || companyDebt(world, company.id) > 0) return;
  const request = clamp(target - depositOf(world, company.id) + payrollCents, 200_000_00, 2_500_000_00);
  issueLoan(world, company.bankId, company.id, request, 60, clamp(900 - Math.floor(company.productivityBps / 24), 220, 800));
}

function payWagesAndTaxes(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const payroll = company.wageCents * company.employees.length;
    fundPayrollIfNeeded(world, company, payroll);
    if (depositOf(world, company.id) < payroll) {
      company.missedPayrollMonths += 1;
      emitSimpleEvent(world, "CompanyDistressed", "Недостаточно денег на зарплаты", company.name, [company.id, company.bankId], company.missedPayrollMonths >= 2 ? "critical" : "attention", [], { payrollCents: payroll, depositCents: depositOf(world, company.id) });
      continue;
    }
    company.missedPayrollMonths = 0;
    for (const householdId of [...company.employees]) {
      const household = world.households.find((item) => item.id === householdId);
      if (!household) continue;
      const wageTx = transferDeposit(world, company.id, household.id, company.wageCents, "WAGE", `Зарплата: ${company.name} → ${household.displayName}`);
      if (!wageTx) continue;
      company.lastWagesCents += company.wageCents;
      company.lastOperatingExpenseCents += company.wageCents;
      const government = governmentForCountry(world, company.headquartersCountryId);
      const complianceBps = world.politicalEconomy?.compliance.find((item) => item.countryId === company.headquartersCountryId)?.taxComplianceBps ?? 10_000;
      const tax = Math.round(company.wageCents * government.incomeTaxBps / 10_000 * complianceBps / 10_000);
      transferDeposit(world, household.id, government.id, tax, "INCOME_TAX", `Налог на доход: ${household.displayName}`, [wageTx]);
    }
  }
}

function paySocialTransfers(world: WorldState): void {
  for (const household of world.households) {
    if (household.employerId || household.monthsUnemployed < 1) continue;
    const government = governmentForCountry(world, countryIdForCity(world, household.cityId));
    const amount = government.monthlyUnemploymentBenefitCents;
    if (depositOf(world, government.id) < amount) continue;
    transferDeposit(world, government.id, household.id, amount, "SOCIAL_TRANSFER", `Пособие: ${household.displayName}`);
  }
}

function suppliersFor(world: WorldState, goodId: string, countryId?: string): Company[] {
  return activeCompanies(world).filter((company) => company.goodId === goodId && company.inventoryMilliUnits > 0 && (!countryId || company.headquartersCountryId === countryId)).sort((left, right) => left.priceCents - right.priceCents || left.id.localeCompare(right.id));
}

function consumeSellerInventory(world: WorldState, seller: Company, quantity: number, reason: "INPUT" | "CONSUMPTION" | "CAPITAL", destinationId: string, causeIds: string[]): number {
  quantity = Math.min(quantity, seller.inventoryMilliUnits);
  if (quantity <= 0) return 0;
  const value = seller.inventoryMilliUnits > 0 ? Math.min(seller.inventoryValueCents, Math.round((seller.inventoryValueCents * quantity) / seller.inventoryMilliUnits)) : 0;
  if (value > 0) {
    seller.inventoryValueCents -= value;
    seller.lastCogsCents += value;
    seller.lastOperatingExpenseCents += value;
  }
  seller.inventoryMilliUnits -= quantity;
  seller.lastSalesMilliUnits += quantity;
  recordGoodsMovement(world, { goodId: seller.goodId, fromId: seller.id, toId: destinationId, quantityMilliUnits: quantity, reason, causeIds });
  return quantity;
}

function procureInputs(world: WorldState): void {
  for (const buyer of activeCompanies(world)) {
    const good = goodById(world, buyer.goodId);
    const plannedOutput = Math.min(buyer.capacityMilliUnits, Math.round((buyer.employees.length * 48_000 * buyer.productivityBps) / 10_000));
    for (const [inputId, coefficient] of Object.entries(good.recipe)) {
      const desired = Math.ceil(plannedOutput * coefficient * 1.2);
      let need = Math.max(0, desired - (buyer.inputInventoryMilliUnits[inputId] ?? 0));
      for (const seller of suppliersFor(world, inputId, buyer.headquartersCountryId)) {
        if (need <= 0 || depositOf(world, buyer.id) < seller.priceCents) break;
        const quantity = Math.min(need, seller.inventoryMilliUnits, Math.floor((depositOf(world, buyer.id) * 1_000) / seller.priceCents));
        const cost = Math.floor((quantity * seller.priceCents) / 1_000);
        if (quantity <= 0 || cost <= 0) continue;
        const inputAccount = accountIds.inputInventory(buyer.id, inputId);
        ensureAccount(world.ledger, inputAccount, buyer.id, `Сырьё: ${goodById(world, inputId).name}`, "asset", currencyForEntity(world, buyer.id));
        const tx = settleDepositPayment(world, buyer.id, seller.id, cost, "INPUT_PURCHASE", `${buyer.name} купила ${goodById(world, inputId).shortName}`, inputAccount, accountIds.operatingIncome(seller.id));
        if (!tx) break;
        const moved = consumeSellerInventory(world, seller, quantity, "INPUT", buyer.id, [tx]);
        buyer.inputInventoryMilliUnits[inputId] = (buyer.inputInventoryMilliUnits[inputId] ?? 0) + moved;
        buyer.inputInventoryValueCents[inputId] = (buyer.inputInventoryValueCents[inputId] ?? 0) + cost;
        seller.lastGrossRevenueCents += cost;
        need -= moved;
      }
    }
  }
}

function produceGoods(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const good = goodById(world, company.goodId);
    const laborPotential = company.employees.length * 48_000;
    const capitalFactorBps = clamp(Math.round(Math.sqrt(company.productiveCapital.bookValueCents / Math.max(1, company.productiveCapital.acquisitionCostCents)) * 10_000), 3_000, 12_000);
    let output = Math.min(company.capacityMilliUnits, Math.round(laborPotential * company.productivityBps * company.technologyBps * company.managementBps * capitalFactorBps / 100_000_000_000_000));
    output = Math.round(output * company.globalInputConstraintBps / 10_000);
    for (const [inputId, coefficient] of Object.entries(good.recipe)) output = Math.min(output, Math.floor((company.inputInventoryMilliUnits[inputId] ?? 0) / coefficient));
    output = Math.max(0, output);
    if (output <= 0) continue;
    const credits: LedgerEntry[] = [];
    let consumedValue = 0;
    for (const [inputId, coefficient] of Object.entries(good.recipe)) {
      const used = Math.min(company.inputInventoryMilliUnits[inputId] ?? 0, Math.ceil(output * coefficient));
      const stock = company.inputInventoryMilliUnits[inputId] ?? 0;
      const stockValue = company.inputInventoryValueCents[inputId] ?? 0;
      const value = stock > 0 ? Math.min(stockValue, Math.round((stockValue * used) / stock)) : 0;
      company.inputInventoryMilliUnits[inputId] = stock - used;
      company.inputInventoryValueCents[inputId] = stockValue - value;
      consumedValue += value;
      company.lastIntermediateConsumptionCents += value;
      company.lastIntermediateConsumptionBaseCents += Math.round((used * goodById(world, inputId).basePriceCents) / 1_000);
      if (value > 0) credits.push({ accountId: accountIds.inputInventory(company.id, inputId), side: "credit", amountCents: value });
    }
    if (consumedValue > 0) {
      ensureAccount(world.ledger, accountIds.finishedInventory(company.id), company.id, "Готовая продукция", "asset", currencyForEntity(world, company.id));
      postTransaction(world, "PRODUCTION", `Выпуск: ${company.name}`, [{ accountId: accountIds.finishedInventory(company.id), side: "debit", amountCents: consumedValue }, ...credits]);
      company.inventoryValueCents += consumedValue;
    }
    company.inventoryMilliUnits += output;
    company.lastProductionMilliUnits = output;
    company.capacityUtilizationBps = Math.round(output * 10_000 / Math.max(1, company.capacityMilliUnits));
    company.learningByDoingBps = Math.min(3_000, company.learningByDoingBps + Math.max(1, Math.round(company.capacityUtilizationBps / 2_500)));
    company.technologyBps = Math.min(15_000, company.technologyBps + (company.capacityUtilizationBps > 7_000 ? 1 : 0));
    recordGoodsMovement(world, { goodId: company.goodId, fromId: company.id, toId: company.id, quantityMilliUnits: output, reason: "PRODUCTION", causeIds: [] });
  }
}

function householdBudget(world: WorldState, household: Household): number {
  const cash = depositOf(world, household.id);
  const localGovernment = governmentForCountry(world, countryIdForCity(world, household.cityId));
  const monthlyIncome = household.employerId ? companyById(world, household.employerId)?.wageCents ?? 0 : localGovernment.monthlyUnemploymentBenefitCents;
  const desiredReserve = Math.round(monthlyIncome * (1.2 + household.liquidityPreferenceBps / 5_000));
  const spendableStock = Math.max(0, cash - desiredReserve);
  const propensity = household.id === world.player.householdId ? world.player.consumptionBudgetBps : household.consumptionPropensityBps;
  const consumptionElasticity = world.countryCalibratedParameters[countryIdForCity(world, household.cityId)]?.consumptionIncomeElasticityBps ?? world.calibratedParameters.consumptionIncomeElasticityBps;
  const expectedInflationEffect = clamp(10_000 + household.expectedInflationBps * 0.3, 9_000, 11_500);
  const countryId = countryIdForCity(world, household.cityId);
  const macro = world.countryMacroStates.find((state) => state.countryId === countryId);
  const debtService = world.loans.filter((loan) => loan.borrowerId === household.id && loan.status === "active").reduce((sum, loan) => sum + Math.ceil(loan.remainingPrincipalCents / Math.max(1, loan.remainingMonths)) + Math.round(loan.remainingPrincipalCents * loan.annualRateBps / 10_000 / 12), 0);
  const realDepositRateBps = (macro?.depositRateBps ?? 0) - household.expectedInflationBps;
  const rateSavingsEffectBps = clamp(10_000 - Math.max(0, realDepositRateBps) * 0.45, 8_200, 10_500);
  const debtBurdenEffectBps = clamp(10_000 - Math.round(debtService * 4_000 / Math.max(1, monthlyIncome)), 5_500, 10_000);
  return Math.min(Math.round(cash * 0.22), Math.round(((monthlyIncome * propensity * consumptionElasticity) / 100_000_000 + spendableStock * 0.06) * expectedInflationEffect / 10_000 * rateSavingsEffectBps / 10_000 * debtBurdenEffectBps / 10_000));
}

function chooseSeller(world: WorldState, household: Household, goodId: string): Company | undefined {
  const suppliers = suppliersFor(world, goodId, countryIdForCity(world, household.cityId));
  if (!suppliers.length) return undefined;
  const preferred = household.preferredSellerByGoodId[goodId];
  return [...suppliers].sort((left, right) => {
    const leftLoyalty = left.id === preferred ? 900 : 0;
    const rightLoyalty = right.id === preferred ? 900 : 0;
    const leftLogistics = left.cityId === household.cityId ? 0 : Math.round(left.priceCents * 0.08);
    const rightLogistics = right.cityId === household.cityId ? 0 : Math.round(right.priceCents * 0.08);
    const leftQuality = Math.round((left.qualityBps + left.brandReputationBps) * left.priceCents / 80_000);
    const rightQuality = Math.round((right.qualityBps + right.brandReputationBps) * right.priceCents / 80_000);
    const leftScore = Math.round((left.priceCents * household.priceSensitivityBps) / 10_000) + leftLogistics - leftLoyalty - leftQuality + Math.round((left.inventoryMilliUnits / Math.max(1, left.capacityMilliUnits)) * -100);
    const rightScore = Math.round((right.priceCents * household.priceSensitivityBps) / 10_000) + rightLogistics - rightLoyalty - rightQuality + Math.round((right.inventoryMilliUnits / Math.max(1, right.capacityMilliUnits)) * -100);
    return leftScore - rightScore || left.id.localeCompare(right.id);
  })[0];
}

function sellFinalGood(world: WorldState, payerId: string, seller: Company, budget: number, reason: "CONSUMPTION" | "CAPITAL" | "PUBLIC_CAPITAL", destinationId: string): number {
  const quantity = Math.min(seller.inventoryMilliUnits, Math.floor((budget * 1_000) / Math.max(1, seller.priceCents)));
  const gross = Math.floor((quantity * seller.priceCents) / 1_000);
  if (quantity <= 0 || gross <= 0) return 0;
  const kind = reason === "CAPITAL" ? "CAPITAL_INVESTMENT" : reason === "PUBLIC_CAPITAL" ? "PUBLIC_INVESTMENT" : "GOODS_CLEARING";
  const payerAccount = reason === "CAPITAL" ? accountIds.productiveCapital(payerId) : reason === "PUBLIC_CAPITAL" ? accountIds.infrastructure(payerId) : accountIds.operatingExpense(payerId);
  ensureAccount(world.ledger, payerAccount, payerId, reason === "CAPITAL" ? "Производственный капитал" : reason === "PUBLIC_CAPITAL" ? "Инфраструктурный капитал" : "Потребление", reason === "CONSUMPTION" ? "expense" : "asset", currencyForEntity(world, payerId));
  const destinationName = world.households.find((item) => item.id === destinationId)?.displayName
    ?? world.companies.find((item) => item.id === destinationId)?.name
    ?? (world.governments.some((government) => government.id === destinationId) ? "Правительство" : destinationId);
  const tx = settleDepositPayment(world, payerId, seller.id, gross, kind, `${destinationName} ← ${seller.name}`, payerAccount, accountIds.operatingIncome(seller.id));
  if (!tx) return 0;
  const moved = consumeSellerInventory(world, seller, quantity, reason === "PUBLIC_CAPITAL" ? "CAPITAL" : reason, destinationId, [tx]);
  seller.lastGrossRevenueCents += gross;
  if (world.governments.some((government) => government.id === payerId)) seller.lastGovernmentSalesCents += gross;
  else if (reason === "CONSUMPTION") seller.lastHouseholdSalesCents += gross;
  return moved > 0 ? gross : 0;
}

function recognizeMonthlySalesCosts(world: WorldState): void {
  for (const company of world.companies) {
    if (company.lastCogsCents > 0) {
      const currency = currencyForEntity(world, company.id);
      ensureAccount(world.ledger, accountIds.cogsExpense(company.id), company.id, "Себестоимость продаж", "expense", currency);
      ensureAccount(world.ledger, accountIds.finishedInventory(company.id), company.id, "Готовая продукция", "asset", currency);
      postTransaction(world, "COGS", `Себестоимость за месяц: ${company.name}`, [
        { accountId: accountIds.cogsExpense(company.id), side: "debit", amountCents: company.lastCogsCents },
        { accountId: accountIds.finishedInventory(company.id), side: "credit", amountCents: company.lastCogsCents },
      ]);
    }
    const government = governmentForCountry(world, company.headquartersCountryId);
    const complianceBps = world.politicalEconomy?.compliance.find((item) => item.countryId === company.headquartersCountryId)?.taxComplianceBps ?? 10_000;
    const salesTax = Math.min(depositOf(world, company.id), Math.round(company.lastGrossRevenueCents * government.salesTaxBps / 10_000 * complianceBps / 10_000));
    if (salesTax <= 0) continue;
    const taxTx = transferDeposit(world, company.id, government.id, salesTax, "SALES_TAX", `Налог с продаж за месяц: ${company.name}`);
    if (taxTx) { company.lastTaxCents += salesTax; company.lastOperatingExpenseCents += salesTax; }
  }
}

function clearHouseholdMarket(world: WorldState): void {
  for (const household of world.households) {
    if (household.id === world.player.householdId) continue;
    const totalBudget = householdBudget(world, household);
    if (totalBudget <= 0) continue;
    const budgets = allocateConsumptionBudget(world, household, totalBudget);
    household.lastDisposableIncomeCents = household.employerId ? companyById(world, household.employerId)?.wageCents ?? 0 : governmentForCountry(world, countryIdForCity(world, household.cityId)).monthlyUnemploymentBenefitCents;
    household.lastSpendingByCategoryCents = { food: 0, housing: 0, energy: 0, transport: 0, services: 0, goods: 0, education: 0, entertainment: 0, luxury: 0 };
    for (const good of world.goods) {
      let budget = budgets[good.id] ?? 0;
      budget = Math.min(budget, depositOf(world, household.id));
      const seller = chooseSeller(world, household, good.id);
      if (!seller || budget <= 0) continue;
      const before = seller.lastSalesMilliUnits;
      const spent = sellFinalGood(world, household.id, seller, budget, "CONSUMPTION", household.id);
      const quantity = seller.lastSalesMilliUnits - before;
      if (spent > 0) {
        household.consumptionMilliUnits[good.id] = (household.consumptionMilliUnits[good.id] ?? 0) + quantity;
        household.preferredSellerByGoodId[good.id] = seller.id;
        const category = good.id === "food" ? "food" : good.id === "energy" ? "energy" : good.id === "services" ? "services" : "goods";
        household.lastSpendingByCategoryCents[category] += spent;
      }
    }
  }
  const player = world.households.find((household) => household.id === world.player.householdId);
  if (player) {
    player.lastDisposableIncomeCents = player.employerId ? companyById(world, player.employerId)?.wageCents ?? 0 : governmentForCountry(world, countryIdForCity(world, player.cityId)).monthlyUnemploymentBenefitCents;
    player.lastSpendingByCategoryCents = { food: 0, housing: 0, energy: 0, transport: 0, services: 0, goods: 0, education: 0, entertainment: 0, luxury: 0 };
    const foodQuantityMilliUnits = { minimal: 12_000, basic: 18_000, good: 27_000, premium: 40_000 }[world.player.foodPlanId];
    const seller = chooseSeller(world, player, "food");
    if (seller) {
      const budget = Math.min(depositOf(world, player.id), Math.max(1, Math.round(foodQuantityMilliUnits * seller.priceCents / 1_000)));
      const before = seller.lastSalesMilliUnits;
      const spent = sellFinalGood(world, player.id, seller, budget, "CONSUMPTION", player.id);
      const quantity = seller.lastSalesMilliUnits - before;
      if (spent > 0) {
        player.consumptionMilliUnits.food = (player.consumptionMilliUnits.food ?? 0) + quantity;
        player.preferredSellerByGoodId.food = seller.id;
        player.lastSpendingByCategoryCents.food = spent;
      }
    }
  }
}

function governmentPurchases(world: WorldState): void {
  for (const government of world.governments) {
    const fiscal = world.governmentBudgets.find((item) => item.governmentId === government.id);
    const primary = (fiscal?.mandatoryPrimarySpendingMinor ?? 0) + (fiscal?.discretionaryPrimarySpendingMinor ?? 0);
    const primaryTargetBps = Math.max(1, (fiscal?.governmentConsumptionTargetBps ?? 1_500) + (fiscal?.publicInvestmentTargetBps ?? 300) + (fiscal?.socialTransferTargetBps ?? 0));
    const transferTarget = Math.round(primary * (fiscal?.socialTransferTargetBps ?? 0) / primaryTargetBps);
    const allRecipientCohorts = world.populationCohorts.filter((item) => item.countryId === government.countryId);
    const recipientCohorts = allRecipientCohorts.length ? [allRecipientCohorts[world.clock.elapsedMonths % allRecipientCohorts.length]] : [];
    let transfersPaid = 0;
    for (const [index, cohort] of recipientCohorts.entries()) {
      const remaining = Math.min(depositOf(world, government.id), transferTarget - transfersPaid);
      if (remaining <= 0) break;
      const amount = index === recipientCohorts.length - 1 ? remaining : Math.min(remaining, transferTarget);
      const tx = amount > 0 ? transferDeposit(world, government.id, cohort.id, amount, "SOCIAL_TRANSFER", `Социальные обязательства · ${government.countryId}`) : null;
      if (tx) transfersPaid += amount;
    }
    const investmentBudget = Math.min(depositOf(world, government.id), Math.round(primary * (fiscal?.publicInvestmentTargetBps ?? 300) / Math.max(1, (fiscal?.governmentConsumptionTargetBps ?? 1_500) + (fiscal?.publicInvestmentTargetBps ?? 300))));
    let budget = Math.min(depositOf(world, government.id), Math.max(0, primary - investmentBudget - transfersPaid));
    const allCohortSuppliers = world.firmCohorts.filter((item) => item.countryId === government.countryId);
    const supplierWindow = Math.min(1, allCohortSuppliers.length);
    const supplierOffset = allCohortSuppliers.length ? (world.clock.elapsedMonths * supplierWindow) % allCohortSuppliers.length : 0;
    const cohortSuppliers = Array.from({ length: supplierWindow }, (_, index) => allCohortSuppliers[(supplierOffset + index) % allCohortSuppliers.length]);
    const cohortBudget = cohortSuppliers.length ? Math.min(budget, Math.round(budget * 7_000 / 10_000)) : 0;
    let cohortSpent = 0;
    for (const [index, supplier] of cohortSuppliers.entries()) {
      const remaining = cohortBudget - cohortSpent;
      const amount = Math.min(depositOf(world, government.id), remaining, index === cohortSuppliers.length - 1 ? remaining : Math.round(cohortBudget / Math.max(1, cohortSuppliers.length)));
      if (amount <= 0) continue;
      const tx = transferDeposit(world, government.id, supplier.id, amount, "PROCUREMENT", `Государственные услуги · ${supplier.industry}`);
      if (tx) { cohortSpent += amount; supplier.revenueCents = Math.max(supplier.revenueCents, amount); supplier.valueAddedMinor = Math.max(1, Math.round(supplier.revenueCents * 5_200 / 10_000)); supplier.intermediateConsumptionMinor = Math.max(1, supplier.revenueCents - supplier.valueAddedMinor); }
    }
    budget = Math.max(0, budget - cohortSpent);
    for (const goodId of ["services", "goods"] as const) {
      const seller = suppliersFor(world, goodId, government.countryId)[0];
      if (!seller) continue;
      sellFinalGood(world, government.id, seller, Math.floor(budget / 2), "CONSUMPTION", government.id);
    }
    const capitalSeller = suppliersFor(world, "goods", government.countryId)[0];
    if (capitalSeller && investmentBudget > 0) {
      sellFinalGood(world, government.id, capitalSeller, investmentBudget, "PUBLIC_CAPITAL", government.id);
    }
    if (isQuarterEnd(world.clock)) {
      const university = world.universities.find((item) => world.cities.find((city) => city.id === item.cityId)?.countryId === government.countryId);
      const grant = university ? Math.min(depositOf(world, government.id), Math.round(primary * (fiscal?.educationFundingBps ?? 350) / Math.max(1, (fiscal?.governmentConsumptionTargetBps ?? 1_500) + (fiscal?.publicInvestmentTargetBps ?? 300)) * 3)) : 0;
      if (university && grant > 0) settleFinancialPayment(world, government.id, university.id, government.currencyId, grant, "EDUCATION", `Финансирование образования · ${government.countryId}`);
    }
  }
}

function depreciateCapital(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const capital = company.productiveCapital;
    const depreciation = Math.min(capital.bookValueCents, Math.max(1, Math.round(capital.acquisitionCostCents / capital.usefulLifeMonths)));
    if (depreciation <= 0) continue;
    const currency = currencyForEntity(world, company.id);
    ensureAccount(world.ledger, accountIds.depreciationExpense(company.id), company.id, "Амортизация", "expense", currency);
    ensureAccount(world.ledger, accountIds.productiveCapital(company.id), company.id, "Производственный капитал", "asset", currency);
    postTransaction(world, "DEPRECIATION", `Амортизация: ${company.name}`, [
      { accountId: accountIds.depreciationExpense(company.id), side: "debit", amountCents: depreciation },
      { accountId: accountIds.productiveCapital(company.id), side: "credit", amountCents: depreciation },
    ]);
    capital.bookValueCents -= depreciation;
    capital.accumulatedDepreciationCents += depreciation;
    company.lastDepreciationCents += depreciation;
    company.lastOperatingExpenseCents += depreciation;
  }
}

function investInCapital(world: WorldState): void {
  if (!isQuarterEnd(world.clock)) return;
  for (const buyer of activeCompanies(world)) {
    const utilization = buyer.lastProductionMilliUnits / Math.max(1, buyer.capacityMilliUnits);
    const macro = world.countryMacroStates.find((state) => state.countryId === buyer.headquartersCountryId);
    const costOfCapitalBps = macro?.averageLoanRateBps ?? 1_000;
    const demandCoverage = buyer.lastSalesMilliUnits / Math.max(1, buyer.lastProductionMilliUnits);
    const cashBuffer = buyer.wageCents * Math.max(3, buyer.employees.length) * 2;
    const investmentSensitivity = world.countryCalibratedParameters[buyer.headquartersCountryId]?.investmentRateSensitivityBps ?? world.calibratedParameters.investmentRateSensitivityBps;
    const requiredUtilization = clamp(0.68 + costOfCapitalBps * investmentSensitivity / 180_000_000 + (macro?.lendingStandardsBps ?? 4_000) / 100_000, 0.72, 0.92);
    const seller = suppliersFor(world, "goods", buyer.headquartersCountryId).find((item) => item.id !== buyer.id);
    if (!seller) continue;
    const maintenanceNeed = Math.max(0, Math.round(buyer.productiveCapital.acquisitionCostCents / Math.max(1, buyer.productiveCapital.usefulLifeMonths) * 3));
    const maintenanceBudget = Math.min(maintenanceNeed, Math.max(0, depositOf(world, buyer.id) - buyer.wageCents * Math.max(2, buyer.employees.length)));
    const maintained = maintenanceBudget > 0 ? sellFinalGood(world, buyer.id, seller, maintenanceBudget, "CAPITAL", buyer.id) : 0;
    if (maintained > 0) {
      buyer.productiveCapital.acquisitionCostCents += maintained;
      buyer.productiveCapital.bookValueCents += maintained;
      buyer.lastCapitalInvestmentCents += maintained;
    }
    if (utilization < requiredUtilization || demandCoverage < 0.58) continue;
    if (depositOf(world, buyer.id) < cashBuffer && (macro?.lendingStandardsBps ?? 10_000) < 7_500) issueLoan(world, buyer.bankId, buyer.id, cashBuffer, 84, Math.round((macro?.lendingStandardsBps ?? 4_000) / 10));
    if (depositOf(world, buyer.id) < cashBuffer) continue;
    const budget = Math.min(Math.round(depositOf(world, buyer.id) * clamp(900 - costOfCapitalBps / 4, 250, 850) / 10_000), 1_200_000_00);
    const spent = sellFinalGood(world, buyer.id, seller, budget, "CAPITAL", buyer.id);
    if (spent <= 0) continue;
    buyer.productiveCapital.acquisitionCostCents += spent;
    buyer.productiveCapital.bookValueCents += spent;
    const addedCapacity = Math.max(2_000, Math.round((spent * 1_000) / goodById(world, "goods").basePriceCents * 2.5));
    buyer.productiveCapital.capacityMilliUnits += addedCapacity;
    buyer.capacityMilliUnits += addedCapacity;
    buyer.lastCapitalInvestmentCents += spent;
    emitSimpleEvent(world, "CapitalInvested", "Производственный капитал увеличен", buyer.name, [buyer.id, seller.id], "positive", [], { amountCents: spent, addedCapacityMilliUnits: addedCapacity });
  }
}

function updatePricesAndExpectations(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const previous = company.priceCents;
    const salesRatio = company.lastSalesMilliUnits / Math.max(1, company.lastProductionMilliUnits + company.inventoryMilliUnits);
    const stockRatio = company.inventoryMilliUnits / Math.max(1, company.capacityMilliUnits);
    const unitCost = company.lastSalesMilliUnits > 0 ? (company.lastCogsCents + company.lastWagesCents + company.lastDepreciationCents) * 1_000 / company.lastSalesMilliUnits : previous * 0.72;
    company.marginalCostCents = Math.max(1, Math.round(unitCost));
    const costPressureBps = clamp(Math.round((unitCost * 10_000) / Math.max(1, previous)) - 7_200, -300, 500);
    const demandPressureBps = clamp(Math.round((salesRatio - 0.45) * 1_100), -180, 280);
    const inventoryPressureBps = clamp(Math.round((0.9 - stockRatio) * 260), -220, 220);
    const adjustmentSpeed = world.countryCalibratedParameters[company.headquartersCountryId]?.priceAdjustmentSpeedBps ?? world.calibratedParameters.priceAdjustmentSpeedBps;
    const changeBps = clamp(Math.round((costPressureBps + demandPressureBps + inventoryPressureBps) * adjustmentSpeed / 1_200), -280, 420);
    company.priceCents = Math.max(Math.round(goodById(world, company.goodId).basePriceCents * 0.45), Math.round(previous * (10_000 + changeBps) / 10_000));
    if (Math.abs(company.priceCents - previous) / previous >= 0.015) emitSimpleEvent(world, "PriceChanged", "Цена изменена", company.name, [company.id], changeBps > 0 ? "attention" : "info", [], { previousPriceCents: previous, priceCents: company.priceCents, costPressureBps, demandPressureBps, inventoryPressureBps });
  }
  const latestInflation = world.metricsHistory.at(-1)?.annualInflationBps ?? world.centralBank.inflationTargetBps;
  for (const household of world.households) household.expectedInflationBps = Math.round(household.expectedInflationBps * 0.76 + latestInflation * 0.24);
  if (isQuarterEnd(world.clock)) for (const company of activeCompanies(world)) {
    const wageSpeed = world.countryCalibratedParameters[company.headquartersCountryId]?.wageAdjustmentSpeedBps ?? world.calibratedParameters.wageAdjustmentSpeedBps;
    const wageChangeBps = Math.round(clamp(Math.round((latestInflation - world.centralBank.inflationTargetBps) / 4), -100, 180) * wageSpeed / 850);
    company.wageCents = Math.max(20_000_00, Math.round(company.wageCents * (10_000 + wageChangeBps) / 10_000));
  }
}

function updateDistressAndBankruptcies(world: WorldState): void {
  for (const company of [...activeCompanies(world)]) {
    const loss = company.lastGrossRevenueCents - company.lastCogsCents - company.lastWagesCents - company.lastDepreciationCents - company.lastInterestCents - company.lastTaxCents;
    company.distressMonths = loss < 0 && depositOf(world, company.id) < company.wageCents * Math.max(2, company.employees.length) ? company.distressMonths + 1 : Math.max(0, company.distressMonths - 1);
    if (company.distressMonths < 12 && company.missedPayrollMonths < 6) continue;
    const event = emitSimpleEvent(world, "CompanyBankrupt", "Компания прекратила работу", company.name, [company.id, company.bankId], "critical", [], { lossCents: loss });
    for (const id of [...company.employees]) { const household = world.households.find((item) => item.id === id); if (household) leaveCompany(world, household, "банкротство работодателя"); }
    settleBorrowerLoansFromCash(world, company.id, [event]);
    defaultBorrowerLoans(world, company.id, [event]);
    runBankruptcyWaterfall(world, company.id);
  }
}

function collectCorporateTax(world: WorldState): void {
  if (!isYearEnd(world.clock)) return;
  for (const company of activeCompanies(world)) {
    const annualProfit = company.financialReports.slice(-11).reduce((sum, report) => sum + report.netIncomeCents, 0)
      + company.lastGrossRevenueCents - company.lastCogsCents - company.lastWagesCents - company.lastDepreciationCents - company.lastInterestCents;
    const government = governmentForCountry(world, company.headquartersCountryId);
    const complianceBps = world.politicalEconomy?.compliance.find((item) => item.countryId === company.headquartersCountryId)?.taxComplianceBps ?? 10_000;
    const tax = Math.min(depositOf(world, company.id), Math.max(0, Math.round(annualProfit * government.corporateTaxBps / 10_000 * complianceBps / 10_000)));
    const tx = tax > 0 ? transferDeposit(world, company.id, government.id, tax, "CORPORATE_TAX", `Налог на прибыль: ${company.name}`) : null;
    if (tx) { company.lastTaxCents += tax; company.lastOperatingExpenseCents += tax; }
  }
}

function foundCompanyIfNeeded(world: WorldState): void {
  if (!isQuarterEnd(world.clock) || activeCompanies(world).length >= world.fidelity.budgets.maxFullCompanies) return;
  const founder = world.households.filter((item) => item.id !== world.player.householdId).sort((a, b) => depositOf(world, b.id) - depositOf(world, a.id))[0];
  if (!founder || depositOf(world, founder.id) < 150_000_00) return;
  const good = [...world.goods].sort((a, b) => suppliersFor(world, a.id).length - suppliersFor(world, b.id).length)[0];
  const id = `company-${String(world.nextCompanyId++).padStart(3, "0")}`;
  const capital = 100_000_00;
  const countryId = world.cities.find((city) => city.id === founder.cityId)!.countryId;
  const securityId = `security-${id}`;
  const boardId = `board-${id}`;
  const company: Company = { id, name: `Новая ${good.shortName} ${world.nextCompanyId}`, goodId: good.id, ownerHouseholdId: founder.id, bankId: founder.bankId, active: true, employees: [], wageCents: founder.reservationWageCents, priceCents: good.basePriceCents, capacityMilliUnits: 80_000, productivityBps: 9_000, inventoryMilliUnits: 0, inventoryValueCents: 0, inputInventoryMilliUnits: Object.fromEntries(world.goods.map((item) => [item.id, 0])), inputInventoryValueCents: Object.fromEntries(world.goods.map((item) => [item.id, 0])), productiveCapital: { acquisitionCostCents: capital, bookValueCents: capital, accumulatedDepreciationCents: 0, usefulLifeMonths: 180, capacityMilliUnits: 80_000 }, retainedEarningsCents: 0, financialReports: [], lastProductionMilliUnits: 0, lastSalesMilliUnits: 0, lastGrossRevenueCents: 0, lastOperatingExpenseCents: 0, lastCogsCents: 0, lastIntermediateConsumptionCents: 0, lastIntermediateConsumptionBaseCents: 0, lastWagesCents: 0, lastDepreciationCents: 0, lastInterestCents: 0, lastTaxCents: 0, lastCapitalInvestmentCents: 0, lastHouseholdSalesCents: 0, lastGovernmentSalesCents: 0, distressMonths: 0, missedPayrollMonths: 0, foundedAtMonth: world.clock.elapsedMonths, closedAtMonth: null, closureReason: null, cityId: founder.cityId, productId: `product-${good.id}-${id}`, technologyBps: 8_000, managementBps: 7_500, learningByDoingBps: 0, qualityBps: 7_000, brandReputationBps: 4_000, marketShareBps: 0, marginalCostCents: Math.round(good.basePriceCents * 0.72), capacityUtilizationBps: 0, occupationFamilyNeeds: { production: 4, management: 1, sales: 1 }, headquartersCountryId: countryId, headquartersCityId: founder.cityId, industry: good.name, representationTier: "A", sizeClass: "small", corporateStatus: "private", equitySecurityId: securityId, boardId, parentCompanyId: null, subsidiaryIds: [], goodwillCents: 0, globalInputConstraintBps: 10_000 };
  company.baselineFinancials = null;
  world.companies.push(company);
  world.countries.find((country) => country.id === countryId)?.companyIds.push(id);
  world.equitySecurities.push({ id: securityId, companyId: id, className: "Обыкновенные акции", currencyId: world.countries.find((country) => country.id === countryId)!.currencyReference, sharesOutstanding: 100_000, votesPerShare: 1, status: "private" });
  world.equityHoldings.push({ id: `holding-${world.nextHoldingId++}`, securityId, ownerId: founder.id, shares: 100_000, costBasisCents: capital, dividendsReceivedCents: 0 });
  world.corporateBoards.push({ id: boardId, companyId: id, directorOwnerIds: [founder.id], approvalThresholdBps: 5_001 });
  founder.foundedCompanyIds.push(id);
  const tx = capitalContribution(world, founder.id, id, capital);
  if (!tx) {
    world.companies.pop();
    world.countries.find((country) => country.id === countryId)!.companyIds = world.countries.find((country) => country.id === countryId)!.companyIds.filter((companyId) => companyId !== id);
    world.equitySecurities = world.equitySecurities.filter((security) => security.id !== securityId);
    world.equityHoldings = world.equityHoldings.filter((holding) => holding.securityId !== securityId);
    world.corporateBoards = world.corporateBoards.filter((board) => board.id !== boardId);
    founder.foundedCompanyIds.pop();
    return;
  }
  const supplier = suppliersFor(world, "goods", countryId).find((item) => item.id !== id);
  const invested = supplier ? sellFinalGood(world, id, supplier, Math.round(capital * 0.8), "CAPITAL", id) : 0;
  company.productiveCapital.acquisitionCostCents = invested;
  company.productiveCapital.bookValueCents = invested;
  company.lastCapitalInvestmentCents = invested;
  emitSimpleEvent(world, "CompanyFounded", "Зарегистрирована компания", company.name, [founder.id, company.id], "positive", [tx]);
}

export function runMonthlyMarketEcology(world: WorldState): void {
  let phaseStarted = startSimulationPhaseTiming();
  runMarketMakers(world);
  finishSimulationPhaseTiming("Market Makers", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  runCrossVenueArbitrage(world);
  finishSimulationPhaseTiming("Cross-Venue Arbitrage", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  runAutonomousTriangularFxArbitrage(world);
  finishSimulationPhaseTiming("Triangular FX Arbitrage", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  runEtfArbitrage(world);
  finishSimulationPhaseTiming("ETF Arbitrage", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  runHeterogeneousMarketAgents(world);
  finishSimulationPhaseTiming("Heterogeneous Market Agents", phaseStarted);
}

export function stepMonth(world: WorldState): void {
  const monthStarted = beginSimulationMonthTiming(world.clock.elapsedMonths);
  runInformationMonth(world);
  for (const company of world.companies) resetCompanyPeriod(company);
  openCountryEconomicPeriods(world);
  runConflictPreEconomy(world);
  checkLongRunStage(world, "pre-conflict");
  let phaseStarted = startSimulationPhaseTiming();
  prepareGovernmentCommitments(world);
  finishSimulationPhaseTiming("Government", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  serviceLoans(world);
  runBankAlm(world);
  finishSimulationPhaseTiming("Banks", phaseStarted);
  serviceCorporateBonds(world);
  phaseStarted = startSimulationPhaseTiming();
  runCompanyDecisionCycle(world);
  finishSimulationPhaseTiming("Corporate Decisions", phaseStarted);
  runLabourMarket(world);
  payWagesAndTaxes(world);
  paySocialTransfers(world);
  runPoliticalEconomyMonth(world);
  updateAggregateEconomies(world);
  procureInputs(world);
  produceGoods(world);
  checkLongRunStage(world, "production");
  runGeoeconomicMonth(world);
  phaseStarted = startSimulationPhaseTiming();
  runGlobalEconomyMonth(world);
  finishSimulationPhaseTiming("Trade", phaseStarted);
  // FX settlement is part of the global trade clearing call. Recording the
  // same boundary under FX makes its inclusive cost visible in developer
  // timing without splitting the causal settlement transaction.
  finishSimulationPhaseTiming("FX", phaseStarted);
  checkLongRunStage(world, "trade");
  clearHouseholdMarket(world);
  governmentPurchases(world);
  runDefenseEconomyMonth(world);
  phaseStarted = startSimulationPhaseTiming();
  serviceSovereignDebt(world);
  finishSimulationPhaseTiming("Sovereign Debt", phaseStarted);
  depreciateCapital(world);
  investInCapital(world);
  updatePricesAndExpectations(world);
  updateDistressAndBankruptcies(world);
  collectCorporateTax(world);
  phaseStarted = startSimulationPhaseTiming();
  runInstitutionalFinance(world);
  processFundRedemptions(world);
  finishSimulationPhaseTiming("Fund Rebalancing", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  runInsuranceMonth(world);
  finishSimulationPhaseTiming("Insurance", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  for (const deal of activeMAndADeals(world)) advanceMAndA(world, deal.id);
  for (const ipo of activeIpoProcesses(world)) advanceIPO(world, ipo.id);
  runMAndAIntegration(world);
  runPrivateEquityMonth(world);
  finishSimulationPhaseTiming("PE/M&A/IPO", phaseStarted);
  // Market liquidity and no-arbitrage links are monthly infrastructure. Strategic
  // portfolio styles remain quarterly so they do not dominate the macro timestep.
  runMonthlyMarketEcology(world);
  if (isQuarterEnd(world.clock)) {
    runMarketAgents(world);
    phaseStarted = startSimulationPhaseTiming();
    evaluateCashAndCarry(world, world.funds.find((item) => item.type === "hedge")?.id ?? world.player.householdId);
    finishSimulationPhaseTiming("Cash-and-Carry", phaseStarted);
  }
  for (const fund of world.funds) calculateFundNav(world, fund.id);
  processMarginRisk(world);
  processDerivativeMonth(world);
  runAutonomousDerivativeDecisions(world);
  checkLongRunStage(world, "finance");
  runConflictPostEconomy(world);
  captureEconomicExplanations(world);
  checkLongRunStage(world, "post-conflict");
  foundCompanyIfNeeded(world);
  recognizeMonthlySalesCosts(world);
  runMacroeconomicMonth(world);
  closeCountryEconomicPeriods(world);
  const metric = collectMetrics(world);
  world.metricsHistory.push(metric);
  world.countryMetricsHistory.push(...collectCountryMetrics(world));
  recordPlayerMonth(world);
  progressPlayerWorld(world);
  if (world.clock.elapsedMonths % 3 === 0) syncPlayerProgression(world);
  phaseStarted = startSimulationPhaseTiming();
  closeMonthlyAccounting(world);
  finishSimulationPhaseTiming("Accounting Close", phaseStarted);
  checkLongRunStage(world, "month-close");
  emitSimpleEvent(world, "MonthClosed", "Месяц закрыт", formatSimulationDate(world.clock), [], "info", [], { nominalGdpCents: metric.nominalGdpCents, annualInflationBps: metric.annualInflationBps, unemploymentBps: metric.unemploymentBps });
  world.clock.elapsedMonths += 1;
  collectLongRunDiagnostics(world);
  migratePopulationCohorts(world);
  phaseStarted = startSimulationPhaseTiming();
  compactLedgerHistory(world);
  finishSimulationPhaseTiming("History Compaction", phaseStarted);
  phaseStarted = startSimulationPhaseTiming();
  updateWorldDiagnostics(world);
  finishSimulationPhaseTiming("Serialization/save preparation", phaseStarted);
  // The month-scoped ledger indexes are constructed lazily inside consumers;
  // their inclusive time is currently represented by the measured accounting
  // and system phases. Keep the explicit slot in every developer record.
  phaseStarted = startSimulationPhaseTiming();
  finishSimulationPhaseTiming("Ledger Indexing", phaseStarted);
  finishSimulationMonthTiming(monthStarted);
}

export function runMonths(world: WorldState, months: number): void {
  for (let index = 0; index < months; index += 1) stepMonth(world);
}
