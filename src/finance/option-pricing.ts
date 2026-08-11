export interface OptionValuationInput {
  optionType: "call" | "put";
  underlyingPriceMinor: number;
  strikeMinor: number;
  timeToExpiryYears: number;
  riskFreeRateBps: number;
  volatilityBps: number;
  dividendYieldBps?: number;
}

export interface OptionGreeks {
  delta: number;
  gamma: number;
  thetaPerMonthMinor: number;
  vegaPerVolPointMinor: number;
}

export interface OptionValuation extends OptionGreeks {
  theoreticalValueMinor: number;
  intrinsicValueMinor: number;
}

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function valueEuropeanOption(input: OptionValuationInput): OptionValuation {
  const spot = Math.max(0.000001, input.underlyingPriceMinor);
  const strike = Math.max(0.000001, input.strikeMinor);
  const time = Math.max(1 / 365, input.timeToExpiryYears);
  const rate = input.riskFreeRateBps / 10_000;
  const dividend = (input.dividendYieldBps ?? 0) / 10_000;
  const volatility = Math.max(0.0001, input.volatilityBps / 10_000);
  const rootTime = Math.sqrt(time);
  const d1 = (Math.log(spot / strike) + (rate - dividend + volatility * volatility / 2) * time) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  const discountedSpot = spot * Math.exp(-dividend * time);
  const discountedStrike = strike * Math.exp(-rate * time);
  const isCall = input.optionType === "call";
  const value = isCall
    ? discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2)
    : discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
  const delta = isCall ? Math.exp(-dividend * time) * normalCdf(d1) : Math.exp(-dividend * time) * (normalCdf(d1) - 1);
  const gamma = Math.exp(-dividend * time) * normalPdf(d1) / (spot * volatility * rootTime);
  const commonTheta = -discountedSpot * normalPdf(d1) * volatility / (2 * rootTime);
  const annualTheta = isCall
    ? commonTheta - rate * discountedStrike * normalCdf(d2) + dividend * discountedSpot * normalCdf(d1)
    : commonTheta + rate * discountedStrike * normalCdf(-d2) - dividend * discountedSpot * normalCdf(-d1);
  const vegaPerVolPointMinor = discountedSpot * normalPdf(d1) * rootTime / 100;
  return {
    theoreticalValueMinor: Math.max(0, Math.round(value)),
    intrinsicValueMinor: Math.max(0, isCall ? spot - strike : strike - spot),
    delta,
    gamma,
    thetaPerMonthMinor: annualTheta / 12,
    vegaPerVolPointMinor,
  };
}

export function impliedVolatilityBps(input: Omit<OptionValuationInput, "volatilityBps">, observedPriceMinor: number): number | null {
  const intrinsic = valueEuropeanOption({ ...input, volatilityBps: 1 }).intrinsicValueMinor;
  if (!Number.isFinite(observedPriceMinor) || observedPriceMinor < intrinsic) return null;
  let low = 1;
  let high = 50_000;
  const maximumPrice = valueEuropeanOption({ ...input, volatilityBps: high }).theoreticalValueMinor;
  if (observedPriceMinor > maximumPrice) return null;
  for (let iteration = 0; iteration < 72; iteration += 1) {
    const middle = Math.round((low + high) / 2);
    const price = valueEuropeanOption({ ...input, volatilityBps: middle }).theoreticalValueMinor;
    if (Math.abs(price - observedPriceMinor) <= 1) return middle;
    if (price < observedPriceMinor) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(1, Math.round((low + high) / 2));
}
