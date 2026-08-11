import type { GoodDefinition } from "../domain/model.ts";

export interface CountryBankSeed {
  id: string;
  name: string;
  spreadBps: number;
  capitalRatioBps: number;
  liquidityRatioBps: number;
}

export interface CountryCompanySeed {
  name: string;
  cityId: string;
  goodId: GoodDefinition["id"];
  industry: string;
  representationTier: "A" | "B" | "C";
  sizeClass: "small" | "medium" | "large";
  listed: boolean;
}

export interface CountryEconomyPack {
  countryId: string;
  currencyId: string;
  governmentName: string;
  centralBankName: string;
  exchangeName: string;
  exchangeShortName: string;
  brokerName: string;
  banks: CountryBankSeed[];
  companies: CountryCompanySeed[];
}

const BASE_COUNTRY_ECONOMY_PACKS: CountryEconomyPack[] = [
  {
    countryId: "ru", currencyId: "RUB", governmentName: "Правительство России", centralBankName: "Банк России",
    exchangeName: "Московская биржа", exchangeShortName: "MOEX", brokerName: "Мир Инвестиции",
    banks: [
      { id: "bank-ru-north", name: "Северный банк", spreadBps: 260, capitalRatioBps: 900, liquidityRatioBps: 1_200 },
      { id: "bank-ru-civic", name: "Городской банк", spreadBps: 310, capitalRatioBps: 950, liquidityRatioBps: 1_250 },
    ],
    companies: [
      { name: "Северные поля", cityId: "moscow", goodId: "food", industry: "агропромышленность", representationTier: "A", sizeClass: "large", listed: true },
      { name: "ЭнергоСеть", cityId: "saint-petersburg", goodId: "energy", industry: "энергетика", representationTier: "B", sizeClass: "large", listed: false },
      { name: "Казанский сплав", cityId: "kazan", goodId: "materials", industry: "материалы", representationTier: "B", sizeClass: "medium", listed: false },
    ],
  },
  {
    countryId: "de", currencyId: "EUR", governmentName: "Федеральное правительство Германии", centralBankName: "Бундесбанк",
    exchangeName: "Франкфуртская биржа", exchangeShortName: "FWB", brokerName: "Rhein Broker",
    banks: [
      { id: "bank-de-rhein", name: "Рейн Банк", spreadBps: 205, capitalRatioBps: 1_050, liquidityRatioBps: 1_350 },
      { id: "bank-de-hansa", name: "Ганза Банк", spreadBps: 230, capitalRatioBps: 1_000, liquidityRatioBps: 1_300 },
    ],
    companies: [
      { name: "Берлин Системс", cityId: "berlin", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Мюнхен Моторс", cityId: "munich", goodId: "goods", industry: "автомобили", representationTier: "B", sizeClass: "large", listed: false },
      { name: "Ганза Логистик", cityId: "hamburg", goodId: "materials", industry: "логистика", representationTier: "B", sizeClass: "medium", listed: false },
    ],
  },
  {
    countryId: "fr", currencyId: "EUR", governmentName: "Правительство Франции", centralBankName: "Банк Франции",
    exchangeName: "Парижская биржа", exchangeShortName: "PAR", brokerName: "Seine Courtage",
    banks: [
      { id: "bank-fr-seine", name: "Сена Банк", spreadBps: 220, capitalRatioBps: 1_000, liquidityRatioBps: 1_300 },
      { id: "bank-fr-rhone", name: "Рона Финанс", spreadBps: 245, capitalRatioBps: 1_020, liquidityRatioBps: 1_280 },
    ],
    companies: [
      { name: "Париж Сервис", cityId: "paris", goodId: "services", industry: "услуги", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Лион Материаль", cityId: "lyon", goodId: "materials", industry: "промышленность", representationTier: "B", sizeClass: "medium", listed: false },
      { name: "Тулуза Аэро", cityId: "toulouse", goodId: "goods", industry: "авиация", representationTier: "B", sizeClass: "large", listed: false },
    ],
  },
  {
    countryId: "gb", currencyId: "GBP", governmentName: "Правительство Великобритании", centralBankName: "Банк Англии",
    exchangeName: "Лондонская биржа", exchangeShortName: "LSE", brokerName: "Crown Markets",
    banks: [
      { id: "bank-gb-crown", name: "Краун Банк", spreadBps: 225, capitalRatioBps: 1_050, liquidityRatioBps: 1_320 },
      { id: "bank-gb-mersey", name: "Мерси Банк", spreadBps: 255, capitalRatioBps: 980, liquidityRatioBps: 1_280 },
    ],
    companies: [
      { name: "Лондон Капитал", cityId: "london", goodId: "services", industry: "финансы", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Манчестер Воркс", cityId: "manchester", goodId: "goods", industry: "промышленность", representationTier: "B", sizeClass: "medium", listed: false },
      { name: "Эдинбург Аналитика", cityId: "edinburgh", goodId: "services", industry: "услуги", representationTier: "B", sizeClass: "medium", listed: false },
    ],
  },
  {
    countryId: "us", currencyId: "USD", governmentName: "Правительство США", centralBankName: "Федеральная резервная система",
    exchangeName: "Нью-Йоркская биржа", exchangeShortName: "NYSE", brokerName: "Union Securities",
    banks: [
      { id: "bank-us-union", name: "Юнион Банк", spreadBps: 230, capitalRatioBps: 1_000, liquidityRatioBps: 1_250 },
      { id: "bank-us-lake", name: "Лейк Банк", spreadBps: 265, capitalRatioBps: 960, liquidityRatioBps: 1_220 },
    ],
    companies: [
      { name: "Нью-Йорк Медиа", cityId: "new-york", goodId: "services", industry: "медиа", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Чикаго Индастриз", cityId: "chicago", goodId: "materials", industry: "промышленность", representationTier: "B", sizeClass: "large", listed: false },
      { name: "Бэй Софт", cityId: "san-francisco", goodId: "goods", industry: "технологии", representationTier: "B", sizeClass: "large", listed: false },
    ],
  },
  {
    countryId: "jp", currencyId: "JPY", governmentName: "Правительство Японии", centralBankName: "Банк Японии",
    exchangeName: "Токийская биржа", exchangeShortName: "TSE", brokerName: "Sakura Securities",
    banks: [
      { id: "bank-jp-sakura", name: "Сакура Банк", spreadBps: 180, capitalRatioBps: 1_050, liquidityRatioBps: 1_400 },
      { id: "bank-jp-kansai", name: "Кансай Банк", spreadBps: 205, capitalRatioBps: 1_020, liquidityRatioBps: 1_360 },
    ],
    companies: [
      { name: "Токио Электроникс", cityId: "tokyo", goodId: "goods", industry: "электроника", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Осака Трейд", cityId: "osaka", goodId: "food", industry: "торговля", representationTier: "B", sizeClass: "medium", listed: false },
      { name: "Нагоя Мотор", cityId: "nagoya", goodId: "materials", industry: "автомобили", representationTier: "B", sizeClass: "large", listed: false },
    ],
  },
  {
    countryId: "ca", currencyId: "CAD", governmentName: "Правительство Канады", centralBankName: "Банк Канады",
    exchangeName: "Торонтская биржа", exchangeShortName: "TSX", brokerName: "Maple Invest",
    banks: [
      { id: "bank-ca-maple", name: "Мейпл Банк", spreadBps: 235, capitalRatioBps: 1_030, liquidityRatioBps: 1_320 },
      { id: "bank-ca-pacific", name: "Пасифик Банк", spreadBps: 260, capitalRatioBps: 990, liquidityRatioBps: 1_280 },
    ],
    companies: [
      { name: "Торонто Финанс", cityId: "toronto", goodId: "services", industry: "финансы", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Ванкувер Порт", cityId: "vancouver", goodId: "materials", industry: "логистика", representationTier: "B", sizeClass: "medium", listed: false },
      { name: "Монреаль Аэро", cityId: "montreal", goodId: "goods", industry: "авиация", representationTier: "B", sizeClass: "large", listed: false },
    ],
  },
  {
    countryId: "it", currencyId: "EUR", governmentName: "Правительство Италии", centralBankName: "Банк Италии",
    exchangeName: "Итальянская биржа", exchangeShortName: "BIT", brokerName: "Mercato Italia",
    banks: [
      { id: "bank-it-lombardy", name: "Ломбардия Банк", spreadBps: 255, capitalRatioBps: 980, liquidityRatioBps: 1_260 },
      { id: "bank-it-tiber", name: "Тибр Банк", spreadBps: 285, capitalRatioBps: 940, liquidityRatioBps: 1_220 },
    ],
    companies: [
      { name: "Милано Дизайн", cityId: "milan", goodId: "goods", industry: "мода", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Рома Сервизи", cityId: "rome", goodId: "services", industry: "туризм", representationTier: "B", sizeClass: "medium", listed: false },
      { name: "Торино Мотор", cityId: "turin", goodId: "materials", industry: "автомобили", representationTier: "B", sizeClass: "large", listed: false },
    ],
  },
  {
    countryId: "es", currencyId: "EUR", governmentName: "Правительство Испании", centralBankName: "Банк Испании",
    exchangeName: "Мадридская биржа", exchangeShortName: "BME", brokerName: "Iberia Valores",
    banks: [
      { id: "bank-es-iberia", name: "Иберия Банк", spreadBps: 265, capitalRatioBps: 970, liquidityRatioBps: 1_250 },
      { id: "bank-es-med", name: "Медитерранео Банк", spreadBps: 290, capitalRatioBps: 950, liquidityRatioBps: 1_220 },
    ],
    companies: [
      { name: "Мадрид Системас", cityId: "madrid", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Барселона Порт", cityId: "barcelona", goodId: "materials", industry: "логистика", representationTier: "B", sizeClass: "medium", listed: false },
      { name: "Валенсия Фуд", cityId: "valencia", goodId: "food", industry: "агропромышленность", representationTier: "B", sizeClass: "medium", listed: false },
    ],
  },
  {
    countryId: "nl", currencyId: "EUR", governmentName: "Правительство Нидерландов", centralBankName: "Банк Нидерландов",
    exchangeName: "Амстердамская биржа", exchangeShortName: "AMS", brokerName: "Delta Markets",
    banks: [
      { id: "bank-nl-delta", name: "Дельта Банк", spreadBps: 215, capitalRatioBps: 1_040, liquidityRatioBps: 1_360 },
      { id: "bank-nl-harbor", name: "Харбор Банк", spreadBps: 240, capitalRatioBps: 1_010, liquidityRatioBps: 1_320 },
    ],
    companies: [
      { name: "Амстердам Финтех", cityId: "amsterdam", goodId: "services", industry: "финансы", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Роттердам Энерджи", cityId: "rotterdam", goodId: "energy", industry: "энергетика", representationTier: "B", sizeClass: "large", listed: false },
      { name: "Эйндховен Лабс", cityId: "eindhoven", goodId: "goods", industry: "технологии", representationTier: "B", sizeClass: "medium", listed: false },
    ],
  },
  {
    countryId: "kr", currencyId: "KRW", governmentName: "Правительство Республики Корея", centralBankName: "Банк Кореи",
    exchangeName: "Корейская биржа", exchangeShortName: "KRX", brokerName: "Han River Securities",
    banks: [
      { id: "bank-kr-han", name: "Хан Банк", spreadBps: 220, capitalRatioBps: 1_030, liquidityRatioBps: 1_340 },
      { id: "bank-kr-busan", name: "Пусан Банк", spreadBps: 250, capitalRatioBps: 990, liquidityRatioBps: 1_300 },
    ],
    companies: [
      { name: "Сеул Диджитал", cityId: "seoul", goodId: "goods", industry: "электроника", representationTier: "A", sizeClass: "large", listed: true },
      { name: "Пусан Марин", cityId: "busan", goodId: "materials", industry: "логистика", representationTier: "B", sizeClass: "large", listed: false },
      { name: "Инчхон Энерджи", cityId: "incheon", goodId: "energy", industry: "энергетика", representationTier: "B", sizeClass: "medium", listed: false },
    ],
  },
];

const MARKET_EXPANSION: Record<string, CountryCompanySeed[]> = {
  ru: [
    { name: "Волга Телеком", cityId: "kazan", goodId: "services", industry: "телекоммуникации", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Балтика Ритейл", cityId: "saint-petersburg", goodId: "goods", industry: "розничная торговля", representationTier: "A", sizeClass: "large", listed: true },
    { name: "МосТех", cityId: "moscow", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Кама Машины", cityId: "kazan", goodId: "materials", industry: "машиностроение", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  de: [
    { name: "Rhein Energie", cityId: "hamburg", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Bavaria Cloud", cityId: "munich", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Nord Handel", cityId: "hamburg", goodId: "goods", industry: "торговля", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Spree Media", cityId: "berlin", goodId: "services", industry: "медиа", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  fr: [
    { name: "Hexagone Luxe", cityId: "paris", goodId: "goods", industry: "предметы роскоши", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Rhone Energie", cityId: "lyon", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Seine Numerique", cityId: "paris", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Occitanie Food", cityId: "toulouse", goodId: "food", industry: "продовольствие", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  gb: [
    { name: "Albion Energy", cityId: "edinburgh", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Thames Digital", cityId: "london", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Northern Retail", cityId: "manchester", goodId: "goods", industry: "торговля", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Caledonia Labs", cityId: "edinburgh", goodId: "services", industry: "исследования", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  us: [
    { name: "Pacific Compute", cityId: "san-francisco", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Great Lakes Energy", cityId: "chicago", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Union Consumer", cityId: "new-york", goodId: "goods", industry: "потребительские товары", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Bay Research", cityId: "san-francisco", goodId: "services", industry: "исследования", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  jp: [
    { name: "Kansai Robotics", cityId: "osaka", goodId: "goods", industry: "робототехника", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Nippon Energy", cityId: "tokyo", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Chubu Materials", cityId: "nagoya", goodId: "materials", industry: "материалы", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Sakura Media", cityId: "tokyo", goodId: "services", industry: "медиа", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  ca: [
    { name: "Maple Energy", cityId: "toronto", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Pacific Digital", cityId: "vancouver", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Quebec Consumer", cityId: "montreal", goodId: "goods", industry: "потребительские товары", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Ontario Foods", cityId: "toronto", goodId: "food", industry: "продовольствие", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  it: [
    { name: "Lombardia Energia", cityId: "milan", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Italia Digitale", cityId: "milan", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Tirreno Food", cityId: "rome", goodId: "food", industry: "продовольствие", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Piemonte Labs", cityId: "turin", goodId: "services", industry: "исследования", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  es: [
    { name: "Iberia Energia", cityId: "madrid", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Catalunya Digital", cityId: "barcelona", goodId: "services", industry: "технологии", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Levante Retail", cityId: "valencia", goodId: "goods", industry: "торговля", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Castilla Foods", cityId: "madrid", goodId: "food", industry: "продовольствие", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  nl: [
    { name: "Delta Energy", cityId: "rotterdam", goodId: "energy", industry: "энергетика", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Holland Chips", cityId: "eindhoven", goodId: "goods", industry: "электроника", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Canal Commerce", cityId: "amsterdam", goodId: "services", industry: "торговля", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Lowlands Food", cityId: "rotterdam", goodId: "food", industry: "продовольствие", representationTier: "B", sizeClass: "medium", listed: false },
  ],
  kr: [
    { name: "Han Semiconductor", cityId: "seoul", goodId: "goods", industry: "полупроводники", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Korea Mobility", cityId: "incheon", goodId: "materials", industry: "автомобили", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Busan Retail", cityId: "busan", goodId: "food", industry: "торговля", representationTier: "A", sizeClass: "large", listed: true },
    { name: "Seoul Media Lab", cityId: "seoul", goodId: "services", industry: "медиа", representationTier: "B", sizeClass: "medium", listed: false },
  ],
};

export const COUNTRY_ECONOMY_PACKS: CountryEconomyPack[] = BASE_COUNTRY_ECONOMY_PACKS.map((pack) => ({
  ...pack,
  companies: [...pack.companies, ...(MARKET_EXPANSION[pack.countryId] ?? [])],
}));

export function packForCountry(countryId: string): CountryEconomyPack {
  const pack = COUNTRY_ECONOMY_PACKS.find((item) => item.countryId === countryId);
  if (!pack) throw new Error(`Нет экономического набора для страны ${countryId}`);
  return pack;
}
