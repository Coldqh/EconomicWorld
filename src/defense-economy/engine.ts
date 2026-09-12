import { depositOf, transferDeposit } from "../core/ledger.ts";
import type { DefenseCountryState, WorldState } from "../domain/model.ts";
import { REAL_WORLD_DEFENSE_PROFILES } from "./profiles.ts";

const clamp = (value: number, minimum = 0, maximum = 10_000) => Math.min(maximum, Math.max(minimum, Math.round(value)));

function recordDefenseOutflow(world: WorldState, countryId: string, amount: number): void {
  const period = world.countryEconomicAccounts.currentByCountry[countryId];
  if (period && amount > 0) period.fiscal.consumptionMinor += amount;
}

function inputAvailability(world: WorldState, countryId: string, importDependencyBps: number): number {
  const dependencies = world.geoeconomics.directionalDependencies.filter((item) => item.sourceCountryId === countryId);
  const dependencyRiskBps = dependencies.length ? dependencies.reduce((sum, item) => sum + item.strategicDependencyBps, 0) / dependencies.length : 0;
  const policyPenaltyBps = world.geoeconomics.policies.filter((item) => item.status === "active" && item.targetCountryIds.includes(countryId)).reduce((maximum, item) => Math.max(maximum, item.accessPenaltyBps), 0);
  const accessBps = 10_000 - Math.max(dependencyRiskBps, policyPenaltyBps);
  const energy = world.energyBalances.find((item) => item.countryId === countryId);
  const energyProduction = energy ? Object.values(energy.productionBySourceMilliUnits).reduce((sum, value) => sum + value, 0) + energy.importsMilliUnits : 0;
  const energyDemand = energy ? Object.values(energy.consumptionBySourceMilliUnits).reduce((sum, value) => sum + value, 0) + energy.exportsMilliUnits + energy.unmetDemandMilliUnits : 0;
  const energyBps = energyDemand > 0 ? clamp(energyProduction * 10_000 / energyDemand, 2_000, 10_000) : 8_500;
  return clamp(Math.min(10_000 - importDependencyBps * (10_000 - accessBps) / 10_000, energyBps), 2_000, 10_000);
}

export function requiredPersonnelCost(world: WorldState, state: DefenseCountryState): number {
  const cohorts = world.populationCohorts.filter((item) => item.countryId === state.countryId);
  const people = cohorts.reduce((sum, item) => sum + item.populationCount, 0);
  const wage = people > 0 ? cohorts.reduce((sum, item) => sum + item.averageMonthlyIncomeCents * item.populationCount, 0) / people : 1;
  const weightedPersonnel = state.activePersonnel + (state.mobilizedPersonnel ?? 0) + state.supportPersonnel * 0.72 + state.reservePersonnel * 0.06;
  const profile = world.baselineReference.mode === "REAL_WORLD" ? REAL_WORLD_DEFENSE_PROFILES[state.countryId] : undefined;
  if (profile) {
    const monthlyGdp = world.countryScaleReconciliations.find((item) => item.countryId === state.countryId)?.targetMonthlyNominalGdpMinor ?? 1;
    const baselineWeighted = profile.activePersonnel.value + profile.activePersonnel.value * 0.32 * 0.72 + profile.reservePersonnel.value * 0.06;
    const countryMilitaryCompensation = monthlyGdp * profile.defenseSpendingToGdpBps.value / 10_000 * profile.personnelCostShareBps.value / 10_000 / Math.max(1, baselineWeighted);
    return Math.max(1, Math.round(countryMilitaryCompensation * weightedPersonnel));
  }
  return Math.max(1, Math.round(wage * weightedPersonnel * 1.08));
}

function payPersonnel(world: WorldState, state: DefenseCountryState, budget: number): number {
  const government = world.governments.find((item) => item.countryId === state.countryId);
  const eligible = world.populationCohorts.filter((item) => item.countryId === state.countryId && ["18-24", "25-34", "35-49"].includes(item.ageBand));
  const cohorts = eligible.length > 1 ? [eligible[world.clock.elapsedMonths % eligible.length], eligible[(world.clock.elapsedMonths + 1) % eligible.length]] : eligible;
  if (!government || !cohorts.length) return 0;
  const amount = Math.min(budget, depositOf(world, government.id));
  const population = cohorts.reduce((sum, item) => sum + item.populationCount, 0);
  let paid = 0;
  for (const [index, recipient] of cohorts.entries()) {
    const share = index === cohorts.length - 1 ? amount - paid : Math.round(amount * recipient.populationCount / Math.max(1, population));
    const tx = share > 0 ? transferDeposit(world, government.id, recipient.id, share, "WAGE", `Военное денежное довольствие · ${state.countryId}`) : null;
    if (tx) paid += share;
  }
  if (paid > 0) recordDefenseOutflow(world, state.countryId, paid);
  return paid;
}

function procure(world: WorldState, state: DefenseCountryState, budget: number, purpose: string): number {
  const government = world.governments.find((item) => item.countryId === state.countryId);
  const sectors = world.defenseEconomy.industries.filter((item) => item.countryId === state.countryId);
  if (!government || !sectors.length || budget <= 0) return 0;
  let paid = 0;
  for (const sector of sectors) {
    const supplier = world.firmCohorts.find((item) => item.id === sector.supplierCohortId);
    if (!supplier) continue;
    sector.inputAvailabilityBps = inputAvailability(world, state.countryId, sector.importDependencyBps);
    const capacity = Math.round(sector.capacityMinor * sector.inputAvailabilityBps / 10_000);
    const amount = Math.min(Math.round(budget / sectors.length), capacity, depositOf(world, government.id));
    const tx = amount > 0 ? transferDeposit(world, government.id, supplier.id, amount, "PROCUREMENT", `${purpose} · ${sector.category}`) : null;
    if (!tx) continue;
    paid += amount;
    sector.utilizedCapacityBps = clamp(amount * 10_000 / Math.max(1, sector.capacityMinor));
    supplier.revenueCents = Math.max(supplier.revenueCents, amount);
    supplier.valueAddedMinor = Math.max(supplier.valueAddedMinor, Math.round(amount * 4_800 / 10_000));
    if (purpose === "НИОКР") sector.researchProgressMinor = (sector.researchProgressMinor ?? 0) + amount;
    if (sector.utilizedCapacityBps > 8_500 && sector.expansionMonthsRemaining === 0) sector.expansionMonthsRemaining = 18;
    if (sector.expansionMonthsRemaining > 0 && --sector.expansionMonthsRemaining === 0) sector.capacityMinor = Math.round(sector.capacityMinor * 1.08);
  }
  return paid;
}

export function runDefenseEconomyMonth(world: WorldState): void {
  for (const state of world.defenseEconomy.countries) {
    const government = world.governments.find((item) => item.countryId === state.countryId);
    const actualGdp = world.countryEconomicAccounts.closedByCountry[state.countryId]?.production.valueAddedMinor
      ?? world.countryScaleReconciliations.find((item) => item.countryId === state.countryId)?.targetMonthlyNominalGdpMinor ?? 1;
    if (!government) continue;
    state.serviceableEquipmentMinor ??= Math.round(state.equipmentStockMinor * state.equipmentConditionBps / 10_000);
    state.unavailableEquipmentMinor ??= Math.max(0, state.equipmentStockMinor - state.serviceableEquipmentMinor);
    state.averageEquipmentAgeMonths ??= 96;
    state.maintenanceBacklogMinor ??= 0;
    state.infrastructureStockMinor ??= actualGdp * 2;
    state.infrastructureConditionBps ??= 7_000;
    state.researchProgressMinor ??= 0;
    state.mobilizedPersonnel ??= 0;
    state.baselineTargetSpendingToGdpBps ??= state.targetSpendingToGdpBps;
    for (const sector of world.defenseEconomy.industries.filter((item) => item.countryId === state.countryId)) sector.inputAvailabilityBps = inputAvailability(world, state.countryId, sector.importDependencyBps);

    const planned = Math.min(depositOf(world, government.id), Math.round(actualGdp * state.targetSpendingToGdpBps / 10_000));
    const personnelNeed = requiredPersonnelCost(world, state);
    const inConflict = world.conflicts.conflicts.some((item) => item.status === "active" && item.participantCountryIds.includes(state.countryId));
    const ageFactorBps = clamp(7_000 + state.averageEquipmentAgeMonths * 18, 7_000, 12_000);
    const maintenanceNeed = Math.max(1, Math.round(state.serviceableEquipmentMinor * 5 / 10_000 * ageFactorBps / 10_000 * (inConflict ? 3 : 1) + state.maintenanceBacklogMinor / 24));
    const infrastructureNeed = Math.max(1, Math.round(state.infrastructureStockMinor * (11_000 - state.infrastructureConditionBps) / 10_000 / 180));
    state.personnelRequiredCostMinor = personnelNeed;
    state.requiredMaintenanceMinor = maintenanceNeed;

    const personnelBudget = Math.min(planned, personnelNeed);
    const afterPayroll = Math.max(0, planned - personnelBudget);
    const operationsBudget = Math.min(afterPayroll, maintenanceNeed);
    const afterOperations = Math.max(0, afterPayroll - operationsBudget);
    const infrastructureBudget = Math.min(afterOperations, infrastructureNeed);
    const discretionary = Math.max(0, afterOperations - infrastructureBudget);
    const researchBudget = Math.round(discretionary * (operationsBudget < maintenanceNeed * 0.9 ? 600 : 1_600) / 10_000);
    const procurementBudget = discretionary - researchBudget;

    state.personnelSpendingMinor = payPersonnel(world, state, personnelBudget);
    state.operationsMaintenanceMinor = procure(world, state, operationsBudget, "Обслуживание и ремонт");
    state.infrastructureSpendingMinor = procure(world, state, infrastructureBudget, "Оборонная инфраструктура");
    state.researchSpendingMinor = procure(world, state, researchBudget, "НИОКР");
    state.procurementSpendingMinor = procure(world, state, procurementBudget, "Оборонный заказ");
    const delivered = state.procurementSpendingMinor + state.operationsMaintenanceMinor + state.researchSpendingMinor + state.infrastructureSpendingMinor;

    state.payrollCoverageBps = clamp(state.personnelSpendingMinor * 10_000 / Math.max(1, personnelNeed));
    if (state.payrollCoverageBps < 8_000) {
      const reduction = Math.min(state.activePersonnel, Math.round(state.activePersonnel * (8_000 - state.payrollCoverageBps) / 240_000));
      state.activePersonnel -= reduction; state.reservePersonnel += reduction;
    }
    const retirement = Math.min(state.equipmentStockMinor, Math.round(state.unavailableEquipmentMinor * Math.max(2, (10_000 - state.equipmentConditionBps) / 1_200) / 10_000));
    state.retiredEquipmentMinor = (state.retiredEquipmentMinor ?? 0) + retirement;
    state.equipmentStockMinor = Math.max(0, state.equipmentStockMinor - retirement);
    const deliveredEquipment = Math.round(state.procurementSpendingMinor * 0.45);
    state.equipmentStockMinor += deliveredEquipment;
    state.munitionsStockMinor += Math.round(state.procurementSpendingMinor * 0.24);
    state.fuelStockMinor += Math.round(state.operationsMaintenanceMinor * 0.18);
    state.sparePartsStockMinor += Math.round(state.operationsMaintenanceMinor * 0.22);
    state.medicalLogisticsStockMinor += Math.round(state.operationsMaintenanceMinor * 0.12);

    state.maintenanceCoverageBps = clamp(state.operationsMaintenanceMinor * 10_000 / Math.max(1, maintenanceNeed), 0, 15_000);
    state.maintenanceBacklogMinor = Math.max(0, state.maintenanceBacklogMinor + maintenanceNeed - state.operationsMaintenanceMinor);
    // Age raises the required cost above; subtracting it again here would make
    // fully funded maintenance structurally incapable of reaching equilibrium.
    const conditionChange = clamp((state.maintenanceCoverageBps - 10_000) / 250, -35, 24);
    state.equipmentConditionBps = clamp(state.equipmentConditionBps + conditionChange, 1_000, 9_200);
    state.serviceableEquipmentMinor = Math.round(state.equipmentStockMinor * state.equipmentConditionBps / 10_000);
    state.unavailableEquipmentMinor = Math.max(0, state.equipmentStockMinor - state.serviceableEquipmentMinor);
    state.averageEquipmentAgeMonths = Math.max(1, Math.round((state.averageEquipmentAgeMonths + 1) * Math.max(0, state.equipmentStockMinor - deliveredEquipment) / Math.max(1, state.equipmentStockMinor)));
    state.infrastructureConditionBps = clamp(state.infrastructureConditionBps + (state.infrastructureSpendingMinor * 10_000 / Math.max(1, infrastructureNeed) - 10_000) / 400, 2_000, 9_500);
    state.trainingBps = clamp(state.trainingBps + (state.payrollCoverageBps - 8_500) / 350 + (state.operationsMaintenanceMinor > 0 ? 2 : -8), 2_000, 9_500);
    state.logisticsReadinessBps = clamp(state.logisticsReadinessBps + (state.maintenanceCoverageBps - 9_000) / 450 + (state.fuelStockMinor > maintenanceNeed ? 2 : -10), 2_000, 9_500);
    state.researchProgressMinor += state.researchSpendingMinor;

    const sectors = world.defenseEconomy.industries.filter((item) => item.countryId === state.countryId);
    state.importDependencyBps = sectors.length ? Math.round(sectors.reduce((sum, item) => sum + item.importDependencyBps, 0) / sectors.length) : 0;
    const supplyBps = sectors.length ? Math.round(sectors.reduce((sum, item) => sum + item.inputAvailabilityBps, 0) / sectors.length) : 0;
    const stockBps = clamp((state.munitionsStockMinor + state.fuelStockMinor + state.sparePartsStockMinor) * 10_000 / Math.max(1, actualGdp * 3));
    for (const domain of state.domainStates ?? []) {
      domain.grossCapitalMinor = Math.round(state.equipmentStockMinor * domain.personnelShareBps / 10_000);
      domain.serviceableCapitalMinor = Math.round(domain.grossCapitalMinor * state.equipmentConditionBps / 10_000);
      domain.unavailableCapitalMinor = Math.max(0, domain.grossCapitalMinor - domain.serviceableCapitalMinor);
      domain.maintenanceRequirementMinor = Math.round(maintenanceNeed * domain.personnelShareBps / 10_000);
      const researchThreshold = Math.max(1, actualGdp * 2);
      if (state.researchProgressMinor >= researchThreshold) { domain.technologyBps = clamp(domain.technologyBps + 12, 0, 9_800); state.researchProgressMinor -= researchThreshold; }
      domain.readinessBps = clamp(state.equipmentConditionBps * 0.3 + state.trainingBps * 0.2 + state.logisticsReadinessBps * 0.2 + stockBps * 0.15 + supplyBps * 0.1 + domain.technologyBps * 0.05);
      state.capabilitiesBps[domain.domain] = clamp(domain.readinessBps * 0.65 + domain.technologyBps * 0.35);
    }
    const domainReadiness = (state.domainStates?.reduce((sum, item) => sum + item.readinessBps * item.personnelShareBps, 0) ?? 0) / 10_000;
    const targetReadiness = clamp((domainReadiness || state.equipmentConditionBps) * 0.3 + state.payrollCoverageBps * 0.2 + state.trainingBps * 0.15 + state.logisticsReadinessBps * 0.15 + stockBps * 0.08 + supplyBps * 0.06 + state.infrastructureConditionBps * 0.06);
    state.readinessBps = clamp(state.readinessBps + clamp(targetReadiness - state.readinessBps, -70, 45));
    state.lastCauseCodes = [];
    if (state.operationsMaintenanceMinor < maintenanceNeed) state.lastCauseCodes.push("maintenance-shortage");
    if (supplyBps < 6_000) state.lastCauseCodes.push("restricted-inputs");
    if (state.fuelStockMinor < maintenanceNeed) state.lastCauseCodes.push("fuel-shortage");
    if (state.payrollCoverageBps < 9_000) state.lastCauseCodes.push("payroll-shortage");
    if (delivered < Math.max(1, planned - state.personnelSpendingMinor) * 0.5) state.lastCauseCodes.push("funding-or-capacity-shortage");
  }
}

export function transferDefenseAid(world: WorldState, donorCountryId: string, recipientCountryId: string, equipmentMinor: number, suppliesMinor: number): boolean {
  const donor = world.defenseEconomy.countries.find((item) => item.countryId === donorCountryId);
  const recipient = world.defenseEconomy.countries.find((item) => item.countryId === recipientCountryId);
  if (!donor || !recipient || equipmentMinor < 0 || suppliesMinor < 0 || donor.equipmentStockMinor < equipmentMinor || donor.medicalLogisticsStockMinor < suppliesMinor) return false;
  donor.equipmentStockMinor -= equipmentMinor; donor.medicalLogisticsStockMinor -= suppliesMinor;
  recipient.equipmentStockMinor += equipmentMinor; recipient.medicalLogisticsStockMinor += suppliesMinor;
  world.defenseEconomy.aidTransfers.push({ id: `defense-aid-${world.defenseEconomy.nextAidId++}`, donorCountryId, recipientCountryId, elapsedMonth: world.clock.elapsedMonths, equipmentMinor, suppliesMinor, fundingMinor: 0, transactionId: null });
  return true;
}

export function recruitDefensePersonnel(world: WorldState, countryId: string, requested: number): number {
  const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
  const cohorts = world.populationCohorts.filter((item) => item.countryId === countryId && item.employedCount > 0);
  if (!defense || requested <= 0 || !cohorts.length) return 0;
  let remaining = Math.min(Math.floor(requested), defense.reserveActivationCapacity);
  let recruited = 0;
  for (const cohort of cohorts) {
    const count = Math.min(cohort.employedCount, Math.ceil(remaining / Math.max(1, cohorts.length)));
    cohort.employedCount -= count; remaining -= count; recruited += count;
    if (remaining <= 0) break;
  }
  defense.activePersonnel += recruited;
  defense.reserveActivationCapacity = Math.max(0, defense.reserveActivationCapacity - recruited);
  return recruited;
}
