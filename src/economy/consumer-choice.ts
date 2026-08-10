import type { Household, WorldState } from "../domain/model.ts";

const CATEGORY_BY_GOOD: Record<string, keyof Household["utilityPreferencesBps"]> = {
  food: "food",
  energy: "energy",
  materials: "goods",
  goods: "goods",
  services: "services",
};

export function allocateConsumptionBudget(world: WorldState, household: Household, totalBudgetCents: number): Record<string, number> {
  const allocation = Object.fromEntries(world.goods.map((good) => [good.id, 0])) as Record<string, number>;
  if (totalBudgetCents <= 0) return allocation;
  const city = world.cities.find((item) => item.id === household.cityId);
  const income = household.employerId ? world.companies.find((company) => company.id === household.employerId)?.wageCents ?? 0 : household.lastDisposableIncomeCents;
  const referenceIncome = city?.medianIncomeCents ?? (income || 1);
  const incomeRatio = Math.max(0.35, Math.min(3.5, income / Math.max(1, referenceIncome)));
  const minimums: Record<string, number> = { food: 1_600, energy: 800 };
  let assigned = 0;
  for (const good of world.goods) {
    const minimum = Math.round(totalBudgetCents * (minimums[good.id] ?? 0) / 10_000);
    allocation[good.id] = minimum;
    assigned += minimum;
  }
  const step = Math.max(1, Math.round(totalBudgetCents / 50));
  while (assigned < totalBudgetCents) {
    let selectedId = world.goods[0].id;
    let selectedScore = -Infinity;
    for (const good of world.goods) {
      const category = CATEGORY_BY_GOOD[good.id] ?? "goods";
      const categoryPreference = household.utilityPreferencesBps[category] ?? 1_000;
      const legacyPreference = household.preferenceWeightsBps[good.id] ?? good.consumptionWeightBps;
      const discretionaryIncomeEffect = good.essential ? 1 / Math.sqrt(incomeRatio) : Math.sqrt(incomeRatio);
      const localPrice = city?.localPriceByGoodCents[good.id] ?? good.basePriceCents;
      const priceEffect = good.basePriceCents / Math.max(1, localPrice);
      const consumedUnits = allocation[good.id] / Math.max(1, localPrice);
      const marginalUtility = Math.sqrt(categoryPreference * legacyPreference) * discretionaryIncomeEffect * priceEffect / Math.sqrt(1 + consumedUnits * 10);
      if (marginalUtility > selectedScore) {
        selectedScore = marginalUtility;
        selectedId = good.id;
      }
    }
    const increment = Math.min(step, totalBudgetCents - assigned);
    allocation[selectedId] += increment;
    assigned += increment;
  }
  return allocation;
}
