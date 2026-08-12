import type { BaselineSourceType } from "../../domain/model.ts";
import { baselineRatePpm, convertMinorAtRate } from "../../finance/currencies.ts";
import { HISTORICAL_MACRO_OBSERVATIONS, historicalNominalScale } from "./historical-baselines.ts";

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
  governmentDebtToGdpBps: number;
  privateCreditToGdpBps: number;
  bankingAssetsToGdpBps: number;
  savingsRateBps: number;
  labourParticipationBps: number;
  employmentElasticityBps: number;
  tradeOpennessBps: number;
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

const STRUCTURAL_BASELINES: Record<string, Pick<CountryDataPack, "governmentDebtToGdpBps" | "privateCreditToGdpBps" | "bankingAssetsToGdpBps" | "savingsRateBps" | "labourParticipationBps" | "employmentElasticityBps">> = {
  ru: { governmentDebtToGdpBps: 2_050, privateCreditToGdpBps: 6_000, bankingAssetsToGdpBps: 10_500, savingsRateBps: 2_800, labourParticipationBps: 6_200, employmentElasticityBps: 3_800 },
  de: { governmentDebtToGdpBps: 6_300, privateCreditToGdpBps: 8_500, bankingAssetsToGdpBps: 14_000, savingsRateBps: 2_900, labourParticipationBps: 6_100, employmentElasticityBps: 3_300 },
  fr: { governmentDebtToGdpBps: 11_000, privateCreditToGdpBps: 10_500, bankingAssetsToGdpBps: 17_000, savingsRateBps: 2_600, labourParticipationBps: 5_600, employmentElasticityBps: 3_500 },
  gb: { governmentDebtToGdpBps: 10_100, privateCreditToGdpBps: 13_000, bankingAssetsToGdpBps: 20_000, savingsRateBps: 1_900, labourParticipationBps: 6_300, employmentElasticityBps: 4_200 },
  us: { governmentDebtToGdpBps: 12_200, privateCreditToGdpBps: 18_000, bankingAssetsToGdpBps: 18_500, savingsRateBps: 1_850, labourParticipationBps: 6_270, employmentElasticityBps: 4_800 },
  jp: { governmentDebtToGdpBps: 25_200, privateCreditToGdpBps: 18_500, bankingAssetsToGdpBps: 23_000, savingsRateBps: 3_100, labourParticipationBps: 6_250, employmentElasticityBps: 2_200 },
  ca: { governmentDebtToGdpBps: 10_700, privateCreditToGdpBps: 17_000, bankingAssetsToGdpBps: 21_000, savingsRateBps: 2_200, labourParticipationBps: 6_550, employmentElasticityBps: 4_100 },
  it: { governmentDebtToGdpBps: 14_000, privateCreditToGdpBps: 8_000, bankingAssetsToGdpBps: 13_500, savingsRateBps: 2_750, labourParticipationBps: 4_950, employmentElasticityBps: 2_700 },
  es: { governmentDebtToGdpBps: 10_500, privateCreditToGdpBps: 9_000, bankingAssetsToGdpBps: 14_000, savingsRateBps: 2_100, labourParticipationBps: 5_850, employmentElasticityBps: 4_600 },
  nl: { governmentDebtToGdpBps: 4_600, privateCreditToGdpBps: 16_000, bankingAssetsToGdpBps: 22_000, savingsRateBps: 3_000, labourParticipationBps: 6_700, employmentElasticityBps: 3_900 },
  kr: { governmentDebtToGdpBps: 5_100, privateCreditToGdpBps: 20_000, bankingAssetsToGdpBps: 19_000, savingsRateBps: 3_400, labourParticipationBps: 6_450, employmentElasticityBps: 3_600 },
};

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
].map(([countryId, iso3, population, nominalGdpUsd, inflationBps, unemploymentBps, exportsUsd, importsUsd, reservesUsd, urbanizationBps, workingAgeShareBps]) => {
  const id = String(countryId);
  const structure = STRUCTURAL_BASELINES[id];
  return {
    countryId: id, iso3: String(iso3), population: Number(population), nominalGdpUsd: Number(nominalGdpUsd), inflationBps: Number(inflationBps), unemploymentBps: Number(unemploymentBps),
    exportsUsd: Number(exportsUsd), importsUsd: Number(importsUsd), reservesUsd: Number(reservesUsd), urbanizationBps: Number(urbanizationBps), workingAgeShareBps: Number(workingAgeShareBps),
    ...structure, tradeOpennessBps: Math.round((Number(exportsUsd) + Number(importsUsd)) * 10_000 / Number(nominalGdpUsd)), sources: sources(),
  };
});

export const REAL_ENTITY_NAMES: Record<string, { banks: string[]; companies: string[] }> = {
  ru: { banks: ["Сбербанк", "ВТБ"], companies: ["Газпром", "Яндекс"] }, de: { banks: ["Deutsche Bank", "Commerzbank"], companies: ["Siemens", "SAP"] },
  fr: { banks: ["BNP Paribas", "Crédit Agricole"], companies: ["TotalEnergies", "LVMH"] }, gb: { banks: ["HSBC", "Barclays"], companies: ["Shell", "AstraZeneca"] },
  us: { banks: ["JPMorgan Chase", "Bank of America"], companies: ["Apple", "ExxonMobil"] }, jp: { banks: ["MUFG Bank", "SMBC"], companies: ["Toyota", "Sony"] },
  ca: { banks: ["Royal Bank of Canada", "Toronto-Dominion Bank"], companies: ["Shopify", "Suncor Energy"] }, it: { banks: ["Intesa Sanpaolo", "UniCredit"], companies: ["Enel", "Stellantis"] },
  es: { banks: ["Banco Santander", "BBVA"], companies: ["Iberdrola", "Inditex"] }, nl: { banks: ["ING", "ABN AMRO"], companies: ["ASML", "Philips"] },
  kr: { banks: ["KB Kookmin Bank", "Shinhan Bank"], companies: ["Samsung Electronics", "Hyundai Motor"] },
};

const COUNTRY_CURRENCY: Record<string, string> = { ru: "RUB", de: "EUR", fr: "EUR", gb: "GBP", us: "USD", jp: "JPY", ca: "CAD", it: "EUR", es: "EUR", nl: "EUR", kr: "KRW" };

export function applyCountryPackToProfiles<T extends { countryId: string; population: number; baselineNominalGdpMinor: number; inflationBps: number; unemploymentBps: number; workingAgeShareBps: number; governmentDebtToGdpBps: number; privateCreditToGdpBps: number; bankingDepthBps: number; savingsRateBps: number; metadata: { sourceType: BaselineSourceType; baseYear: number; sourceNote?: string } }>(profiles: T[], referenceYear = 2023): void {
  for (const profile of profiles) {
    const pack = REAL_COUNTRY_PACKS.find((item) => item.countryId === profile.countryId);
    if (!pack) continue;
    profile.population = pack.population;
    const currencyId = COUNTRY_CURRENCY[profile.countryId] ?? "USD";
    const usdMinor = Math.round(pack.nominalGdpUsd * historicalNominalScale(profile.countryId, referenceYear) * 100);
    profile.baselineNominalGdpMinor = convertMinorAtRate(usdMinor, "USD", currencyId, baselineRatePpm("USD", currencyId));
    const historical = HISTORICAL_MACRO_OBSERVATIONS[profile.countryId]?.find((item) => item.year === referenceYear);
    profile.inflationBps = historical?.inflationBps ?? pack.inflationBps;
    profile.unemploymentBps = historical?.unemploymentBps ?? pack.unemploymentBps;
    profile.workingAgeShareBps = pack.workingAgeShareBps;
    profile.governmentDebtToGdpBps = pack.governmentDebtToGdpBps;
    profile.privateCreditToGdpBps = pack.privateCreditToGdpBps;
    profile.bankingDepthBps = pack.bankingAssetsToGdpBps;
    profile.savingsRateBps = pack.savingsRateBps;
    profile.metadata = { sourceType: historical || referenceYear === 2023 ? "REAL_DATA" : "ESTIMATED", baseYear: referenceYear, sourceNote: historical ? `World Bank WDI, исторический baseline ${referenceYear}` : `World Bank WDI 2023, обратная оценка baseline ${referenceYear}` };
  }
}
