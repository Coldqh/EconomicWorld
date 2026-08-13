import type { DefenseCapabilityDomain, DefenseEconomyState, WorldState } from "../domain/model.ts";

const domains: DefenseCapabilityDomain[] = ["land", "air", "naval", "airDefense", "logistics", "cyberCommunications"];
const categories = ["ground", "aerospace", "naval", "electronics", "munitions", "logistics", "communications"] as const;

export function createDefenseEconomyState(): DefenseEconomyState {
  return { countries: [], industries: [], aidTransfers: [], alliances: [], nextAidId: 1 };
}

export function seedDefenseEconomy(world: WorldState): void {
  if (world.defenseEconomy.countries.length) return;
  for (const country of world.countries) {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id)!;
    const population = world.populationCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.populationCount, 0);
    const structural = world.countryScaleReconciliations.find((item) => item.countryId === country.id)?.targetMonthlyNominalGdpMinor ?? Math.max(1, profile.baselineNominalGdpMinor / 12);
    const target = Math.max(80, Math.min(650, Math.round(120 + profile.governmentSpendingShareBps * 0.045)));
    const capabilities = Object.fromEntries(domains.map((domain, index) => [domain, Math.min(9_000, 3_500 + profile.productivityIndexBps / 3 + index * 120)])) as Record<DefenseCapabilityDomain, number>;
    world.defenseEconomy.countries.push({
      countryId: country.id, targetSpendingToGdpBps: target, personnelSpendingMinor: 0, procurementSpendingMinor: 0, operationsMaintenanceMinor: 0, researchSpendingMinor: 0, infrastructureSpendingMinor: 0,
      activePersonnel: Math.max(1_000, Math.round(population * 55 / 10_000)), reservePersonnel: Math.max(1_000, Math.round(population * 90 / 10_000)), supportPersonnel: Math.max(500, Math.round(population * 20 / 10_000)),
      reserveActivationCapacity: Math.max(500, Math.round(population * 15 / 10_000)), industrialConversionCapacityBps: 1_500,
      equipmentStockMinor: structural * 8, munitionsStockMinor: structural, fuelStockMinor: structural, sparePartsStockMinor: Math.round(structural * 0.6), medicalLogisticsStockMinor: Math.round(structural * 0.4),
      readinessBps: 6_500, equipmentConditionBps: 7_200, trainingBps: 6_400, logisticsReadinessBps: 6_600, importDependencyBps: 2_500, capabilitiesBps: capabilities, lastCauseCodes: [],
    });
    const suppliers = world.firmCohorts.filter((item) => item.countryId === country.id);
    categories.forEach((category, index) => world.defenseEconomy.industries.push({
      id: `defense-sector-${country.id}-${category}`, countryId: country.id, category, supplierCohortId: suppliers[index % Math.max(1, suppliers.length)]?.id ?? "",
      capacityMinor: Math.round(structural * (category === "munitions" ? 0.02 : 0.012)), utilizedCapacityBps: 3_000, technologyBps: Math.min(10_000, profile.productivityIndexBps), inputAvailabilityBps: 9_000,
      importDependencyBps: category === "electronics" || category === "communications" ? 4_500 : 2_000, expansionMonthsRemaining: 0,
    }));
  }
  const cooperationMembers = ["us", "de", "ca", "uk", "fr", "it"].filter((id) => world.countries.some((country) => country.id === id));
  if (cooperationMembers.length > 1) world.defenseEconomy.alliances.push({ id: "security-cooperation-atlantic", memberCountryIds: cooperationMembers, defenseCooperationBps: 7_500, accessBps: 7_000, mutualSupportCommitmentBps: 6_000 });
}
