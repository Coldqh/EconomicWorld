import type { WorldState } from "../domain/model.ts";

export type SimulationStage = "pre-conflict" | "production" | "trade" | "finance" | "post-conflict" | "month-close";
export interface LongRunInvariantFailure { month: number; stage: SimulationStage; invariantId: string; countryId?: string; entityId?: string; detail: string; }
export interface LongRunInvariantReport { checks: number; failures: LongRunInvariantFailure[]; }

const active = new WeakMap<WorldState, { failFast: boolean; report: LongRunInvariantReport; transactionCursor: number }>();

export function enableLongRunInvariantHarness(world: WorldState, failFast = true): LongRunInvariantReport {
  const report = { checks: 0, failures: [] } satisfies LongRunInvariantReport;
  active.set(world, { failFast, report, transactionCursor: world.ledger.transactions.length });
  return report;
}

export function disableLongRunInvariantHarness(world: WorldState): void { active.delete(world); }

function fail(world: WorldState, stage: SimulationStage, invariantId: string, detail: string, entityId?: string): void {
  const harness = active.get(world);
  if (!harness) return;
  const failure = { month: world.clock.elapsedMonths, stage, invariantId, entityId, detail };
  harness.report.failures.push(failure);
  if (harness.failFast) throw new Error(`Invariant ${invariantId} failed at month ${failure.month}, stage ${stage}: ${detail}`);
}

export function checkLongRunStage(world: WorldState, stage: SimulationStage): void {
  const harness = active.get(world);
  if (!harness) return;
  harness.report.checks += 1;
  const route = world.tradeRoutes.find((item) => item.usedCapacityMilliUnits > item.capacityMilliUnits || item.capacityMilliUnits < 0);
  if (route) fail(world, stage, "route-capacity", `used=${route.usedCapacityMilliUnits}, capacity=${route.capacityMilliUnits}`, route.id);
  const defense = world.defenseEconomy.countries.find((item) => !Number.isFinite(item.readinessBps) || !Number.isFinite(item.equipmentStockMinor) || item.equipmentStockMinor < 0 || item.activePersonnel < 0);
  if (defense) fail(world, stage, "defense-finite-stocks", JSON.stringify({ readinessBps: defense.readinessBps, equipmentStockMinor: defense.equipmentStockMinor, activePersonnel: defense.activePersonnel }), defense.countryId);
  const newTransactions = world.ledger.transactions.slice(harness.transactionCursor);
  for (const transaction of newTransactions) {
    const debit = transaction.entries.filter((item) => item.side === "debit").reduce((sum, item) => sum + item.amountCents, 0);
    const credit = transaction.entries.filter((item) => item.side === "credit").reduce((sum, item) => sum + item.amountCents, 0);
    if (debit !== credit) fail(world, stage, "double-entry", `debit=${debit}, credit=${credit}`, transaction.id);
    const currencies = new Set(transaction.entries.map((item) => world.ledger.accounts[item.accountId]?.currency));
    if (currencies.size !== 1) fail(world, stage, "single-currency-transaction", [...currencies].join(","), transaction.id);
  }
  harness.transactionCursor = world.ledger.transactions.length;
  if (stage !== "month-close") return;
  const period = Object.values(world.countryEconomicAccounts.closedByCountry).find((item) => !Number.isFinite(item.production.valueAddedMinor) || !Number.isFinite(item.financial.closingGrossDebtMinor));
  if (period) fail(world, stage, "country-accounts-finite", JSON.stringify({ gdp: period.production.valueAddedMinor, debt: period.financial.closingGrossDebtMinor }), period.countryId);
  const bop = world.balanceOfPayments.find((item) => item.elapsedMonth === world.clock.elapsedMonths && item.reconciliationWarning);
  if (bop) fail(world, stage, "bop-reconciliation", `gap=${bop.reconciliationGapUsdMinor}`, bop.countryId);
}
