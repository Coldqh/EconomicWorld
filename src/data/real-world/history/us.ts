import type { ReferenceSeries } from "../../../economy/calibration.ts";
const metadata = { sourceType: "REAL_DATA" as const, baseYear: 2023, sourceNote: "World Bank WDI: сопоставимые годовые ряды 2019–2023; статический snapshot." };
export default [
  { id: "us-gdp-growth", countryId: "us", metric: "gdpGrowthBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [247,-221,582,193,253], metadata },
  { id: "us-inflation", countryId: "us", metric: "inflationBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [181,123,470,800,412], metadata },
  { id: "us-unemployment", countryId: "us", metric: "unemploymentBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [367,805,536,365,364], metadata },
] satisfies ReferenceSeries[];
