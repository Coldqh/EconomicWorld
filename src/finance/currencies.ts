import type { Currency, FxPair, MonetaryArea, WorldState } from "../domain/model.ts";

export const CURRENCIES: Currency[] = [
  { id: "RUB", code: "RUB", displayName: "Российский рубль", symbol: "₽", minorUnitDigits: 2, monetaryAreaId: "money-area-rub" },
  { id: "USD", code: "USD", displayName: "Доллар США", symbol: "$", minorUnitDigits: 2, monetaryAreaId: "money-area-usd" },
  { id: "EUR", code: "EUR", displayName: "Евро", symbol: "€", minorUnitDigits: 2, monetaryAreaId: "money-area-eur" },
  { id: "GBP", code: "GBP", displayName: "Фунт стерлингов", symbol: "£", minorUnitDigits: 2, monetaryAreaId: "money-area-gbp" },
  { id: "JPY", code: "JPY", displayName: "Японская иена", symbol: "¥", minorUnitDigits: 0, monetaryAreaId: "money-area-jpy" },
  { id: "CAD", code: "CAD", displayName: "Канадский доллар", symbol: "CA$", minorUnitDigits: 2, monetaryAreaId: "money-area-cad" },
  { id: "KRW", code: "KRW", displayName: "Южнокорейская вона", symbol: "₩", minorUnitDigits: 0, monetaryAreaId: "money-area-krw" },
];

export const MONETARY_AREAS: MonetaryArea[] = [
  { id: "money-area-rub", name: "Рублёвая зона", currencyId: "RUB", monetaryAuthorityId: "central-bank-ru", memberCountryIds: ["ru"] },
  { id: "money-area-usd", name: "Долларовая зона", currencyId: "USD", monetaryAuthorityId: "central-bank-us", memberCountryIds: ["us"] },
  { id: "money-area-eur", name: "Еврозона", currencyId: "EUR", monetaryAuthorityId: "monetary-authority-eur", memberCountryIds: ["de", "fr", "it", "es", "nl"] },
  { id: "money-area-gbp", name: "Стерлинговая зона", currencyId: "GBP", monetaryAuthorityId: "central-bank-gb", memberCountryIds: ["gb"] },
  { id: "money-area-jpy", name: "Зона иены", currencyId: "JPY", monetaryAuthorityId: "central-bank-jp", memberCountryIds: ["jp"] },
  { id: "money-area-cad", name: "Зона канадского доллара", currencyId: "CAD", monetaryAuthorityId: "central-bank-ca", memberCountryIds: ["ca"] },
  { id: "money-area-krw", name: "Зона воны", currencyId: "KRW", monetaryAuthorityId: "central-bank-kr", memberCountryIds: ["kr"] },
];

// Стартовые ориентиры симуляции: стоимость одной единицы валюты в USD, ppm.
const USD_VALUE_PPM: Record<string, number> = {
  RUB: 11_000,
  USD: 1_000_000,
  EUR: 1_080_000,
  GBP: 1_270_000,
  JPY: 6_700,
  CAD: 740_000,
  KRW: 750,
};

export function baselineRatePpm(baseCurrencyId: string, quoteCurrencyId: string): number {
  if (baseCurrencyId === quoteCurrencyId) return 1_000_000;
  const base = USD_VALUE_PPM[baseCurrencyId];
  const quote = USD_VALUE_PPM[quoteCurrencyId];
  if (!base || !quote) throw new Error(`Нет стартового FX-курса ${baseCurrencyId}/${quoteCurrencyId}`);
  return Math.max(1, Math.round((base * 1_000_000) / quote));
}

export function createFxPairs(): FxPair[] {
  const pairs: FxPair[] = [];
  for (let left = 0; left < CURRENCIES.length; left += 1) {
    for (let right = left + 1; right < CURRENCIES.length; right += 1) {
      const baseCurrencyId = CURRENCIES[left].id;
      const quoteCurrencyId = CURRENCIES[right].id;
      const referenceRatePpm = baselineRatePpm(baseCurrencyId, quoteCurrencyId);
      const spreadBps = baseCurrencyId === "USD" || quoteCurrencyId === "USD" ? 18 : 28;
      const halfSpread = Math.max(1, Math.round((referenceRatePpm * spreadBps) / 20_000));
      pairs.push({
        id: `${baseCurrencyId}-${quoteCurrencyId}`,
        baseCurrencyId,
        quoteCurrencyId,
        referenceRatePpm,
        lastRatePpm: referenceRatePpm,
        previousRatePpm: referenceRatePpm,
        bidRatePpm: referenceRatePpm - halfSpread,
        askRatePpm: referenceRatePpm + halfSpread,
        spreadBps,
        volumeBaseMinor: 0,
      });
    }
  }
  return pairs;
}

export function fxRatePpm(world: Pick<WorldState, "fxPairs">, fromCurrencyId: string, toCurrencyId: string): number | null {
  if (fromCurrencyId === toCurrencyId) return 1_000_000;
  const direct = world.fxPairs.find((pair) => pair.baseCurrencyId === fromCurrencyId && pair.quoteCurrencyId === toCurrencyId);
  if (direct) return direct.lastRatePpm;
  const inverse = world.fxPairs.find((pair) => pair.baseCurrencyId === toCurrencyId && pair.quoteCurrencyId === fromCurrencyId);
  return inverse ? Math.max(1, Math.round(1_000_000_000_000 / inverse.lastRatePpm)) : null;
}

export function convertMinor(world: Pick<WorldState, "fxPairs">, amountMinor: number, fromCurrencyId: string, toCurrencyId: string): number | null {
  const rate = fxRatePpm(world, fromCurrencyId, toCurrencyId);
  if (rate === null) return null;
  return convertMinorAtRate(amountMinor, fromCurrencyId, toCurrencyId, rate);
}

export function convertMinorAtRate(amountMinor: number, fromCurrencyId: string, toCurrencyId: string, ratePpm: number): number {
  const fromDigits = CURRENCIES.find((currency) => currency.id === fromCurrencyId)?.minorUnitDigits ?? 2;
  const toDigits = CURRENCIES.find((currency) => currency.id === toCurrencyId)?.minorUnitDigits ?? 2;
  return Math.round((amountMinor * ratePpm * 10 ** toDigits) / (1_000_000 * 10 ** fromDigits));
}

export function formatMoney(amountMinor: number, currencyId: string, compact = false): string {
  const currency = CURRENCIES.find((item) => item.id === currencyId);
  const digits = currency?.minorUnitDigits ?? 2;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currencyId,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : digits,
    minimumFractionDigits: compact ? 0 : digits,
  }).format(amountMinor / 10 ** digits);
}

export const formatCompactMoney = (amountMinor: number, currencyId: string): string => formatMoney(amountMinor, currencyId, true);
