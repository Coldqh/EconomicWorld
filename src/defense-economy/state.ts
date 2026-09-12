import type { DefenseCapabilityDomain, DefenseEconomyState, WorldState } from "../domain/model.ts";
import { REAL_WORLD_DEFENSE_PROFILES } from "./profiles.ts";

const domains: DefenseCapabilityDomain[] = ["land", "air", "naval", "airDefense", "logistics", "cyberCommunications"];
const categories = ["ground", "aerospace", "naval", "electronics", "munitions", "logistics", "communications"] as const;

export function createDefenseEconomyState(): DefenseEconomyState {
  return { countries: [], industries: [], aidTransfers: [], alliances: [], nextAidId: 1 };
}

export function seedDefenseEconomy(world: WorldState): void {
  if (world.defenseEconomy.countries.length) {
    for (const state of world.defenseEconomy.countries) {
      state.serviceableEquipmentMinor ??= Math.round(state.equipmentStockMinor * state.equipmentConditionBps / 10_000);
      state.unavailableEquipmentMinor ??= Math.max(0, state.equipmentStockMinor - state.serviceableEquipmentMinor);
      state.averageEquipmentAgeMonths ??= 96; state.maintenanceBacklogMinor ??= 0; state.mobilizedPersonnel ??= 0;
      state.baselineTargetSpendingToGdpBps ??= state.targetSpendingToGdpBps;
      if (state.readinessBps <= 0) state.readinessBps = Math.max(1_500, Math.round((state.equipmentConditionBps + state.trainingBps + state.logisticsReadinessBps) / 3 * 0.7));
    }
    return;
  }
  for (const country of world.countries) {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id)!;
    const population = world.populationCohorts.filter((item) => item.countryId === country.id).reduce((sum, item) => sum + item.populationCount, 0);
    const structural = world.countryScaleReconciliations.find((item) => item.countryId === country.id)?.targetMonthlyNominalGdpMinor ?? Math.max(1, profile.baselineNominalGdpMinor / 12);
    const defenseProfile = world.baselineReference.mode === "REAL_WORLD" ? REAL_WORLD_DEFENSE_PROFILES[country.id] : undefined;
    const target = defenseProfile?.defenseSpendingToGdpBps.value ?? Math.max(80, Math.min(650, Math.round(120 + profile.governmentSpendingShareBps * 0.045)));
    const capabilities = Object.fromEntries(domains.map((domain, index) => [domain, Math.min(9_000, 3_500 + profile.productivityIndexBps / 3 + index * 120 + (defenseProfile?.domainWeightsBps[domain] ?? 1_667) / 8)])) as Record<DefenseCapabilityDomain, number>;
    const equipmentStock = structural * 8;
    const readiness = defenseProfile?.readinessEstimateBps.value ?? 6_500;
    const activePersonnel = defenseProfile?.activePersonnel.value ?? Math.max(1_000, Math.round(population * 55 / 10_000));
    const reservePersonnel = defenseProfile?.reservePersonnel.value ?? Math.max(1_000, Math.round(population * 90 / 10_000));
    world.defenseEconomy.countries.push({
      countryId: country.id, targetSpendingToGdpBps: target, personnelSpendingMinor: 0, procurementSpendingMinor: 0, operationsMaintenanceMinor: 0, researchSpendingMinor: 0, infrastructureSpendingMinor: 0,
      activePersonnel, reservePersonnel, supportPersonnel: Math.max(500, Math.round(activePersonnel * 0.32)), mobilizedPersonnel: 0,
      reserveActivationCapacity: Math.max(500, Math.round(population * 15 / 10_000)), industrialConversionCapacityBps: 1_500,
      equipmentStockMinor: equipmentStock, serviceableEquipmentMinor: Math.round(equipmentStock * 0.72), unavailableEquipmentMinor: Math.round(equipmentStock * 0.28), retiredEquipmentMinor: 0, averageEquipmentAgeMonths: 96,
      munitionsStockMinor: structural * (defenseProfile?.stockpileAdequacyBps.value ?? 6_500) / 6_500, fuelStockMinor: structural, sparePartsStockMinor: Math.round(structural * 0.6), medicalLogisticsStockMinor: Math.round(structural * 0.4),
      readinessBps: readiness, equipmentConditionBps: 7_200, trainingBps: Math.max(5_000, readiness - 400), logisticsReadinessBps: Math.max(5_000, readiness - 200), importDependencyBps: defenseProfile?.importDependencyBps.value ?? 2_500, capabilitiesBps: capabilities, lastCauseCodes: [],
      personnelRequiredCostMinor: 0, payrollCoverageBps: 10_000, requiredMaintenanceMinor: 0, maintenanceCoverageBps: 10_000, maintenanceBacklogMinor: 0,
      infrastructureStockMinor: structural * 2, infrastructureConditionBps: 7_500, researchProgressMinor: 0, baselineTargetSpendingToGdpBps: target,
      domainStates: domains.map((domain) => { const weight = defenseProfile?.domainWeightsBps[domain] ?? Math.round(10_000 / domains.length); const gross = Math.round(equipmentStock * weight / 10_000); return { domain, grossCapitalMinor: gross, serviceableCapitalMinor: Math.round(gross * 0.72), unavailableCapitalMinor: Math.round(gross * 0.28), personnelShareBps: weight, maintenanceRequirementMinor: 0, technologyBps: capabilities[domain], readinessBps: readiness, supplyDependencyBps: defenseProfile?.importDependencyBps.value ?? 2_500 }; }),
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
