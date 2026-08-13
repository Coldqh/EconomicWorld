import type { BaselineMetadata, CalibratedParameterSet } from "../domain/model.ts";

export interface ReferenceSeries {
  id: string;
  countryId: string;
  metric: string;
  months: number[];
  values: number[];
  metadata: BaselineMetadata;
  years?: number[];
  frequency?: "annual" | "quarterly" | "monthly";
}

export function absoluteCalendarMonth(year: number, month = 1): number {
  return year * 12 + month - 1;
}

export function elapsedMonthForCalendarPeriod(startYear: number, startMonth: number, year: number, month = 1): number {
  return absoluteCalendarMonth(year, month) - absoluteCalendarMonth(startYear, startMonth);
}

export function alignReferenceSeriesToWorld(reference: ReferenceSeries, startYear: number, startMonth: number): ReferenceSeries {
  if (!reference.years?.length) return { ...reference, months: [...reference.months], values: [...reference.values] };
  const periodMonths = reference.frequency === "quarterly" ? reference.months.map((month) => month % 12 + 1) : reference.frequency === "monthly" ? reference.months.map((month) => month % 12 + 1) : reference.years.map(() => 12);
  return { ...reference, months: reference.years.map((year, index) => elapsedMonthForCalendarPeriod(startYear, startMonth, year, periodMonths[index])), values: [...reference.values] };
}

export interface CalibrationSearchResult {
  bestParameters: CalibratedParameterSet;
  baselineParameters: CalibratedParameterSet;
  trainingErrorBps: number;
  validationErrorBps: number;
  baselineTrainingErrorBps: number;
  iterations: number;
}

export type CalibrationObjective = (parameters: CalibratedParameterSet, split: "training" | "validation") => number;

const PARAMETER_BOUNDS: Record<keyof CalibratedParameterSet, readonly [number, number, number]> = {
  consumptionIncomeElasticityBps: [6_000, 12_000, 500], investmentRateSensitivityBps: [1_500, 8_000, 500], priceAdjustmentSpeedBps: [400, 3_000, 200], wageAdjustmentSpeedBps: [300, 2_200, 150], creditDemandSensitivityBps: [2_000, 8_500, 500], employmentAdjustmentSpeedBps: [250, 2_000, 125],
  firmEntryExitSpeedBps: [200, 1_500, 100], governmentCommitmentAdjustmentBps: [250, 1_500, 100], taxComplianceResponseBps: [200, 1_500, 100], productivityGrowthResponseBps: [100, 1_200, 100],
};

export function searchCalibratedParameters(initial: CalibratedParameterSet, objective: CalibrationObjective, passes = 2): CalibrationSearchResult {
  let best = { ...initial };
  const baselineTrainingErrorBps = objective(initial, "training");
  let bestTraining = baselineTrainingErrorBps;
  let iterations = 1;
  for (let pass = 0; pass < passes; pass += 1) {
    for (const key of Object.keys(PARAMETER_BOUNDS) as Array<keyof CalibratedParameterSet>) {
      const [minimum, maximum, baseStep] = PARAMETER_BOUNDS[key];
      const step = Math.max(1, Math.round(baseStep / (pass + 1)));
      const candidates = [best[key] - step, best[key] + step, minimum, maximum].map((value) => Math.max(minimum, Math.min(maximum, value)));
      for (const value of [...new Set(candidates)]) {
        const candidate = { ...best, [key]: value };
        const training = objective(candidate, "training");
        iterations += 1;
        const regularization = Math.round(Math.abs(value - initial[key]) * 20 / Math.max(1, maximum - minimum));
        if (training + regularization < bestTraining) { best = candidate; bestTraining = training + regularization; }
      }
    }
  }
  return { bestParameters: best, baselineParameters: { ...initial }, trainingErrorBps: bestTraining, validationErrorBps: objective(best, "validation"), baselineTrainingErrorBps, iterations };
}

export function simulatedMetricSeries(metric: string, points: readonly { elapsedMonth: number; gdpGrowthBps: number; inflationBps: number; unemploymentBps: number; creditToGdpBps: number }[]): ReadonlyMap<number, number> {
  return new Map(points.map((point) => [point.elapsedMonth, metric === "gdpGrowthBps" ? point.gdpGrowthBps : metric === "inflationBps" ? point.inflationBps : metric === "unemploymentBps" ? point.unemploymentBps : metric === "creditToGdpBps" ? point.creditToGdpBps : 0]));
}

export interface CalibrationResult {
  seriesId: string;
  observations: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
  meanAbsolutePercentageErrorBps: number;
  trendDirectionAccuracyBps: number;
  correlationBps: number;
  split: "training" | "validation" | "full";
}

export interface CalibrationParameterSet {
  id: string;
  label: string;
  parameters: Record<string, number>;
  calibratedOnSeriesIds: string[];
  validationSeriesIds: string[];
  objectiveScoreBps: number;
}

export interface CountryFitReport {
  countryId: string;
  results: CalibrationResult[];
  weightedScoreBps: number;
  trainingScoreBps: number;
  validationScoreBps: number;
}

function correlationBps(expected: number[], actual: number[]): number {
  if (expected.length < 2) return 10_000;
  const expectedMean = expected.reduce((sum, value) => sum + value, 0) / expected.length;
  const actualMean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  const covariance = expected.reduce((sum, value, index) => sum + (value - expectedMean) * (actual[index] - actualMean), 0);
  const expectedVariance = expected.reduce((sum, value) => sum + (value - expectedMean) ** 2, 0);
  const actualVariance = actual.reduce((sum, value) => sum + (value - actualMean) ** 2, 0);
  return expectedVariance && actualVariance ? Math.round(covariance / Math.sqrt(expectedVariance * actualVariance) * 10_000) : 0;
}

export function compareCalibrationSeries(reference: ReferenceSeries, simulated: ReadonlyMap<number, number>, split: CalibrationResult["split"] = "full"): CalibrationResult {
  const pairs = reference.months.map((month, index) => ({ month, expected: reference.values[index], actual: simulated.get(month) })).filter((pair): pair is { month: number; expected: number; actual: number } => pair.actual !== undefined);
  if (!pairs.length) return { seriesId: reference.id, observations: 0, meanAbsoluteError: 0, rootMeanSquaredError: 0, meanAbsolutePercentageErrorBps: 0, trendDirectionAccuracyBps: 0, correlationBps: 0, split };
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
    correlationBps: correlationBps(pairs.map((pair) => pair.expected), pairs.map((pair) => pair.actual)),
    split,
  };
}

export function splitReferenceSeries(reference: ReferenceSeries, trainingShareBps = 7_000): { training: ReferenceSeries; validation: ReferenceSeries } {
  const splitAt = Math.max(1, Math.min(reference.months.length - 1, Math.floor(reference.months.length * trainingShareBps / 10_000)));
  return {
    training: { ...reference, id: `${reference.id}:training`, months: reference.months.slice(0, splitAt), years: reference.years?.slice(0, splitAt), values: reference.values.slice(0, splitAt) },
    validation: { ...reference, id: `${reference.id}:validation`, months: reference.months.slice(splitAt), years: reference.years?.slice(splitAt), values: reference.values.slice(splitAt) },
  };
}

export function countryFitReport(countryId: string, references: readonly ReferenceSeries[], simulatedSeries: ReadonlyMap<string, ReadonlyMap<number, number>>): CountryFitReport {
  const results = references.filter((series) => series.countryId === countryId).flatMap((reference) => {
    const split = splitReferenceSeries(reference);
    const simulated = simulatedSeries.get(reference.id) ?? new Map();
    return [compareCalibrationSeries(split.training, simulated, "training"), compareCalibrationSeries(split.validation, simulated, "validation")];
  });
  const score = (items: CalibrationResult[]) => items.length ? Math.max(0, 10_000 - Math.round(items.reduce((sum, item) => sum + item.meanAbsolutePercentageErrorBps, 0) / items.length)) : 0;
  return { countryId, results, weightedScoreBps: score(results), trainingScoreBps: score(results.filter((item) => item.split === "training")), validationScoreBps: score(results.filter((item) => item.split === "validation")) };
}

export function runCalibration(referenceSeries: readonly ReferenceSeries[], simulatedSeries: ReadonlyMap<string, ReadonlyMap<number, number>>): CalibrationResult[] {
  return referenceSeries.map((reference) => compareCalibrationSeries(reference, simulatedSeries.get(reference.id) ?? new Map()));
}
