import type { ReferenceSeries } from "../../economy/calibration.ts";

type HistoricalCountryModule = { default: ReferenceSeries[] };

const loaders: Record<string, () => Promise<HistoricalCountryModule>> = {
  ru: () => import("./history/ru.ts"), de: () => import("./history/de.ts"), us: () => import("./history/us.ts"),
  jp: () => import("./history/jp.ts"), kr: () => import("./history/kr.ts"),
};

export async function loadHistoricalSeries(countryId: string): Promise<ReferenceSeries[]> {
  const loader = loaders[countryId];
  return loader ? structuredClone((await loader()).default) : [];
}

export const availableHistoricalCountryIds = Object.freeze(Object.keys(loaders));
