import type { CountryEconomicProfile, MonetaryAreaEconomicProfile } from "../domain/model.ts";

type ProfileSeed = Omit<CountryEconomicProfile, "baseYear" | "baselineRealGdpIndexBps" | "metadata">;

const calibrated = (seed: ProfileSeed): CountryEconomicProfile => ({
  ...seed,
  baselineNominalGdpMinor: seed.baselineNominalGdpMinor * 100,
  baseYear: 2024,
  baselineRealGdpIndexBps: 10_000,
  metadata: {
    sourceType: "CALIBRATED",
    baseYear: 2024,
    sourceNote: "Стартовая точка симуляции; округлённая калибровка, а не оперативная статистика.",
  },
});

const industries = (services: number, industry: number, technology: number, resources: number) => ({ services, industry, technology, resources });

export const COUNTRY_ECONOMIC_PROFILES: CountryEconomicProfile[] = [
  calibrated({ countryId: "ru", population: 146_000_000, workingAgeShareBps: 6_600, populationGrowthBps: -20, dependencyRatioBps: 5_200, baselineNominalGdpMinor: 3_300_000, inflationBps: 760, unemploymentBps: 320, governmentDebtToGdpBps: 3_000, budgetBalanceToGdpBps: -180, averageDebtMaturityMonths: 78, monetaryAreaId: "money-area-rub", incomeLevel: "upper-middle", householdDebtToGdpBps: 2_200, privateCreditToGdpBps: 6_000, industryWeightsBps: industries(5_300, 2_500, 650, 1_550), taxProfile: { incomeTaxBps: 1_300, consumptionTaxBps: 1_667, corporateTaxBps: 2_000, propertyTaxBps: 220 }, governmentSpendingShareBps: 3_700, publicInvestmentShareBps: 520, educationSpendingShareBps: 430, savingsRateBps: 1_800, housingCostIndexBps: 7_400, housingVacancyBps: 620, productivityIndexBps: 8_400, bankingDepthBps: 7_100, bankConcentrationBps: 6_800, depositInsuranceCoverageMinor: 1_400_000_00 }),
  calibrated({ countryId: "de", population: 84_400_000, workingAgeShareBps: 6_400, populationGrowthBps: 30, dependencyRatioBps: 5_500, baselineNominalGdpMinor: 4_300_000, inflationBps: 260, unemploymentBps: 330, governmentDebtToGdpBps: 6_900, budgetBalanceToGdpBps: -200, averageDebtMaturityMonths: 84, monetaryAreaId: "money-area-eur", incomeLevel: "high", householdDebtToGdpBps: 5_400, privateCreditToGdpBps: 8_100, industryWeightsBps: industries(6_200, 2_550, 900, 350), taxProfile: { incomeTaxBps: 2_250, consumptionTaxBps: 1_600, corporateTaxBps: 2_980, propertyTaxBps: 360 }, governmentSpendingShareBps: 4_900, publicInvestmentShareBps: 500, educationSpendingShareBps: 470, savingsRateBps: 2_050, housingCostIndexBps: 10_200, housingVacancyBps: 440, productivityIndexBps: 11_400, bankingDepthBps: 10_700, bankConcentrationBps: 4_700, depositInsuranceCoverageMinor: 100_000_00 }),
  calibrated({ countryId: "fr", population: 68_200_000, workingAgeShareBps: 6_300, populationGrowthBps: 20, dependencyRatioBps: 5_900, baselineNominalGdpMinor: 4_050_000, inflationBps: 250, unemploymentBps: 740, governmentDebtToGdpBps: 10_700, budgetBalanceToGdpBps: -500, averageDebtMaturityMonths: 98, monetaryAreaId: "money-area-eur", incomeLevel: "high", householdDebtToGdpBps: 6_300, privateCreditToGdpBps: 10_400, industryWeightsBps: industries(7_050, 1_750, 850, 350), taxProfile: { incomeTaxBps: 2_450, consumptionTaxBps: 1_667, corporateTaxBps: 2_580, propertyTaxBps: 620 }, governmentSpendingShareBps: 5_700, publicInvestmentShareBps: 620, educationSpendingShareBps: 540, savingsRateBps: 2_150, housingCostIndexBps: 10_600, housingVacancyBps: 760, productivityIndexBps: 10_900, bankingDepthBps: 11_200, bankConcentrationBps: 5_600, depositInsuranceCoverageMinor: 100_000_00 }),
  calibrated({ countryId: "gb", population: 68_400_000, workingAgeShareBps: 6_400, populationGrowthBps: 40, dependencyRatioBps: 5_600, baselineNominalGdpMinor: 2_970_000, inflationBps: 330, unemploymentBps: 430, governmentDebtToGdpBps: 10_100, budgetBalanceToGdpBps: -440, averageDebtMaturityMonths: 170, monetaryAreaId: "money-area-gbp", incomeLevel: "high", householdDebtToGdpBps: 8_000, privateCreditToGdpBps: 12_200, industryWeightsBps: industries(7_450, 1_250, 1_050, 250), taxProfile: { incomeTaxBps: 2_100, consumptionTaxBps: 1_667, corporateTaxBps: 2_500, propertyTaxBps: 780 }, governmentSpendingShareBps: 4_500, publicInvestmentShareBps: 540, educationSpendingShareBps: 520, savingsRateBps: 1_450, housingCostIndexBps: 12_400, housingVacancyBps: 330, productivityIndexBps: 10_700, bankingDepthBps: 14_000, bankConcentrationBps: 5_200, depositInsuranceCoverageMinor: 85_000_00 }),
  calibrated({ countryId: "us", population: 336_000_000, workingAgeShareBps: 6_500, populationGrowthBps: 50, dependencyRatioBps: 5_400, baselineNominalGdpMinor: 3_480_000, inflationBps: 310, unemploymentBps: 390, governmentDebtToGdpBps: 12_450, budgetBalanceToGdpBps: -620, averageDebtMaturityMonths: 72, monetaryAreaId: "money-area-usd", incomeLevel: "high", householdDebtToGdpBps: 7_500, privateCreditToGdpBps: 14_000, industryWeightsBps: industries(7_150, 1_350, 1_350, 150), taxProfile: { incomeTaxBps: 1_850, consumptionTaxBps: 650, corporateTaxBps: 2_100, propertyTaxBps: 980 }, governmentSpendingShareBps: 4_300, publicInvestmentShareBps: 450, educationSpendingShareBps: 520, savingsRateBps: 1_250, housingCostIndexBps: 11_800, housingVacancyBps: 620, productivityIndexBps: 12_500, bankingDepthBps: 15_500, bankConcentrationBps: 4_900, depositInsuranceCoverageMinor: 250_000_00 }),
  calibrated({ countryId: "jp", population: 124_000_000, workingAgeShareBps: 5_900, populationGrowthBps: -55, dependencyRatioBps: 7_100, baselineNominalGdpMinor: 5_040_000, inflationBps: 240, unemploymentBps: 260, governmentDebtToGdpBps: 21_800, budgetBalanceToGdpBps: -420, averageDebtMaturityMonths: 108, monetaryAreaId: "money-area-jpy", incomeLevel: "high", householdDebtToGdpBps: 6_900, privateCreditToGdpBps: 17_000, industryWeightsBps: industries(6_650, 2_100, 1_050, 200), taxProfile: { incomeTaxBps: 2_050, consumptionTaxBps: 910, corporateTaxBps: 3_060, propertyTaxBps: 520 }, governmentSpendingShareBps: 4_400, publicInvestmentShareBps: 580, educationSpendingShareBps: 390, savingsRateBps: 2_400, housingCostIndexBps: 9_200, housingVacancyBps: 1_180, productivityIndexBps: 10_200, bankingDepthBps: 18_000, bankConcentrationBps: 4_400, depositInsuranceCoverageMinor: 10_000_000_00 }),
  calibrated({ countryId: "ca", population: 40_800_000, workingAgeShareBps: 6_500, populationGrowthBps: 190, dependencyRatioBps: 5_300, baselineNominalGdpMinor: 5_520_000, inflationBps: 280, unemploymentBps: 610, governmentDebtToGdpBps: 8_460, budgetBalanceToGdpBps: -210, averageDebtMaturityMonths: 80, monetaryAreaId: "money-area-cad", incomeLevel: "high", householdDebtToGdpBps: 10_300, privateCreditToGdpBps: 15_000, industryWeightsBps: industries(6_800, 1_350, 800, 1_050), taxProfile: { incomeTaxBps: 2_150, consumptionTaxBps: 1_100, corporateTaxBps: 2_650, propertyTaxBps: 880 }, governmentSpendingShareBps: 4_400, publicInvestmentShareBps: 600, educationSpendingShareBps: 550, savingsRateBps: 1_550, housingCostIndexBps: 13_000, housingVacancyBps: 420, productivityIndexBps: 11_100, bankingDepthBps: 16_500, bankConcentrationBps: 8_300, depositInsuranceCoverageMinor: 100_000_00 }),
  calibrated({ countryId: "it", population: 58_900_000, workingAgeShareBps: 6_300, populationGrowthBps: -25, dependencyRatioBps: 6_100, baselineNominalGdpMinor: 1_610_000, inflationBps: 230, unemploymentBps: 720, governmentDebtToGdpBps: 14_470, budgetBalanceToGdpBps: -410, averageDebtMaturityMonths: 88, monetaryAreaId: "money-area-eur", incomeLevel: "high", householdDebtToGdpBps: 4_200, privateCreditToGdpBps: 8_500, industryWeightsBps: industries(6_650, 2_100, 750, 500), taxProfile: { incomeTaxBps: 2_350, consumptionTaxBps: 1_800, corporateTaxBps: 2_400, propertyTaxBps: 560 }, governmentSpendingShareBps: 5_100, publicInvestmentShareBps: 500, educationSpendingShareBps: 410, savingsRateBps: 2_250, housingCostIndexBps: 8_600, housingVacancyBps: 820, productivityIndexBps: 9_400, bankingDepthBps: 10_800, bankConcentrationBps: 5_500, depositInsuranceCoverageMinor: 100_000_00 }),
  calibrated({ countryId: "es", population: 48_600_000, workingAgeShareBps: 6_500, populationGrowthBps: 75, dependencyRatioBps: 5_300, baselineNominalGdpMinor: 3_280_000, inflationBps: 290, unemploymentBps: 1_160, governmentDebtToGdpBps: 10_660, budgetBalanceToGdpBps: -360, averageDebtMaturityMonths: 91, monetaryAreaId: "money-area-eur", incomeLevel: "high", householdDebtToGdpBps: 5_100, privateCreditToGdpBps: 9_000, industryWeightsBps: industries(7_100, 1_500, 700, 700), taxProfile: { incomeTaxBps: 2_200, consumptionTaxBps: 1_735, corporateTaxBps: 2_500, propertyTaxBps: 490 }, governmentSpendingShareBps: 4_700, publicInvestmentShareBps: 520, educationSpendingShareBps: 460, savingsRateBps: 1_850, housingCostIndexBps: 8_200, housingVacancyBps: 1_050, productivityIndexBps: 9_700, bankingDepthBps: 11_500, bankConcentrationBps: 6_700, depositInsuranceCoverageMinor: 100_000_00 }),
  calibrated({ countryId: "nl", population: 17_900_000, workingAgeShareBps: 6_500, populationGrowthBps: 60, dependencyRatioBps: 5_400, baselineNominalGdpMinor: 3_390_000, inflationBps: 300, unemploymentBps: 370, governmentDebtToGdpBps: 5_410, budgetBalanceToGdpBps: -80, averageDebtMaturityMonths: 83, monetaryAreaId: "money-area-eur", incomeLevel: "high", householdDebtToGdpBps: 9_500, privateCreditToGdpBps: 14_500, industryWeightsBps: industries(7_100, 1_350, 1_050, 500), taxProfile: { incomeTaxBps: 2_400, consumptionTaxBps: 1_735, corporateTaxBps: 2_580, propertyTaxBps: 610 }, governmentSpendingShareBps: 4_300, publicInvestmentShareBps: 650, educationSpendingShareBps: 550, savingsRateBps: 2_600, housingCostIndexBps: 12_800, housingVacancyBps: 360, productivityIndexBps: 12_000, bankingDepthBps: 17_000, bankConcentrationBps: 7_100, depositInsuranceCoverageMinor: 100_000_00 }),
  calibrated({ countryId: "kr", population: 51_700_000, workingAgeShareBps: 7_000, populationGrowthBps: -10, dependencyRatioBps: 4_300, baselineNominalGdpMinor: 3_850_000, inflationBps: 270, unemploymentBps: 280, governmentDebtToGdpBps: 5_190, budgetBalanceToGdpBps: -230, averageDebtMaturityMonths: 77, monetaryAreaId: "money-area-krw", incomeLevel: "high", householdDebtToGdpBps: 10_500, privateCreditToGdpBps: 17_500, industryWeightsBps: industries(5_900, 2_450, 1_450, 200), taxProfile: { incomeTaxBps: 1_800, consumptionTaxBps: 910, corporateTaxBps: 2_400, propertyTaxBps: 520 }, governmentSpendingShareBps: 3_800, publicInvestmentShareBps: 720, educationSpendingShareBps: 560, savingsRateBps: 3_100, housingCostIndexBps: 11_200, housingVacancyBps: 520, productivityIndexBps: 11_500, bankingDepthBps: 17_500, bankConcentrationBps: 6_200, depositInsuranceCoverageMinor: 50_000_000_00 }),
];

export const MONETARY_AREA_ECONOMIC_PROFILES: MonetaryAreaEconomicProfile[] = [
  ["rub", 700, 400, 450], ["eur", 400, 200, 100], ["gbp", 525, 200, 100], ["usd", 525, 200, 100],
  ["jpy", 10, 200, 50], ["cad", 500, 200, 100], ["krw", 350, 200, 200],
].map(([currency, policyRateBps, inflationTargetBps, reserveRequirementBps]) => ({
  monetaryAreaId: `money-area-${currency}`,
  policyRateBps: policyRateBps as number,
  inflationTargetBps: inflationTargetBps as number,
  reserveRequirementBps: reserveRequirementBps as number,
  metadata: { sourceType: "CALIBRATED", baseYear: 2024, sourceNote: "Округлённая стартовая калибровка сценария." },
}));

export function getCountryEconomicProfile(countryId: string): CountryEconomicProfile {
  const found = COUNTRY_ECONOMIC_PROFILES.find((profile) => profile.countryId === countryId);
  if (found) return structuredClone(found);
  const base = COUNTRY_ECONOMIC_PROFILES.find((profile) => profile.countryId === "ru")!;
  return {
    ...structuredClone(base),
    countryId,
    population: 10_000_000,
    baselineNominalGdpMinor: 100_000_000,
    monetaryAreaId: `money-area-${countryId}`,
    metadata: { sourceType: "SYNTHETIC_FALLBACK", baseYear: 2024, sourceNote: "Явный нейтральный fallback для неизвестной страны." },
  };
}

export function getMonetaryAreaEconomicProfile(monetaryAreaId: string): MonetaryAreaEconomicProfile {
  return structuredClone(MONETARY_AREA_ECONOMIC_PROFILES.find((profile) => profile.monetaryAreaId === monetaryAreaId) ?? {
    monetaryAreaId,
    policyRateBps: 500,
    inflationTargetBps: 200,
    reserveRequirementBps: 100,
    metadata: { sourceType: "SYNTHETIC_FALLBACK", baseYear: 2024, sourceNote: "Нейтральный денежный fallback." },
  });
}
