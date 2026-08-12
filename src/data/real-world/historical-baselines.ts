export interface HistoricalMacroObservation {
  year: number;
  realGdpGrowthBps: number;
  inflationBps: number;
  unemploymentBps: number;
}

export const HISTORICAL_MACRO_OBSERVATIONS: Readonly<Record<string, readonly HistoricalMacroObservation[]>> = Object.freeze({
  ru: [
    { year: 2019, realGdpGrowthBps: 220, inflationBps: 447, unemploymentBps: 460 }, { year: 2020, realGdpGrowthBps: -270, inflationBps: 337, unemploymentBps: 559 }, { year: 2021, realGdpGrowthBps: 560, inflationBps: 669, unemploymentBps: 472 }, { year: 2022, realGdpGrowthBps: -210, inflationBps: 1380, unemploymentBps: 387 }, { year: 2023, realGdpGrowthBps: 360, inflationBps: 759, unemploymentBps: 325 },
  ],
  de: [
    { year: 2019, realGdpGrowthBps: 110, inflationBps: 135, unemploymentBps: 314 }, { year: 2020, realGdpGrowthBps: -410, inflationBps: 51, unemploymentBps: 385 }, { year: 2021, realGdpGrowthBps: 370, inflationBps: 314, unemploymentBps: 357 }, { year: 2022, realGdpGrowthBps: 140, inflationBps: 687, unemploymentBps: 305 }, { year: 2023, realGdpGrowthBps: -10, inflationBps: 595, unemploymentBps: 307 },
  ],
  us: [
    { year: 2019, realGdpGrowthBps: 247, inflationBps: 181, unemploymentBps: 367 }, { year: 2020, realGdpGrowthBps: -221, inflationBps: 123, unemploymentBps: 805 }, { year: 2021, realGdpGrowthBps: 582, inflationBps: 470, unemploymentBps: 536 }, { year: 2022, realGdpGrowthBps: 193, inflationBps: 800, unemploymentBps: 365 }, { year: 2023, realGdpGrowthBps: 253, inflationBps: 412, unemploymentBps: 364 },
  ],
  jp: [
    { year: 2019, realGdpGrowthBps: -40, inflationBps: 47, unemploymentBps: 240 }, { year: 2020, realGdpGrowthBps: -410, inflationBps: -2, unemploymentBps: 280 }, { year: 2021, realGdpGrowthBps: 260, inflationBps: -23, unemploymentBps: 280 }, { year: 2022, realGdpGrowthBps: 100, inflationBps: 250, unemploymentBps: 260 }, { year: 2023, realGdpGrowthBps: 190, inflationBps: 327, unemploymentBps: 260 },
  ],
  kr: [
    { year: 2019, realGdpGrowthBps: 220, inflationBps: 38, unemploymentBps: 375 }, { year: 2020, realGdpGrowthBps: -70, inflationBps: 54, unemploymentBps: 393 }, { year: 2021, realGdpGrowthBps: 460, inflationBps: 250, unemploymentBps: 364 }, { year: 2022, realGdpGrowthBps: 270, inflationBps: 510, unemploymentBps: 285 }, { year: 2023, realGdpGrowthBps: 140, inflationBps: 360, unemploymentBps: 269 },
  ],
});

export function historicalNominalScale(countryId: string, referenceYear: number, baselineYear = 2023): number {
  if (referenceYear >= baselineYear) return 1;
  const observations = HISTORICAL_MACRO_OBSERVATIONS[countryId];
  if (!observations) return 1 / 1.03 ** (baselineYear - referenceYear);
  let scale = 1;
  for (const observation of observations.filter((item) => item.year > referenceYear && item.year <= baselineYear)) {
    scale /= (1 + observation.realGdpGrowthBps / 10_000) * (1 + observation.inflationBps / 10_000);
  }
  return scale;
}
