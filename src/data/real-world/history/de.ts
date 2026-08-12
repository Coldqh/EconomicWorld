import type { ReferenceSeries } from "../../../economy/calibration.ts";
const metadata = { sourceType: "REAL_DATA" as const, baseYear: 2023, sourceNote: "World Bank WDI: сопоставимые годовые ряды 2019–2023; статический snapshot." };
export default [
  { id: "de-gdp-growth", countryId: "de", metric: "gdpGrowthBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [110,-410,370,140,-10], metadata },
  { id: "de-inflation", countryId: "de", metric: "inflationBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [145,51,314,687,595], metadata },
  { id: "de-unemployment", countryId: "de", metric: "unemploymentBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [314,385,354,305,307], metadata },
] satisfies ReferenceSeries[];
