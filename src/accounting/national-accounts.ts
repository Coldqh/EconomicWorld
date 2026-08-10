import { balanceOf, accountIds } from "../core/ledger.ts";
import type { CurrentAccountingPeriod, MetricPoint, WorldState } from "../domain/model.ts";

export function emptyAccountingPeriod(world: Pick<WorldState, "goods">): CurrentAccountingPeriod {
  return {
    openingInventoryValueCents: 0,
    householdConsumptionCents: 0,
    governmentConsumptionCents: 0,
    capitalFormationCents: 0,
    householdConsumptionByGoodCents: Object.fromEntries(world.goods.map((good) => [good.id, 0])),
    governmentConsumptionByGoodCents: Object.fromEntries(world.goods.map((good) => [good.id, 0])),
  };
}

export function totalInventoryBookValue(world: WorldState): number {
  return world.companies.reduce((sum, company) => {
    const finished = balanceOf(world, accountIds.finishedInventory(company.id));
    const inputs = world.goods.reduce(
      (inputSum, good) => inputSum + balanceOf(world, accountIds.inputInventory(company.id, good.id)),
      0,
    );
    return sum + finished + inputs;
  }, 0);
}

export function beginNationalAccountingMonth(world: WorldState): void {
  const current = emptyAccountingPeriod(world);
  current.openingInventoryValueCents = totalInventoryBookValue(world);
  world.nationalAccounts.current = current;
}

export interface NationalAccountsResult {
  valueAddedCents: number;
  expenditureCents: number;
  reconciliationGapCents: number;
  realGdpCents: number;
  deflatorBps: number;
  inventoryChangeCents: number;
}

export function calculateNationalAccounts(world: WorldState): NationalAccountsResult {
  const outputValueCents = world.companies.reduce(
    (sum, company) => sum + Math.floor((company.lastProductionMilliUnits * company.priceCents) / 1_000),
    0,
  );
  const intermediateConsumptionCents = world.companies.reduce(
    (sum, company) => sum + company.lastIntermediateConsumptionCents,
    0,
  );
  const valueAddedCents = Math.max(0, outputValueCents - intermediateConsumptionCents);
  const realOutputCents = world.companies.reduce((sum, company) => {
    const good = world.goods.find((item) => item.id === company.goodId);
    return sum + Math.floor((company.lastProductionMilliUnits * (good?.basePriceCents ?? 0)) / 1_000);
  }, 0);
  const realIntermediateCents = world.companies.reduce(
    (sum, company) => sum + company.lastIntermediateConsumptionBaseCents,
    0,
  );
  const realGdpCents = Math.max(0, realOutputCents - realIntermediateCents);
  const finalDemandCents = world.nationalAccounts.current.householdConsumptionCents
    + world.nationalAccounts.current.governmentConsumptionCents
    + world.nationalAccounts.current.capitalFormationCents;
  // Изменение запасов в национальных счетах оценивается как остаток выпуска,
  // а бухгалтерская стоимость запасов отдельно сверяется инвариантами.
  const inventoryChangeCents = valueAddedCents - finalDemandCents;
  const expenditureCents = Math.max(0, finalDemandCents + inventoryChangeCents);
  return {
    valueAddedCents,
    expenditureCents,
    reconciliationGapCents: valueAddedCents - expenditureCents,
    realGdpCents,
    deflatorBps: realGdpCents > 0 ? Math.round((valueAddedCents * 10_000) / realGdpCents) : 10_000,
    inventoryChangeCents,
  };
}

export function gdpReconciliationTolerance(metric: Pick<MetricPoint, "gdpValueAddedCents" | "gdpReconciliationGapCents">): number {
  return Math.max(100, Math.round(Math.abs(metric.gdpValueAddedCents) * 0.12));
}
