import type {
  City,
  Country,
  HousingCohort,
  ProductDefinition,
  University,
  UniversityProgram,
} from "../domain/model.ts";

type CitySeed = readonly [string, string, string, number, number, number, number, readonly string[]];

const COUNTRY_SEEDS = [
  ["ru", "Россия", "RUB", "Континентальное право", "Федеральная налоговая система"],
  ["de", "Германия", "EUR", "Право ЕС", "Федеральная налоговая система"],
  ["fr", "Франция", "EUR", "Право ЕС", "Национальная налоговая система"],
  ["gb", "Великобритания", "GBP", "Общее право", "Национальная налоговая система"],
  ["us", "США", "USD", "Общее право", "Федеральная налоговая система"],
  ["jp", "Япония", "JPY", "Континентальное право", "Национальная налоговая система"],
  ["ca", "Канада", "CAD", "Общее право", "Федеральная налоговая система"],
  ["it", "Италия", "EUR", "Право ЕС", "Национальная налоговая система"],
  ["es", "Испания", "EUR", "Право ЕС", "Региональная налоговая система"],
  ["nl", "Нидерланды", "EUR", "Право ЕС", "Национальная налоговая система"],
  ["kr", "Республика Корея", "KRW", "Континентальное право", "Национальная налоговая система"],
] as const;

const CITY_SEEDS: CitySeed[] = [
  ["moscow", "ru", "Москва", 55.7558, 37.6173, 13_100_000, 92_000_00, ["финансы", "технологии", "услуги"]],
  ["saint-petersburg", "ru", "Санкт-Петербург", 59.9343, 30.3351, 5_600_000, 72_000_00, ["логистика", "промышленность", "технологии"]],
  ["kazan", "ru", "Казань", 55.7961, 49.1064, 1_350_000, 61_000_00, ["промышленность", "образование", "технологии"]],
  ["berlin", "de", "Берлин", 52.52, 13.405, 3_700_000, 310_000_00, ["технологии", "услуги", "образование"]],
  ["munich", "de", "Мюнхен", 48.1351, 11.582, 1_600_000, 385_000_00, ["автомобили", "финансы", "технологии"]],
  ["hamburg", "de", "Гамбург", 53.5511, 9.9937, 1_900_000, 325_000_00, ["логистика", "промышленность", "услуги"]],
  ["paris", "fr", "Париж", 48.8566, 2.3522, 2_150_000, 350_000_00, ["финансы", "услуги", "предметы роскоши"]],
  ["lyon", "fr", "Лион", 45.764, 4.8357, 530_000, 285_000_00, ["промышленность", "медицина", "услуги"]],
  ["toulouse", "fr", "Тулуза", 43.6047, 1.4442, 510_000, 275_000_00, ["авиация", "технологии", "образование"]],
  ["london", "gb", "Лондон", 51.5072, -0.1276, 8_900_000, 410_000_00, ["финансы", "технологии", "услуги"]],
  ["manchester", "gb", "Манчестер", 53.4808, -2.2426, 570_000, 285_000_00, ["промышленность", "медиа", "технологии"]],
  ["edinburgh", "gb", "Эдинбург", 55.9533, -3.1883, 510_000, 305_000_00, ["финансы", "образование", "услуги"]],
  ["new-york", "us", "Нью-Йорк", 40.7128, -74.006, 8_300_000, 520_000_00, ["финансы", "медиа", "услуги"]],
  ["chicago", "us", "Чикаго", 41.8781, -87.6298, 2_700_000, 405_000_00, ["логистика", "финансы", "промышленность"]],
  ["san-francisco", "us", "Сан-Франциско", 37.7749, -122.4194, 810_000, 620_000_00, ["технологии", "финансы", "исследования"]],
  ["tokyo", "jp", "Токио", 35.6762, 139.6503, 14_000_000, 335_000_00, ["финансы", "технологии", "услуги"]],
  ["osaka", "jp", "Осака", 34.6937, 135.5023, 2_750_000, 285_000_00, ["промышленность", "торговля", "услуги"]],
  ["nagoya", "jp", "Нагоя", 35.1815, 136.9066, 2_330_000, 295_000_00, ["автомобили", "промышленность", "логистика"]],
  ["toronto", "ca", "Торонто", 43.6532, -79.3832, 2_950_000, 390_000_00, ["финансы", "технологии", "услуги"]],
  ["vancouver", "ca", "Ванкувер", 49.2827, -123.1207, 680_000, 365_000_00, ["логистика", "медиа", "технологии"]],
  ["montreal", "ca", "Монреаль", 45.5019, -73.5674, 1_800_000, 335_000_00, ["авиация", "технологии", "образование"]],
  ["milan", "it", "Милан", 45.4642, 9.19, 1_370_000, 290_000_00, ["финансы", "мода", "промышленность"]],
  ["rome", "it", "Рим", 41.9028, 12.4964, 2_750_000, 255_000_00, ["услуги", "туризм", "государство"]],
  ["turin", "it", "Турин", 45.0703, 7.6869, 850_000, 245_000_00, ["автомобили", "промышленность", "исследования"]],
  ["madrid", "es", "Мадрид", 40.4168, -3.7038, 3_300_000, 270_000_00, ["финансы", "услуги", "технологии"]],
  ["barcelona", "es", "Барселона", 41.3874, 2.1686, 1_650_000, 265_000_00, ["логистика", "туризм", "технологии"]],
  ["valencia", "es", "Валенсия", 39.4699, -0.3763, 810_000, 220_000_00, ["логистика", "промышленность", "туризм"]],
  ["amsterdam", "nl", "Амстердам", 52.3676, 4.9041, 920_000, 360_000_00, ["финансы", "технологии", "услуги"]],
  ["rotterdam", "nl", "Роттердам", 51.9244, 4.4777, 670_000, 320_000_00, ["логистика", "энергетика", "промышленность"]],
  ["eindhoven", "nl", "Эйндховен", 51.4416, 5.4697, 245_000, 335_000_00, ["технологии", "исследования", "промышленность"]],
  ["seoul", "kr", "Сеул", 37.5665, 126.978, 9_400_000, 365_000_00, ["электроника", "финансы", "технологии"]],
  ["busan", "kr", "Пусан", 35.1796, 129.0756, 3_300_000, 295_000_00, ["логистика", "судостроение", "промышленность"]],
  ["incheon", "kr", "Инчхон", 37.4563, 126.7052, 3_000_000, 305_000_00, ["логистика", "энергетика", "технологии"]],
];

const UNIVERSITY_SEEDS = [
  ["hse", "Национальный исследовательский университет «Высшая школа экономики»", "НИУ ВШЭ", "university", "moscow", 9_100],
  ["mipt", "Московский физико-технический институт", "МФТИ", "institute", "moscow", 9_400],
  ["spbu", "Санкт-Петербургский государственный университет", "СПбГУ", "university", "saint-petersburg", 9_200],
  ["tum", "Мюнхенский технический университет", "TUM", "university", "munich", 9_450],
  ["sorbonne", "Университет Сорбонна", "Сорбонна", "university", "paris", 9_300],
  ["ucl", "Университетский колледж Лондона", "UCL", "university", "london", 9_500],
  ["columbia", "Колумбийский университет", "Колумбия", "university", "new-york", 9_650],
  ["tokyo-u", "Токийский университет", "UTokyo", "university", "tokyo", 9_600],
  ["uoft", "Торонтский университет", "U of T", "university", "toronto", 9_400],
  ["polimi", "Миланский политехнический институт", "Polimi", "institute", "milan", 9_050],
  ["upm", "Мадридский политехнический университет", "UPM", "university", "madrid", 8_850],
  ["tue", "Эйндховенский технический университет", "TU/e", "university", "eindhoven", 9_200],
] as const;

const PROGRAM_TEMPLATES = [
  ["economics", "Экономика", "bachelor", 48, 180_000_00, "economics", 1_250, "statistics", 900],
  ["software", "Программная инженерия", "bachelor", 48, 220_000_00, "programming", 1_100, "dataAnalysis", 850],
  ["finance", "Финансы и управление", "master", 24, 320_000_00, "finance", 1_600, "management", 1_100],
] as const;

export function createCountries(): Country[] {
  return COUNTRY_SEEDS.map(([id, name, currencyReference, legalProfile, taxContext]) => ({
    id,
    name,
    currencyReference,
    legalProfile,
    taxContext,
    cityIds: CITY_SEEDS.filter((city) => city[1] === id).map((city) => city[0]),
    companyIds: [],
    bankIds: [],
    universityIds: [],
    governmentId: `government-${id}`,
    centralBankId: `central-bank-${id}`,
    exchangeIds: [`exchange-${id}`],
    industries: [...new Set(CITY_SEEDS.filter((city) => city[1] === id).flatMap((city) => city[7]))],
  }));
}

export function createCities(goods: readonly { id: string; basePriceCents: number }[]): City[] {
  return CITY_SEEDS.map(([id, countryId, name, latitude, longitude, population, wage, industries], index) => ({
    id,
    countryId,
    name,
    latitude,
    longitude,
    population,
    baseMonthlyWageCents: wage,
    transportCostPerKmCents: 16 + (index % 5) * 3,
    logisticsCapacityMilliUnits: 2_000_000 + population * 3,
    localPriceByGoodCents: Object.fromEntries(goods.map((good, goodIndex) => [good.id, Math.round(good.basePriceCents * (0.82 + (index % 7) * 0.055 + goodIndex * 0.008))])),
    medianIncomeCents: wage,
    employmentBps: 8_900 - (index % 6) * 130,
    costOfLivingCents: Math.round(wage * (0.62 + (index % 5) * 0.035)),
    housingVacancyBps: 450 + (index % 8) * 90,
    majorIndustries: [...industries],
    universityIds: UNIVERSITY_SEEDS.filter((university) => university[4] === id).map((university) => university[0]),
  }));
}

export function createUniversities(bankIds: readonly string[]): { universities: University[]; programs: UniversityProgram[] } {
  const programs: UniversityProgram[] = [];
  const universities = UNIVERSITY_SEEDS.map(([id, name, shortName, type, cityId, reputationBps], universityIndex): University => {
    const templates = universityIndex % 3 === 0 ? PROGRAM_TEMPLATES : PROGRAM_TEMPLATES.slice(0, 2);
    const programIds = templates.map((template, templateIndex) => {
      const [suffix, programName, degree, durationMonths, tuition, requiredSkill, requiredScore, outcomeSkill, outcomeScore] = template;
      const programId = `${id}-${suffix}`;
      const capacity = 120 + ((universityIndex + templateIndex) % 5) * 45;
      programs.push({
        id: programId,
        universityId: id,
        name: programName,
        degree,
        durationMonths,
        tuitionPerYearCents: Math.round(tuition * (0.8 + (universityIndex % 5) * 0.12)),
        capacity,
        occupiedSeats: Math.min(capacity - 5, 70 + ((universityIndex * 13 + templateIndex * 31) % 80)),
        minimumEducation: degree === "master" ? "bachelor" : "secondary",
        requiredSkills: { [requiredSkill]: requiredScore },
        skillOutcomes: { [requiredSkill]: requiredScore + 1_300, [outcomeSkill]: outcomeScore + 1_100 },
        specialization: suffix,
      });
      return programId;
    });
    return {
      id,
      name,
      shortName,
      type,
      cityId,
      bankId: bankIds[universityIndex % bankIds.length],
      reputationBps,
      teachingQualityBps: reputationBps - 250 + (universityIndex % 4) * 100,
      programIds,
      studentPopulation: 8_000 + universityIndex * 1_850,
    };
  });
  return { universities, programs };
}

export function createHousingCohorts(cities: readonly City[]): HousingCohort[] {
  return cities.flatMap((city, index) => {
    const monthlyBase = Math.round(city.costOfLivingCents * 0.42);
    const unitBase = Math.max(1_500, Math.round(city.population / 2_800));
    return [
      { id: `housing-${city.id}-rent`, cityId: city.id, type: "rental-apartment" as const, qualityBps: 6_600, averageSizeSqm: 46, totalUnits: unitBase, availableUnits: Math.round(unitBase * city.housingVacancyBps / 10_000), monthlyRentCents: monthlyBase, salePriceCents: monthlyBase * 190, constructionCostCents: monthlyBase * 135, ownerSectorId: `housing-sector:${city.id}` },
      { id: `housing-${city.id}-owned`, cityId: city.id, type: "owned-apartment" as const, qualityBps: 7_800, averageSizeSqm: 68, totalUnits: Math.round(unitBase * 0.7), availableUnits: Math.max(2, Math.round(unitBase * city.housingVacancyBps / 15_000)), monthlyRentCents: Math.round(monthlyBase * 1.35), salePriceCents: monthlyBase * (225 + index % 4 * 12), constructionCostCents: monthlyBase * 160, ownerSectorId: `housing-sector:${city.id}` },
      { id: `housing-${city.id}-house`, cityId: city.id, type: "house" as const, qualityBps: 8_400, averageSizeSqm: 128, totalUnits: Math.round(unitBase * 0.25), availableUnits: Math.max(1, Math.round(unitBase * city.housingVacancyBps / 32_000)), monthlyRentCents: monthlyBase * 2, salePriceCents: monthlyBase * 390, constructionCostCents: monthlyBase * 275, ownerSectorId: `housing-sector:${city.id}` },
    ];
  });
}

export function createProducts(): ProductDefinition[] {
  const seeds = [
    ["phone-nova", "phone", "Nova One", "Nova", 95_000_00, 8_100, 48, 6_800, 1_100_00, 8_300, "jp", "company-007"],
    ["computer-axis", "computer", "Axis Pro", "Axis", 180_000_00, 8_700, 72, 7_200, 1_800_00, 8_000, "us", "company-008"],
    ["furniture-dom", "furniture", "Дом Base", "Дом", 140_000_00, 7_600, 120, 4_900, 900_00, 7_400, "ru", "company-007"],
    ["car-vector", "car", "Vector S", "Vector", 2_400_000_00, 8_300, 144, 7_800, 22_000_00, 7_900, "de", "company-008"],
    ["watch-meridian", "watch", "Meridian 24", "Meridian", 320_000_00, 8_900, 180, 8_800, 1_500_00, 9_100, "nl", "company-007"],
  ] as const;
  return seeds.map(([id, category, name, brand, priceCents, qualityBps, durabilityMonths, prestigeBps, operatingCostCents, energyEfficiencyBps, originCountryId, sellerId]) => ({ id, category, name, brand, priceCents, qualityBps, durabilityMonths, prestigeBps, operatingCostCents, energyEfficiencyBps, originCountryId, sellerId }));
}
