import { beginNationalAccountingMonth } from "../accounting/national-accounts.ts";
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
import { collectMetrics } from "./metrics.ts";

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
      const candidateIndex = unemployed.findIndex((household) => employer.company.wageCents >= household.reservationWageCents);
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
      const tax = Math.round((company.wageCents * world.government.incomeTaxBps) / 10_000);
      transferDeposit(world, household.id, world.government.id, tax, "INCOME_TAX", `Налог на доход: ${household.displayName}`, [wageTx]);
    }
  }
}

function paySocialTransfers(world: WorldState): void {
  for (const household of world.households) {
    if (household.employerId || household.monthsUnemployed < 1) continue;
    const amount = world.government.monthlyUnemploymentBenefitCents;
    if (depositOf(world, world.government.id) < amount) break;
    transferDeposit(world, world.government.id, household.id, amount, "SOCIAL_TRANSFER", `Пособие: ${household.displayName}`);
  }
}

function suppliersFor(world: WorldState, goodId: string): Company[] {
  return activeCompanies(world).filter((company) => company.goodId === goodId && company.inventoryMilliUnits > 0).sort((left, right) => left.priceCents - right.priceCents || left.id.localeCompare(right.id));
}

function consumeSellerInventory(world: WorldState, seller: Company, quantity: number, reason: "INPUT" | "CONSUMPTION" | "CAPITAL", destinationId: string, causeIds: string[]): number {
  quantity = Math.min(quantity, seller.inventoryMilliUnits);
  if (quantity <= 0) return 0;
  const value = seller.inventoryMilliUnits > 0 ? Math.min(seller.inventoryValueCents, Math.round((seller.inventoryValueCents * quantity) / seller.inventoryMilliUnits)) : 0;
  if (value > 0) {
    ensureAccount(world.ledger, accountIds.cogsExpense(seller.id), seller.id, "Себестоимость продаж", "expense");
    ensureAccount(world.ledger, accountIds.finishedInventory(seller.id), seller.id, "Готовая продукция", "asset");
    postTransaction(world, "COGS", `Себестоимость: ${seller.name}`, [
      { accountId: accountIds.cogsExpense(seller.id), side: "debit", amountCents: value },
      { accountId: accountIds.finishedInventory(seller.id), side: "credit", amountCents: value },
    ], causeIds);
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
      for (const seller of suppliersFor(world, inputId)) {
        if (need <= 0 || depositOf(world, buyer.id) < seller.priceCents) break;
        const quantity = Math.min(need, seller.inventoryMilliUnits, Math.floor((depositOf(world, buyer.id) * 1_000) / seller.priceCents));
        const cost = Math.floor((quantity * seller.priceCents) / 1_000);
        if (quantity <= 0 || cost <= 0) continue;
        const inputAccount = accountIds.inputInventory(buyer.id, inputId);
        ensureAccount(world.ledger, inputAccount, buyer.id, `Сырьё: ${goodById(world, inputId).name}`, "asset");
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
    let output = Math.min(company.capacityMilliUnits, Math.round((company.employees.length * 48_000 * company.productivityBps) / 10_000));
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
      ensureAccount(world.ledger, accountIds.finishedInventory(company.id), company.id, "Готовая продукция", "asset");
      postTransaction(world, "PRODUCTION", `Выпуск: ${company.name}`, [{ accountId: accountIds.finishedInventory(company.id), side: "debit", amountCents: consumedValue }, ...credits]);
      company.inventoryValueCents += consumedValue;
    }
    company.inventoryMilliUnits += output;
    company.lastProductionMilliUnits = output;
    recordGoodsMovement(world, { goodId: company.goodId, fromId: company.id, toId: company.id, quantityMilliUnits: output, reason: "PRODUCTION", causeIds: [] });
  }
}

function householdBudget(world: WorldState, household: Household): number {
  const cash = depositOf(world, household.id);
  const monthlyIncome = household.employerId ? companyById(world, household.employerId)?.wageCents ?? 0 : world.government.monthlyUnemploymentBenefitCents;
  const desiredReserve = Math.round(monthlyIncome * (1.2 + household.liquidityPreferenceBps / 5_000));
  const spendableStock = Math.max(0, cash - desiredReserve);
  const propensity = household.id === world.player.householdId ? world.player.consumptionBudgetBps : household.consumptionPropensityBps;
  const expectedInflationEffect = clamp(10_000 + household.expectedInflationBps * 0.3, 9_000, 11_500);
  return Math.min(Math.round(cash * 0.22), Math.round(((monthlyIncome * propensity) / 10_000 + spendableStock * 0.06) * expectedInflationEffect / 10_000));
}

function chooseSeller(world: WorldState, household: Household, goodId: string): Company | undefined {
  const suppliers = suppliersFor(world, goodId);
  if (!suppliers.length) return undefined;
  const preferred = household.preferredSellerByGoodId[goodId];
  return [...suppliers].sort((left, right) => {
    const leftLoyalty = left.id === preferred ? 900 : 0;
    const rightLoyalty = right.id === preferred ? 900 : 0;
    const leftScore = Math.round((left.priceCents * household.priceSensitivityBps) / 10_000) - leftLoyalty + Math.round((left.inventoryMilliUnits / Math.max(1, left.capacityMilliUnits)) * -100);
    const rightScore = Math.round((right.priceCents * household.priceSensitivityBps) / 10_000) - rightLoyalty + Math.round((right.inventoryMilliUnits / Math.max(1, right.capacityMilliUnits)) * -100);
    return leftScore - rightScore || left.id.localeCompare(right.id);
  })[0];
}

function sellFinalGood(world: WorldState, payerId: string, seller: Company, budget: number, reason: "CONSUMPTION" | "CAPITAL", destinationId: string): number {
  const quantity = Math.min(seller.inventoryMilliUnits, Math.floor((budget * 1_000) / Math.max(1, seller.priceCents)));
  const gross = Math.floor((quantity * seller.priceCents) / 1_000);
  if (quantity <= 0 || gross <= 0) return 0;
  const kind = reason === "CAPITAL" ? "CAPITAL_INVESTMENT" : "GOODS_CLEARING";
  const payerAccount = reason === "CAPITAL" ? accountIds.productiveCapital(payerId) : accountIds.operatingExpense(payerId);
  ensureAccount(world.ledger, payerAccount, payerId, reason === "CAPITAL" ? "Производственный капитал" : "Потребление", reason === "CAPITAL" ? "asset" : "expense");
  const destinationName = world.households.find((item) => item.id === destinationId)?.displayName
    ?? world.companies.find((item) => item.id === destinationId)?.name
    ?? (destinationId === world.government.id ? "Правительство" : destinationId);
  const tx = settleDepositPayment(world, payerId, seller.id, gross, kind, `${destinationName} ← ${seller.name}`, payerAccount, accountIds.operatingIncome(seller.id));
  if (!tx) return 0;
  const moved = consumeSellerInventory(world, seller, quantity, reason, destinationId, [tx]);
  seller.lastGrossRevenueCents += gross;
  if (payerId === world.government.id) seller.lastGovernmentSalesCents += gross;
  else if (reason === "CONSUMPTION") seller.lastHouseholdSalesCents += gross;
  const salesTax = Math.min(depositOf(world, seller.id), Math.round((gross * world.government.salesTaxBps) / 10_000));
  if (salesTax > 0) {
    const taxTx = transferDeposit(world, seller.id, world.government.id, salesTax, "SALES_TAX", `Налог с продаж: ${seller.name}`, [tx]);
    if (taxTx) { seller.lastTaxCents += salesTax; seller.lastOperatingExpenseCents += salesTax; }
  }
  return moved > 0 ? gross : 0;
}

function clearHouseholdMarket(world: WorldState): void {
  for (const household of world.households) {
    const totalBudget = householdBudget(world, household);
    if (totalBudget <= 0) continue;
    for (const good of world.goods) {
      let budget = Math.round((totalBudget * (household.preferenceWeightsBps[good.id] ?? good.consumptionWeightBps)) / 10_000);
      if (good.essential) budget = Math.max(budget, Math.round((totalBudget * household.essentialBudgetBps * good.consumptionWeightBps) / 100_000_000));
      budget = Math.min(budget, depositOf(world, household.id));
      const seller = chooseSeller(world, household, good.id);
      if (!seller || budget <= 0) continue;
      const before = seller.lastSalesMilliUnits;
      const spent = sellFinalGood(world, household.id, seller, budget, "CONSUMPTION", household.id);
      const quantity = seller.lastSalesMilliUnits - before;
      if (spent > 0) {
        household.consumptionMilliUnits[good.id] = (household.consumptionMilliUnits[good.id] ?? 0) + quantity;
        household.preferredSellerByGoodId[good.id] = seller.id;
        world.nationalAccounts.current.householdConsumptionCents += spent;
        world.nationalAccounts.current.householdConsumptionByGoodCents[good.id] += spent;
      }
    }
  }
}

function governmentPurchases(world: WorldState): void {
  const budget = Math.min(depositOf(world, world.government.id) / 80, 1_800_000_00);
  for (const goodId of ["services", "goods"] as const) {
    const seller = suppliersFor(world, goodId)[0];
    if (!seller) continue;
    const spent = sellFinalGood(world, world.government.id, seller, Math.floor(budget / 2), "CONSUMPTION", world.government.id);
    world.nationalAccounts.current.governmentConsumptionCents += spent;
    world.nationalAccounts.current.governmentConsumptionByGoodCents[goodId] += spent;
  }
}

function depreciateCapital(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const capital = company.productiveCapital;
    const depreciation = Math.min(capital.bookValueCents, Math.max(1, Math.round(capital.acquisitionCostCents / capital.usefulLifeMonths)));
    if (depreciation <= 0) continue;
    ensureAccount(world.ledger, accountIds.depreciationExpense(company.id), company.id, "Амортизация", "expense");
    ensureAccount(world.ledger, accountIds.productiveCapital(company.id), company.id, "Производственный капитал", "asset");
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
    const cashBuffer = buyer.wageCents * Math.max(3, buyer.employees.length) * 2;
    if (utilization < 0.78 || depositOf(world, buyer.id) < cashBuffer) continue;
    const seller = suppliersFor(world, "goods").find((item) => item.id !== buyer.id);
    if (!seller) continue;
    const budget = Math.min(Math.round(depositOf(world, buyer.id) * 0.06), 1_200_000_00);
    const spent = sellFinalGood(world, buyer.id, seller, budget, "CAPITAL", buyer.id);
    if (spent <= 0) continue;
    buyer.productiveCapital.acquisitionCostCents += spent;
    buyer.productiveCapital.bookValueCents += spent;
    const addedCapacity = Math.max(2_000, Math.round((spent * 1_000) / goodById(world, "goods").basePriceCents * 2.5));
    buyer.productiveCapital.capacityMilliUnits += addedCapacity;
    buyer.capacityMilliUnits += addedCapacity;
    buyer.lastCapitalInvestmentCents += spent;
    world.nationalAccounts.current.capitalFormationCents += spent;
    emitSimpleEvent(world, "CapitalInvested", "Производственный капитал увеличен", buyer.name, [buyer.id, seller.id], "positive", [], { amountCents: spent, addedCapacityMilliUnits: addedCapacity });
  }
}

function updatePricesAndExpectations(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const previous = company.priceCents;
    const salesRatio = company.lastSalesMilliUnits / Math.max(1, company.lastProductionMilliUnits + company.inventoryMilliUnits);
    const stockRatio = company.inventoryMilliUnits / Math.max(1, company.capacityMilliUnits);
    const unitCost = company.lastSalesMilliUnits > 0 ? (company.lastCogsCents + company.lastWagesCents + company.lastDepreciationCents) * 1_000 / company.lastSalesMilliUnits : previous * 0.72;
    const costPressureBps = clamp(Math.round((unitCost * 10_000) / Math.max(1, previous)) - 7_200, -300, 500);
    const demandPressureBps = clamp(Math.round((salesRatio - 0.45) * 1_100), -180, 280);
    const inventoryPressureBps = clamp(Math.round((0.9 - stockRatio) * 260), -220, 220);
    const changeBps = clamp(costPressureBps + demandPressureBps + inventoryPressureBps, -280, 420);
    company.priceCents = Math.max(Math.round(goodById(world, company.goodId).basePriceCents * 0.45), Math.round(previous * (10_000 + changeBps) / 10_000));
    if (Math.abs(company.priceCents - previous) / previous >= 0.015) emitSimpleEvent(world, "PriceChanged", "Цена изменена", company.name, [company.id], changeBps > 0 ? "attention" : "info", [], { previousPriceCents: previous, priceCents: company.priceCents, costPressureBps, demandPressureBps, inventoryPressureBps });
  }
  const latestInflation = world.metricsHistory.at(-1)?.annualInflationBps ?? world.centralBank.inflationTargetBps;
  for (const household of world.households) household.expectedInflationBps = Math.round(household.expectedInflationBps * 0.76 + latestInflation * 0.24);
  if (isQuarterEnd(world.clock)) for (const company of activeCompanies(world)) company.wageCents = Math.max(20_000_00, Math.round(company.wageCents * (10_000 + clamp(Math.round((latestInflation - world.centralBank.inflationTargetBps) / 4), -100, 180)) / 10_000));
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
    company.active = false;
    company.closedAtMonth = world.clock.elapsedMonths;
    company.closureReason = "Недостаток ликвидности и устойчивая убыточность";
  }
}

function collectCorporateTax(world: WorldState): void {
  if (!isYearEnd(world.clock)) return;
  for (const company of activeCompanies(world)) {
    const annualProfit = company.financialReports.slice(-11).reduce((sum, report) => sum + report.netIncomeCents, 0)
      + company.lastGrossRevenueCents - company.lastCogsCents - company.lastWagesCents - company.lastDepreciationCents - company.lastInterestCents;
    const tax = Math.min(depositOf(world, company.id), Math.max(0, Math.round(annualProfit * world.government.corporateTaxBps / 10_000)));
    const tx = tax > 0 ? transferDeposit(world, company.id, world.government.id, tax, "CORPORATE_TAX", `Налог на прибыль: ${company.name}`) : null;
    if (tx) { company.lastTaxCents += tax; company.lastOperatingExpenseCents += tax; }
  }
}

function updateCentralBankPolicy(world: WorldState): void {
  if (!isQuarterEnd(world.clock)) return;
  const inflation = world.metricsHistory.at(-1)?.annualInflationBps ?? world.centralBank.inflationTargetBps;
  const oldRate = world.centralBank.policyRateBps;
  const newRate = clamp(oldRate + clamp(Math.round((inflation - world.centralBank.inflationTargetBps) * 0.18), -100, 125), 200, 2_500);
  if (newRate === oldRate) return;
  world.centralBank.policyRateBps = newRate;
  world.centralBank.policyRateHistory.push({ elapsedMonth: world.clock.elapsedMonths, rateBps: newRate });
  emitSimpleEvent(world, "InterestRateChanged", "Ключевая ставка изменена", `${(oldRate / 100).toFixed(2)}% → ${(newRate / 100).toFixed(2)}%`, [world.centralBank.id], "attention", [], { oldRateBps: oldRate, newRateBps: newRate, inflationBps: inflation });
}

function foundCompanyIfNeeded(world: WorldState): void {
  if (!isYearEnd(world.clock) || activeCompanies(world).length > 10) return;
  const founder = world.households.filter((item) => item.id !== world.player.householdId).sort((a, b) => depositOf(world, b.id) - depositOf(world, a.id))[0];
  if (!founder || depositOf(world, founder.id) < 150_000_00) return;
  const good = [...world.goods].sort((a, b) => suppliersFor(world, a.id).length - suppliersFor(world, b.id).length)[0];
  const id = `company-${String(world.nextCompanyId++).padStart(3, "0")}`;
  const capital = 100_000_00;
  const company: Company = { id, name: `Новая ${good.shortName} ${world.nextCompanyId}`, goodId: good.id, ownerHouseholdId: founder.id, bankId: founder.bankId, active: true, employees: [], wageCents: founder.reservationWageCents, priceCents: good.basePriceCents, capacityMilliUnits: 80_000, productivityBps: 9_000, inventoryMilliUnits: 0, inventoryValueCents: 0, inputInventoryMilliUnits: Object.fromEntries(world.goods.map((item) => [item.id, 0])), inputInventoryValueCents: Object.fromEntries(world.goods.map((item) => [item.id, 0])), productiveCapital: { acquisitionCostCents: capital, bookValueCents: capital, accumulatedDepreciationCents: 0, usefulLifeMonths: 180, capacityMilliUnits: 80_000 }, retainedEarningsCents: 0, financialReports: [], lastProductionMilliUnits: 0, lastSalesMilliUnits: 0, lastGrossRevenueCents: 0, lastOperatingExpenseCents: 0, lastCogsCents: 0, lastIntermediateConsumptionCents: 0, lastIntermediateConsumptionBaseCents: 0, lastWagesCents: 0, lastDepreciationCents: 0, lastInterestCents: 0, lastTaxCents: 0, lastCapitalInvestmentCents: 0, lastHouseholdSalesCents: 0, lastGovernmentSalesCents: 0, distressMonths: 0, missedPayrollMonths: 0, foundedAtMonth: world.clock.elapsedMonths, closedAtMonth: null, closureReason: null };
  world.companies.push(company);
  founder.foundedCompanyIds.push(id);
  const tx = capitalContribution(world, founder.id, id, capital);
  if (!tx) { world.companies.pop(); founder.foundedCompanyIds.pop(); return; }
  const supplier = suppliersFor(world, "goods").find((item) => item.id !== id);
  const invested = supplier ? sellFinalGood(world, id, supplier, Math.round(capital * 0.8), "CAPITAL", id) : 0;
  company.productiveCapital.acquisitionCostCents = invested;
  company.productiveCapital.bookValueCents = invested;
  company.lastCapitalInvestmentCents = invested;
  world.nationalAccounts.current.capitalFormationCents += invested;
  emitSimpleEvent(world, "CompanyFounded", "Зарегистрирована компания", company.name, [founder.id, company.id], "positive", [tx]);
}

export function stepMonth(world: WorldState): void {
  for (const company of world.companies) resetCompanyPeriod(company);
  beginNationalAccountingMonth(world);
  serviceLoans(world);
  runLabourMarket(world);
  payWagesAndTaxes(world);
  paySocialTransfers(world);
  procureInputs(world);
  produceGoods(world);
  clearHouseholdMarket(world);
  governmentPurchases(world);
  depreciateCapital(world);
  investInCapital(world);
  updatePricesAndExpectations(world);
  updateDistressAndBankruptcies(world);
  collectCorporateTax(world);
  foundCompanyIfNeeded(world);
  const metric = collectMetrics(world);
  world.metricsHistory.push(metric);
  recordPlayerMonth(world);
  closeMonthlyAccounting(world);
  updateCentralBankPolicy(world);
  emitSimpleEvent(world, "MonthClosed", "Месяц закрыт", formatSimulationDate(world.clock), [], "info", [], { nominalGdpCents: metric.nominalGdpCents, annualInflationBps: metric.annualInflationBps, unemploymentBps: metric.unemploymentBps });
  world.clock.elapsedMonths += 1;
}

export function runMonths(world: WorldState, months: number): void {
  for (let index = 0; index < months; index += 1) stepMonth(world);
}
