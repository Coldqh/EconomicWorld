import { accountIds, ensureEntityAccounts, seedNonCashAsset } from "../core/ledger.ts";
import type { MetricPoint, WorldState } from "../domain/model.ts";
import { createWorld } from "../economy/create-world.ts";

type LegacyWorld = Partial<WorldState> & { schemaVersion?: number; saveVersion?: number };

function migrateMetric(metric: Partial<MetricPoint>, world: WorldState): MetricPoint {
  const prices = metric.priceByGoodCents ?? Object.fromEntries(world.goods.map((good) => [good.id, good.basePriceCents]));
  const nominal = metric.nominalGdpCents ?? 0;
  return {
    elapsedMonth: metric.elapsedMonth ?? 0,
    nominalGdpCents: nominal,
    gdpValueAddedCents: metric.gdpValueAddedCents ?? nominal,
    gdpExpenditureCents: metric.gdpExpenditureCents ?? nominal,
    gdpReconciliationGapCents: metric.gdpReconciliationGapCents ?? 0,
    realGdpCents: metric.realGdpCents ?? nominal,
    realGdpGrowthBps: metric.realGdpGrowthBps ?? 0,
    gdpDeflatorBps: metric.gdpDeflatorBps ?? 10_000,
    householdConsumptionCents: metric.householdConsumptionCents ?? 0,
    capitalFormationCents: metric.capitalFormationCents ?? 0,
    governmentConsumptionCents: metric.governmentConsumptionCents ?? 0,
    inventoryChangeCents: metric.inventoryChangeCents ?? 0,
    cpiBps: metric.cpiBps ?? 10_000,
    monthlyInflationBps: metric.monthlyInflationBps ?? 0,
    annualInflationBps: metric.annualInflationBps ?? 0,
    cpiContributionBpsByGood: metric.cpiContributionBpsByGood ?? Object.fromEntries(world.goods.map((good) => [good.id, good.consumptionWeightBps])),
    unemploymentBps: metric.unemploymentBps ?? 0,
    depositMoneyCents: metric.depositMoneyCents ?? 0,
    loanStockCents: metric.loanStockCents ?? 0,
    activeCompanies: metric.activeCompanies ?? world.companies.filter((company) => company.active).length,
    employedHouseholds: metric.employedHouseholds ?? world.households.filter((household) => household.employerId).length,
    policyRateBps: metric.policyRateBps ?? world.centralBank.policyRateBps,
    priceByGoodCents: prices,
    productionByGoodMilliUnits: metric.productionByGoodMilliUnits ?? Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    salesByGoodMilliUnits: metric.salesByGoodMilliUnits ?? Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    companyMetrics: (metric.companyMetrics ?? []).map((item) => ({ ...item, cogsCents: item.cogsCents ?? 0, netIncomeCents: item.netIncomeCents ?? item.revenueCents - item.expenseCents })),
  };
}

export function migrateWorldState(raw: unknown): WorldState {
  const legacy = structuredClone(raw) as LegacyWorld;
  if (legacy.schemaVersion === 2 && legacy.saveVersion === 2) return legacy as WorldState;
  const template = createWorld();
  const world = {
    ...template,
    ...legacy,
    schemaVersion: 2 as const,
    saveVersion: 2 as const,
    goods: template.goods.map((good) => ({ ...good, ...(legacy.goods?.find((item) => item.id === good.id) ?? {}), essential: good.essential })),
    people: template.people,
    households: template.households.map((base) => ({ ...base, ...(legacy.households?.find((item) => item.id === base.id) ?? {}), personIds: base.personIds, savingsPreferenceBps: (legacy.households?.find((item) => item.id === base.id) as Partial<typeof base> | undefined)?.savingsPreferenceBps ?? base.savingsPreferenceBps, preferenceWeightsBps: base.preferenceWeightsBps, preferredSellerByGoodId: {} })),
    companies: template.companies.map((base) => {
      const old = legacy.companies?.find((item) => item.id === base.id) as Partial<typeof base> | undefined;
      const quantity = old?.inventoryMilliUnits ?? base.inventoryMilliUnits;
      const good = template.goods.find((item) => item.id === (old?.goodId ?? base.goodId))!;
      const inventoryValue = old?.inventoryValueCents ?? Math.round(quantity * good.basePriceCents * 0.65 / 1_000);
      return { ...base, ...old, inventoryValueCents: inventoryValue, inputInventoryValueCents: old?.inputInventoryValueCents ?? Object.fromEntries(template.goods.map((item) => [item.id, 0])), productiveCapital: old?.productiveCapital ?? base.productiveCapital, retainedEarningsCents: old?.retainedEarningsCents ?? 0, financialReports: old?.financialReports ?? [] };
    }),
    banks: template.banks.map((base) => ({ ...base, ...(legacy.banks?.find((item) => item.id === base.id) ?? {}), minimumLiquidityRatioBps: base.minimumLiquidityRatioBps })),
    centralBank: { ...template.centralBank, ...legacy.centralBank, policyRateHistory: legacy.centralBank?.policyRateHistory ?? [{ elapsedMonth: legacy.clock?.elapsedMonths ?? 0, rateBps: legacy.centralBank?.policyRateBps ?? template.centralBank.policyRateBps }] },
    bankFunding: legacy.bankFunding ?? [],
    nationalAccounts: legacy.nationalAccounts ?? template.nationalAccounts,
    occupations: legacy.occupations ?? template.occupations,
    player: legacy.player ?? template.player,
    nextFundingId: legacy.nextFundingId ?? 1,
  } as WorldState;
  world.metricsHistory = (legacy.metricsHistory ?? []).map((metric) => migrateMetric(metric, world));
  for (const company of world.companies) {
    ensureEntityAccounts(world.ledger, company.id);
    if (!world.ledger.accounts[accountIds.finishedInventory(company.id)] && company.inventoryValueCents > 0) seedNonCashAsset(world, company.id, accountIds.finishedInventory(company.id), "Готовая продукция", company.inventoryValueCents);
    if (!world.ledger.accounts[accountIds.productiveCapital(company.id)] && company.productiveCapital.bookValueCents > 0) seedNonCashAsset(world, company.id, accountIds.productiveCapital(company.id), "Производственный капитал", company.productiveCapital.bookValueCents);
  }
  return world;
}
