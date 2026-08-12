import type { ReferenceSeries } from "../../../economy/calibration.ts";
const metadata = { sourceType: "REAL_DATA" as const, baseYear: 2023, sourceNote: "World Bank WDI: сопоставимые годовые ряды 2019–2023; статический snapshot." };
export default [
  { id: "kr-gdp-growth", countryId: "kr", metric: "gdpGrowthBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [223,-71,437,262,136], metadata },
  { id: "kr-inflation", countryId: "kr", metric: "inflationBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [38,54,250,510,360], metadata },
  { id: "kr-unemployment", countryId: "kr", metric: "unemploymentBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [375,393,365,285,268], metadata },
] satisfies ReferenceSeries[];
