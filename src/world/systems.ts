import { emitSimpleEvent } from "../core/events.ts";
import { depositOf, transferDeposit } from "../core/ledger.ts";
import type { LedgerArchiveSegment, TransactionKind, WorldState } from "../domain/model.ts";

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function updateAggregateEconomies(world: WorldState): void {
  // Массовые когорты работают на квартальном такте; персональный контур остаётся месячным.
  if (world.clock.elapsedMonths % 3 !== 0) return;
  for (const city of world.cities) {
    const population = world.populationCohorts.filter((cohort) => cohort.cityId === city.id);
    const firms = world.firmCohorts.filter((cohort) => cohort.cityId === city.id);
    let localIncome = 0;
    let employed = 0;
    let residents = 0;
    for (let index = 0; index < population.length; index += 1) {
      const cohort = population[index];
      const firm = firms[index % firms.length];
      const scaledIncome = Math.max(1, Math.round(cohort.employedCount * cohort.averageMonthlyIncomeCents / 10_000));
      const income = Math.min(scaledIncome, Math.max(0, Math.round(depositOf(world, firm.id) * 0.16)));
      const incomeTx = transferDeposit(world, firm.id, cohort.id, income, "COHORT_INCOME", `Доход когорты: ${city.name}`);
      cohort.lastIncomeCents = incomeTx ? income : 0;
      const propensity = cohort.incomeBand === "low" ? 8_800 : cohort.incomeBand === "middle" ? 7_900 : 6_800;
      const consumption = Math.min(depositOf(world, cohort.id), Math.round(cohort.lastIncomeCents * propensity / 10_000));
      const consumptionTx = transferDeposit(world, cohort.id, firm.id, consumption, "COHORT_CONSUMPTION", `Потребление когорты: ${city.name}`, incomeTx ? [incomeTx] : []);
      cohort.lastConsumptionCents = consumptionTx ? consumption : 0;
      if (consumptionTx) {
        firm.revenueCents = consumption;
        firm.profitsCents = Math.round(consumption * (650 + (firm.productivityBps - 8_000) * 0.2) / 10_000);
        firm.inventoryMilliUnits = Math.max(0, firm.inventoryMilliUnits + Math.round(firm.productionMilliUnits * 0.08) - Math.round(consumption / Math.max(1, city.costOfLivingCents) * 1_000));
        firm.productivityBps = clamp(firm.productivityBps + (firm.profitsCents > 0 ? 2 : -3), 6_000, 15_000);
      }
      localIncome += cohort.averageMonthlyIncomeCents * cohort.populationCount;
      residents += cohort.populationCount;
      employed += cohort.employedCount;
    }
    city.population = residents;
    city.medianIncomeCents = residents ? Math.round(localIncome / residents) : city.baseMonthlyWageCents;
    city.employmentBps = residents ? Math.round(employed * 10_000 / residents) : 0;
    const housing = world.housingCohorts.filter((cohort) => cohort.cityId === city.id);
    const units = housing.reduce((sum, cohort) => sum + cohort.totalUnits, 0);
    const available = housing.reduce((sum, cohort) => sum + cohort.availableUnits, 0);
    city.housingVacancyBps = units ? Math.round(available * 10_000 / units) : 0;
    const rent = housing.reduce((sum, cohort) => sum + cohort.monthlyRentCents * cohort.totalUnits, 0) / Math.max(1, units);
    const basket = Object.values(city.localPriceByGoodCents).reduce((sum, value) => sum + value, 0);
    city.costOfLivingCents = Math.round(rent + basket * 0.44);
    for (const good of world.goods) {
      const employmentPressure = clamp(10_000 + (9_000 - city.employmentBps) / 12, 9_700, 10_400);
      const logisticsPressure = clamp(10_000 + residents * 1_000 / Math.max(1, city.logisticsCapacityMilliUnits), 9_800, 10_500);
      const target = Math.round(good.basePriceCents * employmentPressure * logisticsPressure / 100_000_000);
      city.localPriceByGoodCents[good.id] = Math.round(city.localPriceByGoodCents[good.id] * 0.94 + target * 0.06);
    }
  }
}

export function migratePopulationCohorts(world: WorldState): void {
  if (world.clock.elapsedMonths === 0 || world.clock.elapsedMonths % 12 !== 0) return;
  const source = [...world.cities].sort((left, right) => left.employmentBps - right.employmentBps || right.costOfLivingCents - left.costOfLivingCents)[0];
  const target = [...world.cities].sort((left, right) => (right.medianIncomeCents - right.costOfLivingCents) - (left.medianIncomeCents - left.costOfLivingCents))[0];
  if (!source || !target || source.id === target.id) return;
  const from = world.populationCohorts.find((cohort) => cohort.cityId === source.id && cohort.ageBand === "25-34");
  const to = world.populationCohorts.find((cohort) => cohort.cityId === target.id && cohort.ageBand === "25-34");
  if (!from || !to) return;
  const count = Math.max(1, Math.min(Math.round(from.populationCount * 0.001), Math.round(target.population * 0.0005)));
  const employed = Math.round(count * from.employedCount / Math.max(1, from.populationCount));
  from.populationCount -= count;
  from.employedCount = Math.max(0, from.employedCount - employed);
  to.populationCount += count;
  to.employedCount += employed;
  emitSimpleEvent(world, "CohortMigrated", "Миграция населения", `${source.name} → ${target.name}: ${count.toLocaleString("ru-RU")} чел.`, [from.id, to.id], "info", [], { count });
}

export function compactLedgerHistory(world: WorldState): void {
  if (world.clock.elapsedMonths < 36 || world.clock.elapsedMonths % 12 !== 0) return;
  const cutoff = world.clock.elapsedMonths - 24;
  const archived = world.ledger.transactions.filter((transaction) => transaction.elapsedMonth < cutoff);
  if (!archived.length) return;
  const kindCounts: Partial<Record<TransactionKind, number>> = {};
  let debitCents = 0;
  let creditCents = 0;
  for (const transaction of archived) {
    kindCounts[transaction.kind] = (kindCounts[transaction.kind] ?? 0) + 1;
    for (const entry of transaction.entries) {
      if (entry.side === "debit") debitCents += entry.amountCents;
      else creditCents += entry.amountCents;
    }
  }
  const segment: LedgerArchiveSegment = {
    id: `archive-${String(world.ledgerArchives.length + 1).padStart(4, "0")}`,
    fromMonth: archived[0].elapsedMonth,
    toMonth: archived.at(-1)?.elapsedMonth ?? cutoff - 1,
    transactionCount: archived.length,
    debitCents,
    creditCents,
    kindCounts,
  };
  world.ledgerArchives.push(segment);
  world.ledger.transactions = world.ledger.transactions.filter((transaction) => transaction.elapsedMonth >= cutoff);
  world.goodsMovements = world.goodsMovements.filter((movement) => movement.elapsedMonth >= cutoff);
}

export function updateWorldDiagnostics(world: WorldState): void {
  const estimateSave = world.clock.elapsedMonths === 0 || world.clock.elapsedMonths % 12 === 0;
  const estimatedSaveBytes = estimateSave
    ? JSON.stringify({ clock: world.clock, ledger: world.ledger, archives: world.ledgerArchives, cohorts: world.populationCohorts, firms: world.firmCohorts, player: world.player }).length
    : world.diagnostics.estimatedSaveBytes;
  world.diagnostics = {
    populationRepresented: world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) + world.people.length,
    businessesRepresented: world.firmCohorts.reduce((sum, cohort) => sum + cohort.firmCount, 0) + world.companies.filter((company) => company.active).length,
    highFidelityPersons: world.people.filter((person) => person.fidelityTier >= 1).length,
    materializedPersons: world.fidelity.materializedPersonIds.length,
    explicitFirms: world.companies.length,
    firmCohorts: world.firmCohorts.length,
    materializedProperties: world.properties.length,
    housingUnitsRepresented: world.housingCohorts.reduce((sum, cohort) => sum + cohort.totalUnits, 0),
    ledgerHotTransactions: world.ledger.transactions.length,
    ledgerArchivedTransactions: world.ledgerArchives.reduce((sum, archive) => sum + archive.transactionCount, 0),
    estimatedSaveBytes,
    deterministicWorkUnits: world.populationCohorts.length + world.firmCohorts.length + world.people.length + world.companies.length,
  };
}
