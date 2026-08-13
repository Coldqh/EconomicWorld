import { convertMinor } from "../finance/currencies.ts";
import type { MetricPoint, WorldState } from "../domain/model.ts";

export interface NationalAccountsResult {
  valueAddedCents: number;
  expenditureCents: number;
  reconciliationGapCents: number;
  realGdpCents: number;
  deflatorBps: number;
  inventoryChangeCents: number;
}

export function calculateNationalAccounts(world: WorldState): NationalAccountsResult {
  const reportingCurrency = world.player.reportingCurrencyId;
  const periods = Object.values(world.countryEconomicAccounts.closedByCountry);
  const converted = (value: number, currencyId: string): number => convertMinor(world, value, currencyId, reportingCurrency) ?? 0;
  const valueAddedCents = periods.reduce((sum, period) => sum + converted(period.production.valueAddedMinor, period.currencyId), 0);
  const expenditureCents = periods.reduce((sum, period) => sum + converted(period.expenditure.gdpMinor, period.currencyId), 0);
  const inventoryChangeCents = periods.reduce((sum, period) => sum + converted(period.expenditure.inventoryChangeMinor, period.currencyId), 0);
  const cpiBps = world.countryMetricsHistory.length ? Math.round(world.countryMetricsHistory.slice(-world.countries.length).reduce((sum, item) => sum + item.cpiBps, 0) / world.countries.length) : 10_000;
  const realGdpCents = Math.round(valueAddedCents * 10_000 / Math.max(1, cpiBps));
  return {
    valueAddedCents,
    expenditureCents,
    reconciliationGapCents: valueAddedCents - expenditureCents,
    realGdpCents,
    deflatorBps: cpiBps,
    inventoryChangeCents,
  };
}

export function gdpReconciliationTolerance(metric: Pick<MetricPoint, "gdpValueAddedCents" | "gdpReconciliationGapCents">): number {
  return Math.max(100, Math.round(Math.abs(metric.gdpValueAddedCents) * 0.12));
}
