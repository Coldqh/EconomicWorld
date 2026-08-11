import type { BaselineMetadata } from "../domain/model.ts";

export interface ReferenceSeries {
  id: string;
  countryId: string;
  metric: string;
  months: number[];
  values: number[];
  metadata: BaselineMetadata;
}

export interface CalibrationResult {
  seriesId: string;
  observations: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  meanAbsolutePercentageErrorBps: number;
  trendDirectionAccuracyBps: number;
}

export function compareCalibrationSeries(reference: ReferenceSeries, simulated: ReadonlyMap<number, number>): CalibrationResult {
  const pairs = reference.months.map((month, index) => ({ month, expected: reference.values[index], actual: simulated.get(month) })).filter((pair): pair is { month: number; expected: number; actual: number } => pair.actual !== undefined);
  if (!pairs.length) return { seriesId: reference.id, observations: 0, meanAbsoluteError: 0, rootMeanSquaredError: 0, meanAbsolutePercentageErrorBps: 0, trendDirectionAccuracyBps: 0 };
  const absolute = pairs.map((pair) => Math.abs(pair.actual - pair.expected));
  const squared = pairs.map((pair) => (pair.actual - pair.expected) ** 2);
  const percentage = pairs.map((pair) => Math.abs(pair.actual - pair.expected) / Math.max(1, Math.abs(pair.expected)));
  let correctTrend = 0;
  let trendChecks = 0;
  for (let index = 1; index < pairs.length; index += 1) {
    const expectedDirection = Math.sign(pairs[index].expected - pairs[index - 1].expected);
    const actualDirection = Math.sign(pairs[index].actual - pairs[index - 1].actual);
    if (expectedDirection === actualDirection) correctTrend += 1;
    trendChecks += 1;
  }
  return {
    seriesId: reference.id,
    observations: pairs.length,
    meanAbsoluteError: absolute.reduce((sum, value) => sum + value, 0) / pairs.length,
    rootMeanSquaredError: Math.sqrt(squared.reduce((sum, value) => sum + value, 0) / pairs.length),
    meanAbsolutePercentageErrorBps: Math.round(percentage.reduce((sum, value) => sum + value, 0) / pairs.length * 10_000),
    trendDirectionAccuracyBps: trendChecks ? Math.round(correctTrend * 10_000 / trendChecks) : 10_000,
  };
}

export function runCalibration(referenceSeries: readonly ReferenceSeries[], simulatedSeries: ReadonlyMap<string, ReadonlyMap<number, number>>): CalibrationResult[] {
  return referenceSeries.map((reference) => compareCalibrationSeries(reference, simulatedSeries.get(reference.id) ?? new Map()));
}
