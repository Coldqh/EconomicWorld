import type { SectorRepresentation, WorldState } from "../domain/model.ts";

export const createSectorRepresentation = (countryId: string, sectorId: string, baselineTargetMinor: number, explicitRepresentationMinor: number, residualRepresentationMinor: number): SectorRepresentation => {
  const explicitCarveOutMinor = Math.min(Math.max(0, baselineTargetMinor), Math.max(0, explicitRepresentationMinor));
  const residualTargetMinor = Math.max(0, baselineTargetMinor - explicitCarveOutMinor);
  const representedTotalMinor = explicitCarveOutMinor + Math.max(0, residualRepresentationMinor);
  return { countryId, sectorId, baselineTargetMinor, explicitRepresentationMinor, explicitCarveOutMinor, residualTargetMinor, representedTotalMinor, representedShareBps: baselineTargetMinor > 0 ? Math.round(representedTotalMinor * 10_000 / baselineTargetMinor) : 10_000 };
};

export function buildRepresentationLayer(world: WorldState): SectorRepresentation[] {
  const result: SectorRepresentation[] = [];
  for (const country of world.countries) {
    const reconciliation = world.countryScaleReconciliations.find((item) => item.countryId === country.id);
    const explicitCompanies = reconciliation?.explicitCompanyValueAddedMinor ?? world.companies.filter((item) => item.active && item.headquartersCountryId === country.id).reduce((sum, item) => sum + Math.max(0, item.lastGrossRevenueCents - item.lastIntermediateConsumptionCents), 0);
    const residualCompanies = world.firmCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.valueAddedMinor, 0);
    result.push(createSectorRepresentation(country.id, "nonfinancial-firms", explicitCompanies + (reconciliation?.sectorCohortValueAddedMinor ?? residualCompanies), explicitCompanies, residualCompanies));

    const explicitPopulation = world.people.filter((person) => world.cities.find((city) => city.id === person.cityId)?.countryId === country.id).length;
    const populationCohorts = world.populationCohorts.filter((item) => item.countryId === country.id);
    const baselinePopulation = world.countryEconomicProfiles.find((item) => item.countryId === country.id)?.population ?? explicitPopulation + populationCohorts.reduce((sum, item) => sum + item.populationCount, 0);
    let carveOut = Math.max(0, populationCohorts.reduce((sum, item) => sum + item.populationCount, 0) - Math.max(0, baselinePopulation - explicitPopulation));
    for (const cohort of populationCohorts) {
      if (carveOut <= 0) break;
      const removed = Math.min(carveOut, cohort.populationCount);
      const employmentShare = cohort.populationCount > 0 ? cohort.employedCount / cohort.populationCount : 0;
      cohort.populationCount -= removed;
      cohort.employedCount = Math.min(cohort.populationCount, Math.round(cohort.populationCount * employmentShare));
      carveOut -= removed;
    }
    const residualPopulation = populationCohorts.reduce((sum, item) => sum + item.populationCount, 0);
    result.push(createSectorRepresentation(country.id, "households", baselinePopulation, explicitPopulation, residualPopulation));

    const explicitBankAssets = world.banks.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + (item.baselineFinancials?.assetsMinor ?? 0), 0);
    const residualBankAssets = world.bankingSectorCohorts.find((item) => item.countryId === country.id)?.assetsMinor ?? 0;
    result.push(createSectorRepresentation(country.id, "banking", explicitBankAssets + residualBankAssets, explicitBankAssets, residualBankAssets));
  }
  world.countryEconomicAccounts.representations = result;
  return result;
}

export function residualTarget(world: WorldState, countryId: string, sectorId: string): number {
  return world.countryEconomicAccounts.representations.find((item) => item.countryId === countryId && item.sectorId === sectorId)?.residualTargetMinor ?? 0;
}
