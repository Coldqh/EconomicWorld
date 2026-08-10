import type {
  City,
  ConsumptionCategory,
  FirmCohort,
  PopulationCohort,
  SkillId,
} from "../domain/model.ts";

const SKILLS: SkillId[] = ["economics", "accounting", "finance", "statistics", "programming", "dataAnalysis", "communication", "management"];
const CATEGORIES: ConsumptionCategory[] = ["food", "housing", "energy", "transport", "services", "goods", "education", "entertainment", "luxury"];

const COHORT_PROFILES = [
  { ageBand: "18-24", education: "secondary", family: "services", income: "low", household: "single", share: 1_700, employed: 6_800 },
  { ageBand: "25-34", education: "bachelor", family: "software", income: "middle", household: "couple", share: 2_650, employed: 9_100 },
  { ageBand: "35-49", education: "bachelor", family: "management", income: "high", household: "family", share: 3_250, employed: 9_300 },
  { ageBand: "50-64", education: "secondary", family: "production", income: "middle", household: "family", share: 2_400, employed: 7_900 },
] as const;

function consumptionProfile(profileIndex: number): Record<ConsumptionCategory, number> {
  const base = [2_400, 2_300, 900, 950, 950, 900, 550, 700, 350];
  const adjusted = base.map((value, index) => value + ((profileIndex * 137 + index * 71) % 180) - 90);
  const total = adjusted.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(CATEGORIES.map((category, index) => [category, Math.round(adjusted[index] * 10_000 / total)])) as Record<ConsumptionCategory, number>;
}

export function createPopulationCohorts(cities: readonly City[], bankIds: readonly string[]): PopulationCohort[] {
  return cities.flatMap((city, cityIndex) => COHORT_PROFILES.map((profile, profileIndex): PopulationCohort => {
    const populationCount = Math.max(1, Math.round(city.population * profile.share / 10_000));
    const incomeMultiplier = profile.income === "low" ? 0.62 : profile.income === "middle" ? 1 : 1.72;
    const averageMonthlyIncomeCents = Math.round(city.baseMonthlyWageCents * incomeMultiplier);
    return {
      id: `population-${city.id}-${profileIndex + 1}`,
      countryId: city.countryId,
      cityId: city.id,
      bankId: bankIds[(cityIndex + profileIndex) % bankIds.length],
      ageBand: profile.ageBand,
      education: profile.education,
      occupationFamily: profile.family,
      incomeBand: profile.income,
      householdType: profile.household,
      populationCount,
      employedCount: Math.round(populationCount * profile.employed / 10_000),
      averageMonthlyIncomeCents,
      wealthDistribution: { medianCents: averageMonthlyIncomeCents * (profileIndex + 2), p90Cents: averageMonthlyIncomeCents * (profileIndex + 7) },
      skillDistribution: Object.fromEntries(SKILLS.map((skill, skillIndex) => [skill, { mean: 1_000 + profileIndex * 550 + (skillIndex % 3) * 120, spread: 450 + profileIndex * 90 }])) as PopulationCohort["skillDistribution"],
      consumptionPreferencesBps: consumptionProfile(profileIndex),
      housingDistributionBps: { rent: 5_500 - profileIndex * 700, own: 3_200 + profileIndex * 600, family: 1_300 + profileIndex * 100 },
      bankingDistributionBps: Object.fromEntries(bankIds.map((bankId, index) => [bankId, index === (cityIndex + profileIndex) % bankIds.length ? 7_200 : 2_800])),
      lastConsumptionCents: 0,
      lastIncomeCents: 0,
    };
  }));
}

export function createFirmCohorts(cities: readonly City[], bankIds: readonly string[]): FirmCohort[] {
  return cities.flatMap((city, cityIndex) => city.majorIndustries.map((industry, industryIndex): FirmCohort => {
    const firmCount = Math.max(120, Math.round(city.population / (2_300 + industryIndex * 500)));
    const employment = Math.round(firmCount * (5 + industryIndex * 7));
    const monthlyRevenue = Math.round(employment * city.baseMonthlyWageCents * (1.55 + industryIndex * 0.18) / 10_000);
    return {
      id: `firms-${city.id}-${industryIndex + 1}`,
      countryId: city.countryId,
      cityId: city.id,
      bankId: bankIds[(cityIndex + industryIndex) % bankIds.length],
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
      productivityBps: 8_600 + (cityIndex % 7) * 180 + industryIndex * 250,
    };
  }));
}
