import { currentDate, isQuarterEnd, isYearEnd } from "../core/clock.ts";
import { emitSimpleEvent, recordGoodsMovement } from "../core/events.ts";
import {
  capitalContribution,
  depositOf,
  transferDeposit,
} from "../core/ledger.ts";
import type {
  Company,
  GoodDefinition,
  Household,
  WorldState,
} from "../domain/model.ts";
import {
  defaultBorrowerLoans,
  issueLoan,
  settleBorrowerLoansFromCash,
  serviceLoans,
} from "../finance/credit.ts";
import { collectMetrics } from "./metrics.ts";

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

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

function resetMonthlyCompanyState(world: WorldState): void {
  for (const company of world.companies) {
    company.lastProductionMilliUnits = 0;
    company.lastSalesMilliUnits = 0;
    company.lastGrossRevenueCents = 0;
    company.lastOperatingExpenseCents = 0;
  }
}

function leaveCompany(world: WorldState, household: Household, reason: string): void {
  if (!household.employerId) return;
  const employer = companyById(world, household.employerId);
  if (employer) {
    employer.employees = employer.employees.filter((id) => id !== household.id);
  }
  const formerEmployerId = household.employerId;
  household.employerId = null;
  household.monthsUnemployed = 0;
  emitSimpleEvent(
    world,
    "EmployeeLeft",
    "Рабочее место закрыто",
    `${household.displayName}: ${reason}.`,
    [household.id, formerEmployerId],
    "attention",
  );
}

function runLabourMarket(world: WorldState): void {
  for (const household of world.households) {
    if (!household.employerId) household.monthsUnemployed += 1;
  }

  if (isQuarterEnd(world.clock)) {
    for (const company of activeCompanies(world)) {
      const inventoryPressure = company.inventoryMilliUnits / Math.max(1, company.capacityMilliUnits);
      if ((company.distressMonths >= 2 || inventoryPressure > 2.4) && company.employees.length > 3) {
        const workerId = [...company.employees].sort((leftId, rightId) => {
          const left = world.households.find((item) => item.id === leftId)!;
          const right = world.households.find((item) => item.id === rightId)!;
          return left.productivityBps - right.productivityBps;
        })[0];
        const worker = world.households.find((item) => item.id === workerId)!;
        leaveCompany(world, worker, `${company.name} сократила штат из-за давления на ликвидность или запасов`);
      }
    }
  }

  const unemployed = world.households
    .filter((household) => !household.employerId)
    .sort(
      (left, right) =>
        right.monthsUnemployed - left.monthsUnemployed ||
        right.skillBps + right.productivityBps - (left.skillBps + left.productivityBps),
    );
  const employers = activeCompanies(world)
    .filter((company) => company.distressMonths < 2)
    .map((company) => {
      const desiredEmployees = clamp(
        Math.ceil((company.capacityMilliUnits / 1_000) * (10_000 / company.productivityBps) / 45),
        4,
        12,
      );
      return { company, vacancies: Math.max(0, desiredEmployees - company.employees.length) };
    })
    .filter((item) => item.vacancies > 0)
    .sort((left, right) => right.company.wageCents - left.company.wageCents);

  for (const employer of employers) {
    while (employer.vacancies > 0) {
      const candidateIndex = unemployed.findIndex(
        (household) => employer.company.wageCents >= household.reservationWageCents,
      );
      if (candidateIndex < 0) break;
      const household = unemployed.splice(candidateIndex, 1)[0];
      household.employerId = employer.company.id;
      household.monthsUnemployed = 0;
      employer.company.employees.push(household.id);
      employer.vacancies -= 1;
      emitSimpleEvent(
        world,
        "EmployeeHired",
        "Заключён трудовой договор",
        `${employer.company.name} наняла ${household.displayName} за ${(employer.company.wageCents / 100).toLocaleString("ru-RU")} ₽ в месяц.`,
        [employer.company.id, household.id],
        "positive",
      );
    }
  }
}

function companyDebt(world: WorldState, companyId: string): number {
  return world.loans
    .filter((loan) => loan.borrowerId === companyId && loan.status === "active")
    .reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
}

function fundPayrollIfNeeded(world: WorldState, company: Company, payrollCents: number): void {
  const deposit = depositOf(world, company.id);
  const liquidityTarget = Math.round(payrollCents * 1.35);
  if (deposit >= liquidityTarget || payrollCents === 0) return;
  const revenueCapacity = Math.max(
    company.lastGrossRevenueCents * 6,
    company.capacityMilliUnits * Math.max(1, company.priceCents) * 3,
  );
  const existingDebt = companyDebt(world, company.id);
  if (existingDebt > 0) return;
  if (existingDebt > revenueCapacity * 0.9) return;
  const request = clamp(liquidityTarget - deposit + payrollCents * 2, 200_000_00, 2_500_000_00);
  issueLoan(
    world,
    company.bankId,
    company.id,
    request,
    60,
    clamp(1_000 - Math.floor(company.productivityBps / 20), 250, 850),
  );
}

function payWagesAndTaxes(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const payrollCents = company.wageCents * company.employees.length;
    fundPayrollIfNeeded(world, company, payrollCents);
    if (depositOf(world, company.id) < payrollCents) {
      company.missedPayrollMonths += 1;
      emitSimpleEvent(
        world,
        "CompanyDistressed",
        "Фирме не хватает ликвидности",
        `${company.name} не может полностью профинансировать фонд оплаты труда.`,
        [company.id, company.bankId],
        company.missedPayrollMonths >= 2 ? "critical" : "attention",
        [],
        { payrollCents, depositCents: depositOf(world, company.id) },
      );
      continue;
    }
    company.missedPayrollMonths = 0;
    for (const householdId of [...company.employees]) {
      const household = world.households.find((item) => item.id === householdId);
      if (!household) continue;
      const wageTxId = transferDeposit(
        world,
        company.id,
        household.id,
        company.wageCents,
        "WAGE",
        `Зарплата: ${company.name} → ${household.displayName}`,
      );
      if (!wageTxId) continue;
      company.lastOperatingExpenseCents += company.wageCents;
      const taxCents = Math.round((company.wageCents * world.government.incomeTaxBps) / 10_000);
      transferDeposit(
        world,
        household.id,
        world.government.id,
        taxCents,
        "INCOME_TAX",
        `НДФЛ: ${household.displayName}`,
        [wageTxId],
      );
    }
  }
}

function paySocialTransfers(world: WorldState): void {
  for (const household of world.households) {
    if (household.employerId || household.monthsUnemployed < 1) continue;
    if (depositOf(world, world.government.id) < world.government.monthlyUnemploymentBenefitCents) break;
    transferDeposit(
      world,
      world.government.id,
      household.id,
      world.government.monthlyUnemploymentBenefitCents,
      "SOCIAL_TRANSFER",
      `Пособие по безработице: ${household.displayName}`,
    );
  }
}

function averageMarketPrice(world: WorldState, goodId: string): number {
  const suppliers = activeCompanies(world).filter((company) => company.goodId === goodId);
  if (suppliers.length === 0) return goodById(world, goodId).basePriceCents;
  return Math.round(
    suppliers.reduce((sum, supplier) => sum + supplier.priceCents, 0) / suppliers.length,
  );
}

function procureInputs(world: WorldState, outputGoodIds: string[]): void {
  for (const buyer of activeCompanies(world).filter((company) => outputGoodIds.includes(company.goodId))) {
    const good = goodById(world, buyer.goodId);
    for (const [inputId, ratio] of Object.entries(good.recipe)) {
      const targetInput = Math.ceil(buyer.capacityMilliUnits * ratio * 1.4);
      let needed = Math.max(0, targetInput - (buyer.inputInventoryMilliUnits[inputId] ?? 0));
      const suppliers = activeCompanies(world)
        .filter((company) => company.goodId === inputId && company.id !== buyer.id)
        .sort((left, right) => left.priceCents - right.priceCents || left.id.localeCompare(right.id));
      for (const supplier of suppliers) {
        if (needed <= 0 || supplier.inventoryMilliUnits <= 0) break;
        const payrollBuffer = buyer.wageCents * buyer.employees.length * 2;
        const procurementCash = Math.max(0, depositOf(world, buyer.id) - payrollBuffer);
        const affordableMilliUnits = Math.floor(
          (procurementCash * 1_000) / Math.max(1, supplier.priceCents),
        );
        const quantity = Math.min(needed, supplier.inventoryMilliUnits, affordableMilliUnits);
        const amountCents = Math.floor((quantity * supplier.priceCents) / 1_000);
        if (quantity <= 0 || amountCents <= 0) continue;
        const txId = transferDeposit(
          world,
          buyer.id,
          supplier.id,
          amountCents,
          "INPUT_PURCHASE",
          `${buyer.name} закупает ${goodById(world, inputId).shortName} у ${supplier.name}`,
        );
        if (!txId) break;
        buyer.inputInventoryMilliUnits[inputId] =
          (buyer.inputInventoryMilliUnits[inputId] ?? 0) + quantity;
        supplier.inventoryMilliUnits -= quantity;
        supplier.lastSalesMilliUnits += quantity;
        supplier.lastGrossRevenueCents += amountCents;
        buyer.lastOperatingExpenseCents += amountCents;
        needed -= quantity;
        recordGoodsMovement(world, {
          goodId: inputId,
          fromId: supplier.id,
          toId: buyer.id,
          quantityMilliUnits: quantity,
          reason: "INPUT",
          causeIds: [txId],
        });
      }
    }
  }
}

function produceGoods(world: WorldState, goodIds: string[]): void {
  for (const company of activeCompanies(world).filter((item) => goodIds.includes(item.goodId))) {
    const good = goodById(world, company.goodId);
    const laborFactorBps = clamp(Math.round((company.employees.length * 10_000) / 8), 0, 11_500);
    let possibleOutput = Math.floor(
      (company.capacityMilliUnits * company.productivityBps * laborFactorBps) / 100_000_000,
    );
    const targetInventory = Math.max(
      Math.floor(company.capacityMilliUnits * 0.7),
      Math.floor(company.lastSalesMilliUnits * 1.45),
    );
    const desiredOutput = Math.max(
      Math.floor(company.capacityMilliUnits * 0.18),
      targetInventory - company.inventoryMilliUnits,
    );
    possibleOutput = Math.min(possibleOutput, Math.max(0, desiredOutput));
    for (const [inputId, ratio] of Object.entries(good.recipe)) {
      const available = company.inputInventoryMilliUnits[inputId] ?? 0;
      possibleOutput = Math.min(possibleOutput, Math.floor(available / ratio));
    }
    const output = Math.max(0, possibleOutput);
    if (output <= 0) continue;
    for (const [inputId, ratio] of Object.entries(good.recipe)) {
      const used = Math.min(
        company.inputInventoryMilliUnits[inputId] ?? 0,
        Math.ceil(output * ratio),
      );
      company.inputInventoryMilliUnits[inputId] -= used;
      if (used > 0) {
        recordGoodsMovement(world, {
          goodId: inputId,
          fromId: company.id,
          toId: `production:${company.id}`,
          quantityMilliUnits: used,
          reason: "INPUT",
          causeIds: [],
        });
      }
    }
    company.inventoryMilliUnits += output;
    company.lastProductionMilliUnits = output;
    recordGoodsMovement(world, {
      goodId: company.goodId,
      fromId: `production:${company.id}`,
      toId: company.id,
      quantityMilliUnits: output,
      reason: "PRODUCTION",
      causeIds: [],
    });
  }
}

interface HouseholdBudget {
  household: Household;
  cents: number;
}

function householdBudgets(world: WorldState): HouseholdBudget[] {
  return world.households.map((household) => {
    const employer = household.employerId ? companyById(world, household.employerId) : undefined;
    const grossIncome = employer?.wageCents ?? world.government.monthlyUnemploymentBenefitCents;
    const disposableIncome = Math.floor(
      (grossIncome * (10_000 - world.government.incomeTaxBps)) / 10_000,
    );
    const regular = Math.floor((disposableIncome * household.consumptionPropensityBps) / 10_000);
    const savingsDraw = Math.max(0, depositOf(world, household.id) - 80_000_00);
    const desired = Math.max(9_500_00, regular + Math.floor(savingsDraw * 0.012));
    return {
      household,
      cents: Math.max(0, Math.min(desired, depositOf(world, household.id))),
    };
  });
}

function allocateIntegerTotal(total: number, weights: number[]): number[] {
  const allocations: number[] = [];
  let remaining = total;
  let remainingWeight = weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index];
    const allocation =
      index === weights.length - 1
        ? remaining
        : Math.floor((remaining * weight) / Math.max(1, remainingWeight));
    allocations.push(allocation);
    remaining -= allocation;
    remainingWeight -= weight;
  }
  return allocations;
}

function clearGoodsMarket(world: WorldState): void {
  const budgets = householdBudgets(world);
  const householdBudget = budgets.reduce((sum, item) => sum + item.cents, 0);
  const governmentBudget = Math.min(450_000_00, depositOf(world, world.government.id));
  const totalBudget = householdBudget + governmentBudget;
  const grossRevenueByCompany = new Map<string, number>();
  const salesByCompany = new Map<string, number>();

  for (const good of world.goods) {
    const goodBudget = Math.floor((totalBudget * good.consumptionWeightBps) / 10_000);
    const suppliers = activeCompanies(world).filter(
      (company) => company.goodId === good.id && company.inventoryMilliUnits > 0,
    );
    if (suppliers.length === 0) {
      emitSimpleEvent(
        world,
        "MarketShortage",
        `Дефицит: ${good.shortName}`,
        `На рынке нет доступного запаса товара «${good.name}».`,
        [],
        "critical",
        [],
        { unmetDemandCents: goodBudget },
      );
      continue;
    }
    const competitiveness = suppliers.map((supplier) =>
      Math.max(1, Math.floor((good.basePriceCents * 10_000) / supplier.priceCents)),
    );
    const budgetShares = allocateIntegerTotal(goodBudget, competitiveness);
    let unfilledBudget = 0;
    suppliers.forEach((supplier, index) => {
      const desiredQuantity = Math.floor((budgetShares[index] * 1_000) / supplier.priceCents);
      const sold = Math.min(supplier.inventoryMilliUnits, desiredQuantity);
      const gross = Math.floor((sold * supplier.priceCents) / 1_000);
      supplier.inventoryMilliUnits -= sold;
      supplier.lastSalesMilliUnits += sold;
      salesByCompany.set(supplier.id, (salesByCompany.get(supplier.id) ?? 0) + sold);
      grossRevenueByCompany.set(supplier.id, (grossRevenueByCompany.get(supplier.id) ?? 0) + gross);
      unfilledBudget += budgetShares[index] - gross;
      if (sold > 0) {
        recordGoodsMovement(world, {
          goodId: good.id,
          fromId: supplier.id,
          toId: "household-sector",
          quantityMilliUnits: sold,
          reason: "CONSUMPTION",
          causeIds: [],
        });
      }
    });
    if (unfilledBudget > goodBudget * 0.18) {
      emitSimpleEvent(
        world,
        "MarketShortage",
        `Предложение не покрывает спрос: ${good.shortName}`,
        `Неудовлетворённый спрос составил ${Math.round((unfilledBudget * 100) / Math.max(1, goodBudget))}% месячного бюджета.`,
        suppliers.map((supplier) => supplier.id),
        "attention",
        [],
        { unmetDemandCents: unfilledBudget },
      );
    }
  }

  const totalGross = [...grossRevenueByCompany.values()].reduce((sum, value) => sum + value, 0);
  if (totalGross <= 0 || totalBudget <= 0) return;
  const householdShare = Math.min(
    totalGross,
    Math.floor((totalGross * householdBudget) / Math.max(1, totalBudget)),
  );
  const governmentShare = totalGross - householdShare;
  const householdPayments = allocateIntegerTotal(
    householdShare,
    budgets.map((item) => item.cents),
  );
  budgets.forEach((item, index) => {
    const amount = householdPayments[index];
    if (amount <= 0) return;
    transferDeposit(
      world,
      item.household.id,
      "goods-market",
      amount,
      "GOODS_CLEARING",
      `Потребительская корзина: ${item.household.displayName}`,
    );
  });
  if (governmentShare > 0) {
    transferDeposit(
      world,
      world.government.id,
      "goods-market",
      governmentShare,
      "GOODS_CLEARING",
      "Публичные закупки энергии, материалов, товаров и услуг",
    );
  }

  let totalTax = 0;
  for (const company of activeCompanies(world)) {
    const gross = grossRevenueByCompany.get(company.id) ?? 0;
    if (gross <= 0) continue;
    const salesTax = Math.floor(
      (gross * world.government.salesTaxBps) / (10_000 + world.government.salesTaxBps),
    );
    const netRevenue = gross - salesTax;
    const txId = transferDeposit(
      world,
      "goods-market",
      company.id,
      netRevenue,
      "GOODS_CLEARING",
      `Клиринг продаж: ${company.name}`,
    );
    if (txId) {
      company.lastGrossRevenueCents += netRevenue;
      totalTax += salesTax;
    }
  }
  if (totalTax > 0) {
    transferDeposit(
      world,
      "goods-market",
      world.government.id,
      totalTax,
      "SALES_TAX",
      "Перечисление налога с продаж после клиринга",
    );
  }

  for (const good of world.goods) {
    const sold = activeCompanies(world)
      .filter((company) => company.goodId === good.id)
      .reduce((sum, company) => sum + (salesByCompany.get(company.id) ?? 0), 0);
    const householdSold = Math.floor(
      (sold * householdBudget) / Math.max(1, totalBudget),
    );
    const householdAllocations = allocateIntegerTotal(
      householdSold,
      budgets.map((item) => item.cents),
    );
    budgets.forEach((item, index) => {
      item.household.consumptionMilliUnits[good.id] += householdAllocations[index];
    });
  }
}

function updatePricesAndWages(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const good = goodById(world, company.goodId);
    const outputUnits = Math.max(1, company.lastProductionMilliUnits / 1_000);
    const laborUnitCost = Math.round(
      (company.wageCents * company.employees.length) / outputUnits,
    );
    const inputUnitCost = Object.entries(good.recipe).reduce(
      (sum, [inputId, ratio]) => sum + averageMarketPrice(world, inputId) * ratio,
      0,
    );
    const costFloor = Math.max(
      Math.round(good.basePriceCents * 0.55),
      Math.round((laborUnitCost + inputUnitCost) * 1.06),
    );
    const demandPressure =
      (company.lastSalesMilliUnits - company.lastProductionMilliUnits) /
      Math.max(1_000, company.lastProductionMilliUnits);
    const inventoryCoverage =
      company.inventoryMilliUnits / Math.max(1_000, company.lastSalesMilliUnits);
    let adjustmentBps = Math.round(clamp(demandPressure, -1, 1) * 230);
    if (inventoryCoverage < 0.4) adjustmentBps += 180;
    if (inventoryCoverage > 2.1) adjustmentBps -= 160;
    adjustmentBps = clamp(adjustmentBps, -450, 550);
    const previousPrice = company.priceCents;
    company.priceCents = Math.max(
      costFloor,
      Math.round((company.priceCents * (10_000 + adjustmentBps)) / 10_000),
    );
    company.priceCents = clamp(
      company.priceCents,
      Math.floor(previousPrice * 0.94),
      Math.ceil(previousPrice * 1.06),
    );
    const priceChangeBps = Math.round(
      ((company.priceCents - previousPrice) * 10_000) / previousPrice,
    );
    if (Math.abs(priceChangeBps) >= 150) {
      emitSimpleEvent(
        world,
        "PriceChanged",
        `${company.name} изменила цену`,
        `Цена «${good.shortName}» ${priceChangeBps > 0 ? "выросла" : "снизилась"} на ${Math.abs(priceChangeBps / 100).toFixed(1)}% из-за издержек, продаж и запасов.`,
        [company.id],
        priceChangeBps > 0 ? "attention" : "info",
        [],
        { previousPriceCents: previousPrice, priceCents: company.priceCents },
      );
    }

    if (isQuarterEnd(world.clock)) {
      const desiredEmployees = clamp(
        Math.ceil((company.capacityMilliUnits / 1_000) * (10_000 / company.productivityBps) / 45),
        4,
        12,
      );
      const wageAdjustmentBps =
        company.employees.length < desiredEmployees ? 180 : company.distressMonths > 0 ? -100 : 40;
      company.wageCents = Math.max(
        22_000_00,
        Math.round((company.wageCents * (10_000 + wageAdjustmentBps)) / 10_000),
      );
    }
  }
}

function updateDistress(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const payroll = company.wageCents * company.employees.length;
    const weakOperations =
      company.lastOperatingExpenseCents > 0 &&
      company.lastGrossRevenueCents < company.lastOperatingExpenseCents * 0.62;
    const thinLiquidity = depositOf(world, company.id) < payroll * 0.45;
    const missedLoan = world.loans.some(
      (loan) =>
        loan.borrowerId === company.id && loan.status === "active" && loan.missedPayments >= 2,
    );
    if (company.missedPayrollMonths > 0 || (weakOperations && thinLiquidity) || missedLoan) {
      company.distressMonths += 1;
    } else {
      company.distressMonths = Math.max(0, company.distressMonths - 1);
    }
  }
}

function bankruptCompany(world: WorldState, company: Company): void {
  const causeIds = world.events
    .filter((event) => event.actorIds.includes(company.id))
    .slice(-4)
    .map((event) => event.id);
  const bankruptcyEvent = emitSimpleEvent(
    world,
    "CompanyBankrupt",
    `${company.name} прекратила деятельность`,
    `Нехватка ликвидности и пропущенные обязательства привели к закрытию. Кредиторы признают убытки.`,
    [company.id, company.bankId],
    "critical",
    causeIds,
    { depositCents: depositOf(world, company.id), distressMonths: company.distressMonths },
  );
  for (const householdId of [...company.employees]) {
    const household = world.households.find((item) => item.id === householdId);
    if (household) leaveCompany(world, household, `${company.name} прекратила деятельность`);
  }
  if (company.inventoryMilliUnits > 0) {
    recordGoodsMovement(world, {
      goodId: company.goodId,
      fromId: company.id,
      toId: "liquidation-loss",
      quantityMilliUnits: company.inventoryMilliUnits,
      reason: "LIQUIDATION",
      causeIds: [bankruptcyEvent],
    });
    company.inventoryMilliUnits = 0;
  }
  settleBorrowerLoansFromCash(world, company.id, [bankruptcyEvent]);
  defaultBorrowerLoans(world, company.id, [bankruptcyEvent]);
  company.active = false;
  company.closedAtMonth = world.clock.elapsedMonths;
  company.closureReason = "Неплатёжеспособность";
}

function processBankruptcies(world: WorldState): void {
  for (const company of activeCompanies(world)) {
    const severeLoanArrears = world.loans.some(
      (loan) => loan.borrowerId === company.id && loan.status === "active" && loan.missedPayments >= 3,
    );
    if (company.distressMonths >= 7 || company.missedPayrollMonths >= 4 || severeLoanArrears) {
      bankruptCompany(world, company);
    }
  }
}

function foundCompanyIfNeeded(world: WorldState): void {
  if (!isQuarterEnd(world.clock) || activeCompanies(world).length >= 10) return;
  const marketGap = world.goods
    .map((good) => {
      const suppliers = activeCompanies(world).filter((company) => company.goodId === good.id);
      const price = suppliers.length
        ? suppliers.reduce((sum, supplier) => sum + supplier.priceCents, 0) / suppliers.length
        : good.basePriceCents * 2;
      return {
        good,
        score:
          price / good.basePriceCents +
          Math.max(0, 2 - suppliers.length) * 12 -
          suppliers.length * 0.35,
      };
    })
    .sort((left, right) => right.score - left.score)[0];
  const founder = [...world.households].sort(
    (left, right) => depositOf(world, right.id) - depositOf(world, left.id) || left.id.localeCompare(right.id),
  )[0];
  if (!founder || depositOf(world, founder.id) < 40_000_00) return;
  const sequence = world.nextCompanyId++;
  const company: Company = {
    id: `company-${String(sequence).padStart(3, "0")}`,
    name: `${marketGap.good.shortName} · Новая ${sequence}`,
    goodId: marketGap.good.id,
    ownerHouseholdId: founder.id,
    bankId: founder.bankId,
    active: true,
    employees: [],
    wageCents: Math.max(founder.reservationWageCents, 31_000_00),
    priceCents: Math.round(marketGap.good.basePriceCents * 1.08),
    capacityMilliUnits:
      ({ food: 340_000, energy: 380_000, materials: 220_000, goods: 125_000, services: 190_000 }[
        marketGap.good.id
      ] ?? 180_000) +
      (sequence % 4) * 10_000,
    productivityBps: 8_700 + (founder.skillBps % 2_000),
    inventoryMilliUnits: 12_000,
    inputInventoryMilliUnits: Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    lastProductionMilliUnits: 0,
    lastSalesMilliUnits: 0,
    lastGrossRevenueCents: 0,
    lastOperatingExpenseCents: 0,
    distressMonths: 0,
    missedPayrollMonths: 0,
    foundedAtMonth: world.clock.elapsedMonths,
    closedAtMonth: null,
    closureReason: null,
  };
  world.companies.push(company);
  const contribution = Math.min(
    900_000_00,
    Math.max(30_000_00, Math.floor(depositOf(world, founder.id) * 0.3)),
  );
  const contributionTx = capitalContribution(world, founder.id, company.id, contribution);
  founder.foundedCompanyIds.push(company.id);
  recordGoodsMovement(world, {
    goodId: company.goodId,
    fromId: "founder-inventory",
    toId: company.id,
    quantityMilliUnits: company.inventoryMilliUnits,
    reason: "GENESIS",
    causeIds: contributionTx ? [contributionTx] : [],
  });
  emitSimpleEvent(
    world,
    "CompanyFounded",
    `Основана компания «${company.name}»`,
    `${founder.displayName} вошли на рынок «${marketGap.good.name}», где цены и концентрация сигнализировали о возможности.`,
    [founder.id, company.id],
    "positive",
    contributionTx ? [contributionTx] : [],
    { contributionCents: contribution },
  );
}

function collectCorporateTax(world: WorldState): void {
  if (!isYearEnd(world.clock)) return;
  const yearlyMetrics = world.metricsHistory.slice(-11);
  for (const company of activeCompanies(world)) {
    const current = {
      revenueCents: company.lastGrossRevenueCents,
      expenseCents: company.lastOperatingExpenseCents,
    };
    const prior = yearlyMetrics
      .flatMap((metric) => metric.companyMetrics)
      .filter((metric) => metric.companyId === company.id)
      .reduce(
        (totals, metric) => ({
          revenueCents: totals.revenueCents + metric.revenueCents,
          expenseCents: totals.expenseCents + metric.expenseCents,
        }),
        { revenueCents: 0, expenseCents: 0 },
      );
    const taxableProfit = Math.max(
      0,
      prior.revenueCents + current.revenueCents - prior.expenseCents - current.expenseCents,
    );
    const tax = Math.min(
      depositOf(world, company.id),
      Math.floor((taxableProfit * world.government.corporateTaxBps) / 10_000),
    );
    transferDeposit(
      world,
      company.id,
      world.government.id,
      tax,
      "CORPORATE_TAX",
      `Налог на прибыль: ${company.name}`,
    );
    company.lastOperatingExpenseCents += tax;
  }
}

function updateCentralBankPolicy(world: WorldState): void {
  if (!isYearEnd(world.clock)) return;
  const metrics = collectMetrics(world);
  const previousRate = world.centralBank.policyRateBps;
  if (metrics.annualInflationBps > world.centralBank.inflationTargetBps + 150) {
    world.centralBank.policyRateBps = Math.min(2_500, previousRate + 50);
  } else if (
    metrics.annualInflationBps < world.centralBank.inflationTargetBps - 150 &&
    metrics.unemploymentBps > 900
  ) {
    world.centralBank.policyRateBps = Math.max(100, previousRate - 50);
  }
  if (world.centralBank.policyRateBps !== previousRate) {
    emitSimpleEvent(
      world,
      "InterestRateChanged",
      "Центральный банк изменил ключевую ставку",
      `Ставка изменена с ${(previousRate / 100).toFixed(2)}% до ${(world.centralBank.policyRateBps / 100).toFixed(2)}% после наблюдаемой инфляции и занятости.`,
      [world.centralBank.id],
      "attention",
      [],
      {
        previousRateBps: previousRate,
        policyRateBps: world.centralBank.policyRateBps,
        inflationBps: metrics.annualInflationBps,
        unemploymentBps: metrics.unemploymentBps,
      },
    );
  }
}

export function stepMonth(world: WorldState): void {
  resetMonthlyCompanyState(world);
  serviceLoans(world);
  runLabourMarket(world);
  payWagesAndTaxes(world);
  paySocialTransfers(world);
  // Supply chain is processed in technological order within the monthly tick.
  // A downstream producer can buy the output that an upstream producer made this month.
  produceGoods(world, ["services"]);
  procureInputs(world, ["energy"]);
  produceGoods(world, ["energy"]);
  procureInputs(world, ["food", "materials"]);
  produceGoods(world, ["food", "materials"]);
  procureInputs(world, ["goods"]);
  produceGoods(world, ["goods"]);
  clearGoodsMarket(world);
  updatePricesAndWages(world);
  updateDistress(world);
  collectCorporateTax(world);
  processBankruptcies(world);
  for (let attempt = 0; attempt < 10 && activeCompanies(world).length < 10; attempt += 1) {
    const before = activeCompanies(world).length;
    foundCompanyIfNeeded(world);
    if (activeCompanies(world).length === before) break;
  }
  updateCentralBankPolicy(world);

  const metric = collectMetrics(world);
  world.metricsHistory.push(metric);
  const date = currentDate(world.clock);
  emitSimpleEvent(
    world,
    "MonthClosed",
    "Месяц закрыт",
    `${String(date.month).padStart(2, "0")}.${date.year}: выпуск, рынок труда и финансовые книги сведены.`,
    [],
    "info",
    [],
    {
      gdpCents: metric.nominalGdpCents,
      unemploymentBps: metric.unemploymentBps,
      cpiBps: metric.cpiBps,
    },
  );
  world.clock.elapsedMonths += 1;
}

export function runMonths(world: WorldState, months: number): void {
  if (!Number.isInteger(months) || months < 0) throw new Error("Число месяцев должно быть целым");
  for (let index = 0; index < months; index += 1) stepMonth(world);
}
