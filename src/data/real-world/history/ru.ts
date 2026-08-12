import type { ReferenceSeries } from "../../../economy/calibration.ts";
const metadata = { sourceType: "REAL_DATA" as const, baseYear: 2023, sourceNote: "World Bank WDI: NY.GDP.MKTP.KD.ZG, FP.CPI.TOTL.ZG, SL.UEM.TOTL.ZS; годовые данные 2019–2023, загружаются по запросу." };
export default [
  { id: "ru-gdp-growth", countryId: "ru", metric: "gdpGrowthBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [220,-265,580,-140,410], metadata },
  { id: "ru-inflation", countryId: "ru", metric: "inflationBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [447,337,669,1380,587], metadata },
  { id: "ru-unemployment", countryId: "ru", metric: "unemploymentBps", months: [0,12,24,36,48], years: [2019,2020,2021,2022,2023], frequency: "annual", values: [450,559,472,387,308], metadata },
] satisfies ReferenceSeries[];
