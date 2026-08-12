import type {
  Bank,
  City,
  ConsumptionCategory,
  CountryEconomicProfile,
  FirmCohort,
  PopulationCohort,
  SkillId,
} from "../domain/model.ts";

const SKILLS: SkillId[] = ["economics", "accounting", "finance", "statistics", "programming", "dataAnalysis", "communication", "management"];

const COHORT_PROFILES = [
  { ageBand: "18-24", education: "secondary", family: "services", income: "low", household: "single", share: 1_700, employed: 6_800, incomeMultiplier: 6_200, savingsAdjustment: -900, creditAccess: 5_000, priceSensitivity: 9_300 },
  { ageBand: "25-34", education: "bachelor", family: "software", income: "middle", household: "couple", share: 2_650, employed: 9_100, incomeMultiplier: 10_000, savingsAdjustment: -100, creditAccess: 7_800, priceSensitivity: 8_200 },
  { ageBand: "35-49", education: "bachelor", family: "management", income: "affluent", household: "family", share: 3_250, employed: 9_300, incomeMultiplier: 15_500, savingsAdjustment: 700, creditAccess: 9_100, priceSensitivity: 6_900 },
  { ageBand: "50-64", education: "secondary", family: "production", income: "wealthy", household: "family", share: 2_400, employed: 7_900, incomeMultiplier: 21_000, savingsAdjustment: 1_500, creditAccess: 9_600, priceSensitivity: 5_500 },
] as const;

const CONSUMPTION_PROFILES: Record<(typeof COHORT_PROFILES)[number]["income"], Record<ConsumptionCategory, number>> = {
  low: { food: 2_700, housing: 2_800, energy: 1_050, transport: 900, services: 700, goods: 650, education: 400, entertainment: 600, luxury: 200 },
  middle: { food: 2_250, housing: 2_500, energy: 850, transport: 1_000, services: 900, goods: 850, education: 600, entertainment: 750, luxury: 300 },
  affluent: { food: 1_750, housing: 2_200, energy: 650, transport: 1_000, services: 1_150, goods: 950, education: 850, entertainment: 950, luxury: 500 },
  wealthy: { food: 1_300, housing: 1_900, energy: 500, transport: 950, services: 1_350, goods: 900, education: 1_000, entertainment: 1_100, luxury: 1_000 },
};

export function createPopulationCohorts(cities: readonly City[], banks: readonly Bank[], profiles: readonly CountryEconomicProfile[]): PopulationCohort[] {
  return cities.flatMap((city) => COHORT_PROFILES.map((profile, profileIndex): PopulationCohort => {
    const country = profiles.find((item) => item.countryId === city.countryId)!;
    const localBanks = banks.filter((bank) => bank.countryId === city.countryId);
    const populationCount = Math.max(1, Math.round(city.population * profile.share / 10_000));
    const averageMonthlyIncomeCents = Math.round(city.baseMonthlyWageCents * profile.incomeMultiplier / 10_000);
    const medianWealth = averageMonthlyIncomeCents * (profileIndex === 0 ? 2 : profileIndex === 1 ? 8 : profileIndex === 2 ? 22 : 48);
    const primaryBank = localBanks[profileIndex < 2 ? 0 : Math.min(1, localBanks.length - 1)] ?? banks[0];
    const bankWeights = Object.fromEntries(localBanks.map((bank) => [bank.id, bank.id === primaryBank.id ? 7_200 : Math.round(2_800 / Math.max(1, localBanks.length - 1))]));
    return {
      id: `population-${city.id}-${profileIndex + 1}`,
      countryId: city.countryId,
      cityId: city.id,
      bankId: primaryBank.id,
      ageBand: profile.ageBand,
      education: profile.education,
      occupationFamily: profile.family,
      incomeBand: profile.income,
      householdType: profile.household,
      populationCount,
      employedCount: Math.round(populationCount * (10_000 - country.unemploymentBps) / 10_000),
      averageMonthlyIncomeCents,
      wealthDistribution: { medianCents: medianWealth, p90Cents: medianWealth * (profileIndex + 3) },
      skillDistribution: Object.fromEntries(SKILLS.map((skill, skillIndex) => [skill, { mean: 1_000 + profileIndex * 550 + (skillIndex % 3) * 120, spread: 450 + profileIndex * 90 }])) as PopulationCohort["skillDistribution"],
      consumptionPreferencesBps: { ...CONSUMPTION_PROFILES[profile.income] },
      housingDistributionBps: { rent: 5_500 - profileIndex * 700, own: 3_200 + profileIndex * 600, family: 1_300 + profileIndex * 100 },
      bankingDistributionBps: bankWeights,
      aggregateWealthCents: medianWealth * populationCount,
      aggregateDebtCents: Math.round(averageMonthlyIncomeCents * 12 * populationCount * country.householdDebtToGdpBps / 10_000),
      creditAccessBps: Math.min(10_000, Math.round(profile.creditAccess * country.bankingDepthBps / 10_000)),
      savingsRateBps: Math.max(0, country.savingsRateBps + profile.savingsAdjustment),
      priceSensitivityBps: profile.priceSensitivity,
      durableStock: { installedUnits: Math.round(populationCount * (2_500 + profileIndex * 1_200) / 10_000), averageAgeMonths: 34 + profileIndex * 6, replacementRateBps: 450 + profileIndex * 80, premiumShareBps: 800 + profileIndex * 1_400 },
      lastConsumptionCents: 0,
      lastIncomeCents: 0,
    };
  }));
}

export function createFirmCohorts(cities: readonly City[], banks: readonly Bank[], profiles: readonly CountryEconomicProfile[]): FirmCohort[] {
  return cities.flatMap((city) => city.majorIndustries.map((industry, industryIndex): FirmCohort => {
    const country = profiles.find((item) => item.countryId === city.countryId)!;
    const localBanks = banks.filter((bank) => bank.countryId === city.countryId);
    const firmCount = Math.max(120, Math.round(city.population / (2_300 + industryIndex * 500)));
    const employment = Math.round(firmCount * (5 + industryIndex * 7));
    const monthlyRevenue = Math.round(employment * city.baseMonthlyWageCents * (1.55 + industryIndex * 0.18) / 10_000);
    return {
      id: `firms-${city.id}-${industryIndex + 1}`,
      countryId: city.countryId,
      cityId: city.id,
      bankId: (localBanks[industryIndex < 2 ? 0 : Math.min(1, localBanks.length - 1)] ?? banks[0]).id,
      industry,
      sizeBucket: industryIndex === 0 ? "micro" : industryIndex === 1 ? "small" : "medium",
      firmCount,
      employment,
      revenueCents: monthlyRevenue,
      capitalCents: monthlyRevenue * (12 + industryIndex * 5),
      debtCents: monthlyRevenue * (2 + industryIndex),
      productionMilliUnits: employment * (850 + industryIndex * 130),
      inventoryMilliUnits: employment * (180 + industryIndex * 50),
      profitsCents: Math.round(monthlyRevenue * 0.09),
      productivityBps: Math.round(country.productivityIndexBps * (9_300 + industryIndex * 350) / 10_000),
      populationEquivalent: Math.max(1, Math.round(city.population / Math.max(1, city.majorIndustries.length))),
      firmCountEquivalent: firmCount,
      outputScaleBps: 10_000,
      valueAddedMinor: Math.round(monthlyRevenue * 0.52),
      intermediateConsumptionMinor: Math.round(monthlyRevenue * 0.48),
    };
  }));
}
