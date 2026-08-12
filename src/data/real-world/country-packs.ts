import type { BaselineSourceType } from "../../domain/model.ts";

export interface SourceMetadata {
  source: string;
  sourceUrl: string;
  sourceDate: string;
  referenceYear: number;
  unit: string;
  currency: string | null;
  frequency: "annual" | "quarterly" | "monthly";
  methodology: string;
  sourceType: BaselineSourceType;
}

export interface CountryDataPack {
  countryId: string;
  iso3: string;
  population: number;
  nominalGdpUsd: number;
  inflationBps: number;
  unemploymentBps: number;
  exportsUsd: number;
  importsUsd: number;
  reservesUsd: number;
  urbanizationBps: number;
  workingAgeShareBps: number;
  sources: Record<string, SourceMetadata>;
}

const WDI_URL = "https://api.worldbank.org/v2/";
const wdi = (indicator: string, unit: string, currency: string | null = null): SourceMetadata => ({
  source: `World Bank, World Development Indicators (${indicator})`, sourceUrl: WDI_URL, sourceDate: "2026-08-12", referenceYear: 2023,
  unit, currency, frequency: "annual", methodology: "Значение загружено из World Bank API и сохранено как неизменяемый входной набор; без интерполяции.", sourceType: "REAL_DATA",
});
const estimated = (unit: string): SourceMetadata => ({
  source: "Калибровочная оценка ECONOMIC WORLD", sourceUrl: "/docs/data-methodology.md", sourceDate: "2026-08-12", referenceYear: 2023,
  unit, currency: null, frequency: "annual", methodology: "Оценка используется только при отсутствии единого сопоставимого ряда и всегда помечается ESTIMATED.", sourceType: "ESTIMATED",
});
const sources = (): Record<string, SourceMetadata> => ({
  population: wdi("SP.POP.TOTL", "persons"), nominalGdpUsd: wdi("NY.GDP.MKTP.CD", "current USD", "USD"), inflationBps: wdi("FP.CPI.TOTL.ZG", "basis points"),
  unemploymentBps: wdi("SL.UEM.TOTL.ZS", "basis points"), exportsUsd: wdi("NE.EXP.GNFS.CD", "current USD", "USD"), importsUsd: wdi("NE.IMP.GNFS.CD", "current USD", "USD"),
  reservesUsd: wdi("FI.RES.TOTL.CD", "current USD", "USD"), urbanizationBps: estimated("basis points"), workingAgeShareBps: estimated("basis points"),
});

export const REAL_COUNTRY_PACKS: CountryDataPack[] = [
  ["ru","RUS",143826130,2046284838151.09,587,308,465937815839.194,379986343205.999,597217063819.197,7540,6700],
  ["de","DEU",83287273,4562207532490.28,595,307,1960255682615.72,1779045873341.21,322699586274.527,7780,6480],
  ["fr","FRA",68372286,3056250648138.29,488,734,1053069574154.53,1105442442028.06,240791742784.254,8130,6200],
  ["gb","GBR",68526000,3420796653789.08,679,403,1091653856200.64,1131603446867.99,177915356242.234,8430,6400],
  ["us","USA",336755052,27811517000000,412,364,3073360000000,3859856000000,773426187289.127,8310,6500],
  ["jp","JPN",124516650,4384854269961.93,327,260,923420059650.996,988160815442.388,1294636035263.82,9200,5950],
  ["ca","CAN",40049088,2196593836347.42,388,542,732380673864.391,729991623300.122,117550899244.64,8170,6600],
  ["it","ITA",58984216,2316882296366.32,562,763,772202263040.014,736153956396.287,247396414253.983,7160,6350],
  ["es","ESP",48352528,1619481980719.64,353,1218,612433794394.128,550315993015.696,103088315527.743,8100,6500],
  ["nl","NLD",17877117,1135475867551,384,354,993383113411.782,880497587437.271,69829689143.2849,9290,6570],
  ["kr","KOR",51712619,1844800934391.54,360,268,762299062736.35,755197457229.567,420930029064.025,8150,7100],
].map(([countryId, iso3, population, nominalGdpUsd, inflationBps, unemploymentBps, exportsUsd, importsUsd, reservesUsd, urbanizationBps, workingAgeShareBps]) => ({
  countryId: String(countryId), iso3: String(iso3), population: Number(population), nominalGdpUsd: Number(nominalGdpUsd), inflationBps: Number(inflationBps), unemploymentBps: Number(unemploymentBps),
  exportsUsd: Number(exportsUsd), importsUsd: Number(importsUsd), reservesUsd: Number(reservesUsd), urbanizationBps: Number(urbanizationBps), workingAgeShareBps: Number(workingAgeShareBps), sources: sources(),
}));

export const REAL_ENTITY_NAMES: Record<string, { banks: string[]; companies: string[] }> = {
  ru: { banks: ["Сбербанк", "ВТБ"], companies: ["Газпром", "Яндекс"] }, de: { banks: ["Deutsche Bank", "Commerzbank"], companies: ["Siemens", "SAP"] },
  fr: { banks: ["BNP Paribas", "Crédit Agricole"], companies: ["TotalEnergies", "LVMH"] }, gb: { banks: ["HSBC", "Barclays"], companies: ["Shell", "AstraZeneca"] },
  us: { banks: ["JPMorgan Chase", "Bank of America"], companies: ["Apple", "ExxonMobil"] }, jp: { banks: ["MUFG Bank", "SMBC"], companies: ["Toyota", "Sony"] },
  ca: { banks: ["Royal Bank of Canada", "Toronto-Dominion Bank"], companies: ["Shopify", "Suncor Energy"] }, it: { banks: ["Intesa Sanpaolo", "UniCredit"], companies: ["Enel", "Stellantis"] },
  es: { banks: ["Banco Santander", "BBVA"], companies: ["Iberdrola", "Inditex"] }, nl: { banks: ["ING", "ABN AMRO"], companies: ["ASML", "Philips"] },
  kr: { banks: ["KB Kookmin Bank", "Shinhan Bank"], companies: ["Samsung Electronics", "Hyundai Motor"] },
};

export function applyCountryPackToProfiles<T extends { countryId: string; population: number; baselineNominalGdpMinor: number; inflationBps: number; unemploymentBps: number; workingAgeShareBps: number; metadata: { sourceType: BaselineSourceType; baseYear: number; sourceNote?: string } }>(profiles: T[]): void {
  for (const profile of profiles) {
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === profile.countryId);
    if (!pack) continue;
    profile.population = pack.population;
    profile.baselineNominalGdpMinor = Math.round(pack.nominalGdpUsd * 100);
    profile.inflationBps = pack.inflationBps;
    profile.unemploymentBps = pack.unemploymentBps;
    profile.workingAgeShareBps = pack.workingAgeShareBps;
    profile.metadata = { sourceType: "REAL_DATA", baseYear: 2023, sourceNote: "World Bank WDI, статический нормализованный набор v1" };
  }
}
