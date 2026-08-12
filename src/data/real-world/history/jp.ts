import type { ReferenceSeries } from "../../../economy/calibration.ts";
const metadata = { sourceType: "REAL_DATA" as const, baseYear: 2023, sourceNote: "World Bank WDI: сопоставимые годовые ряды 2019–2023; статический snapshot." };
export default [
  { id: "jp-gdp-growth", countryId: "jp", metric: "gdpGrowthBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [-40,-415,263,95,149], metadata },
  { id: "jp-inflation", countryId: "jp", metric: "inflationBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [47,-2,-23,250,327], metadata },
  { id: "jp-unemployment", countryId: "jp", metric: "unemploymentBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [240,280,280,260,260], metadata },
] satisfies ReferenceSeries[];
