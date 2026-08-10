import { calculateNationalAccounts } from "../accounting/national-accounts.ts";
import { sumAccounts } from "../core/ledger.ts";
import type { MetricPoint, WorldState } from "../domain/model.ts";

function averagePriceForGood(world: WorldState, goodId: string): number {
  const companies = world.companies.filter((company) => company.active && company.goodId === goodId);
  if (!companies.length) return world.goods.find((good) => good.id === goodId)?.basePriceCents ?? 0;
  const totalWeight = companies.reduce((sum, company) => sum + Math.max(1, company.lastSalesMilliUnits), 0);
  return Math.round(companies.reduce((sum, company) => sum + company.priceCents * Math.max(1, company.lastSalesMilliUnits), 0) / totalWeight);
}

export function collectMetrics(world: WorldState): MetricPoint {
  const priceByGoodCents = Object.fromEntries(world.goods.map((good) => [good.id, averagePriceForGood(world, good.id)]));
  const productionByGoodMilliUnits = Object.fromEntries(world.goods.map((good) => [good.id, world.companies.filter((company) => company.goodId === good.id).reduce((sum, company) => sum + company.lastProductionMilliUnits, 0)]));
  const salesByGoodMilliUnits = Object.fromEntries(world.goods.map((good) => [good.id, world.companies.filter((company) => company.goodId === good.id).reduce((sum, company) => sum + company.lastSalesMilliUnits, 0)]));
  const actualConsumption = world.nationalAccounts.current.householdConsumptionByGoodCents;
  const totalConsumption = Object.values(actualConsumption).reduce((sum, value) => sum + value, 0);
  const weights = Object.fromEntries(world.goods.map((good) => [good.id, totalConsumption > 0 ? Math.round((actualConsumption[good.id] * 10_000) / totalConsumption) : world.nationalAccounts.cpiWeightsBps[good.id]]));
  const cpiContributionBpsByGood = Object.fromEntries(world.goods.map((good) => {
    const relativeBps = Math.round((priceByGoodCents[good.id] * 10_000) / good.basePriceCents);
    return [good.id, Math.round((relativeBps * weights[good.id]) / 10_000)];
  }));
  const cpiBps = Object.values(cpiContributionBpsByGood).reduce((sum, value) => sum + value, 0);
  const previous = world.metricsHistory.at(-1);
  const twelveMonthsAgo = world.metricsHistory.at(-12);
  const monthlyInflationBps = previous?.cpiBps ? Math.round(((cpiBps - previous.cpiBps) * 10_000) / previous.cpiBps) : 0;
  const annualInflationBps = twelveMonthsAgo?.cpiBps ? Math.round(((cpiBps - twelveMonthsAgo.cpiBps) * 10_000) / twelveMonthsAgo.cpiBps) : 0;
  const employedHouseholds = world.households.filter((household) => household.employerId).length;
  const unemploymentBps = Math.round(((world.households.length - employedHouseholds) * 10_000) / Math.max(1, world.households.length));
  const depositMoneyCents = sumAccounts(world, (account) => account.category === "asset" && account.instrument === "deposit");
  const loanStockCents = world.loans.filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  const national = calculateNationalAccounts(world);
  const realGdpGrowthBps = previous?.realGdpCents ? Math.round(((national.realGdpCents - previous.realGdpCents) * 10_000) / previous.realGdpCents) : 0;
  return {
    elapsedMonth: world.clock.elapsedMonths,
    nominalGdpCents: national.valueAddedCents,
    gdpValueAddedCents: national.valueAddedCents,
    gdpExpenditureCents: national.expenditureCents,
    gdpReconciliationGapCents: national.reconciliationGapCents,
    realGdpCents: national.realGdpCents,
    realGdpGrowthBps,
    gdpDeflatorBps: national.deflatorBps,
    householdConsumptionCents: world.nationalAccounts.current.householdConsumptionCents,
    capitalFormationCents: world.nationalAccounts.current.capitalFormationCents,
    governmentConsumptionCents: world.nationalAccounts.current.governmentConsumptionCents,
    inventoryChangeCents: national.inventoryChangeCents,
    cpiBps,
    monthlyInflationBps,
    annualInflationBps,
    cpiContributionBpsByGood,
    unemploymentBps,
    depositMoneyCents,
    loanStockCents,
    activeCompanies: world.companies.filter((company) => company.active).length,
    employedHouseholds,
    policyRateBps: world.centralBank.policyRateBps,
    priceByGoodCents,
    productionByGoodMilliUnits,
    salesByGoodMilliUnits,
    companyMetrics: world.companies.map((company) => ({
      companyId: company.id,
      revenueCents: company.lastGrossRevenueCents,
      expenseCents: company.lastOperatingExpenseCents,
      cogsCents: company.lastCogsCents,
      netIncomeCents: company.lastGrossRevenueCents - company.lastCogsCents - company.lastWagesCents - company.lastDepreciationCents - company.lastInterestCents - company.lastTaxCents,
      productionMilliUnits: company.lastProductionMilliUnits,
      salesMilliUnits: company.lastSalesMilliUnits,
    })),
  };
}

export function latestMetrics(world: WorldState): MetricPoint {
  return world.metricsHistory.at(-1) ?? collectMetrics(world);
}

export function deterministicFingerprint(world: WorldState): string {
  const balances = Object.entries(world.ledger.balances).sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => `${id}:${value}`).join("|");
  const companies = world.companies.map((company) => [company.id, company.active ? 1 : 0, company.priceCents, company.inventoryMilliUnits, company.employees.length].join(":")).join("|");
  const loans = world.loans.map((loan) => `${loan.id}:${loan.status}:${loan.remainingPrincipalCents}`).join("|");
  const player = `${world.player.personId}:${world.player.commandLog.length}:${world.player.completedCourseIds.join(",")}`;
  return `${world.clock.elapsedMonths}#${balances}#${companies}#${loans}#${player}`;
}
