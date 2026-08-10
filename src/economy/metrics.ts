import { sumAccounts } from "../core/ledger.ts";
import type { MetricPoint, WorldState } from "../domain/model.ts";

function averagePriceForGood(world: WorldState, goodId: string): number {
  const companies = world.companies.filter(
    (company) => company.active && company.goodId === goodId,
  );
  if (companies.length === 0) {
    return world.goods.find((good) => good.id === goodId)?.basePriceCents ?? 0;
  }
  const weights = companies.map((company) => Math.max(1, company.lastSalesMilliUnits));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  return Math.round(
    companies.reduce((sum, company, index) => sum + company.priceCents * weights[index], 0) /
      weightTotal,
  );
}

export function collectMetrics(world: WorldState): MetricPoint {
  const priceByGoodCents = Object.fromEntries(
    world.goods.map((good) => [good.id, averagePriceForGood(world, good.id)]),
  );
  const productionByGoodMilliUnits = Object.fromEntries(
    world.goods.map((good) => [
      good.id,
      world.companies
        .filter((company) => company.goodId === good.id)
        .reduce((sum, company) => sum + company.lastProductionMilliUnits, 0),
    ]),
  );
  const salesByGoodMilliUnits = Object.fromEntries(
    world.goods.map((good) => [
      good.id,
      world.companies
        .filter((company) => company.goodId === good.id)
        .reduce((sum, company) => sum + company.lastSalesMilliUnits, 0),
    ]),
  );
  const cpiBps = world.goods.reduce((sum, good) => {
    const relativeBps = Math.round((priceByGoodCents[good.id] * 10_000) / good.basePriceCents);
    return sum + Math.round((relativeBps * good.consumptionWeightBps) / 10_000);
  }, 0);
  const twelveMonthsAgo = world.metricsHistory.at(-12);
  const annualInflationBps = twelveMonthsAgo
    ? Math.round(((cpiBps - twelveMonthsAgo.cpiBps) * 10_000) / twelveMonthsAgo.cpiBps)
    : 0;
  const employedHouseholds = world.households.filter((household) => household.employerId).length;
  const unemploymentBps = Math.round(
    ((world.households.length - employedHouseholds) * 10_000) / world.households.length,
  );
  const depositMoneyCents = sumAccounts(
    world,
    (account) => account.category === "asset" && account.instrument === "deposit",
  );
  const loanStockCents = world.loans
    .filter((loan) => loan.status === "active")
    .reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  const nominalGdpCents = world.companies.reduce(
    (sum, company) => sum + company.lastGrossRevenueCents,
    0,
  );

  return {
    elapsedMonth: world.clock.elapsedMonths,
    nominalGdpCents,
    cpiBps,
    annualInflationBps,
    unemploymentBps,
    depositMoneyCents,
    loanStockCents,
    activeCompanies: world.companies.filter((company) => company.active).length,
    employedHouseholds,
    priceByGoodCents,
    productionByGoodMilliUnits,
    salesByGoodMilliUnits,
    companyMetrics: world.companies.map((company) => ({
      companyId: company.id,
      revenueCents: company.lastGrossRevenueCents,
      expenseCents: company.lastOperatingExpenseCents,
      productionMilliUnits: company.lastProductionMilliUnits,
      salesMilliUnits: company.lastSalesMilliUnits,
    })),
  };
}

export function latestMetrics(world: WorldState): MetricPoint {
  return world.metricsHistory.at(-1) ?? collectMetrics(world);
}

export function deterministicFingerprint(world: WorldState): string {
  const balances = Object.entries(world.ledger.balances)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => `${id}:${value}`)
    .join("|");
  const companies = world.companies
    .map((company) =>
      [
        company.id,
        company.active ? 1 : 0,
        company.priceCents,
        company.inventoryMilliUnits,
        company.employees.length,
      ].join(":"),
    )
    .join("|");
  const loans = world.loans
    .map((loan) => `${loan.id}:${loan.status}:${loan.remainingPrincipalCents}`)
    .join("|");
  return `${world.clock.elapsedMonths}#${balances}#${companies}#${loans}`;
}
