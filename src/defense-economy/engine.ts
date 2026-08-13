import { depositOf, transferDeposit } from "../core/ledger.ts";
import type { DefenseCountryState, WorldState } from "../domain/model.ts";

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
  const marketAccessBps = 10_000 - importDependencyBps * (10_000 - accessBps) / 10_000;
  return clamp(Math.min(marketAccessBps, energyBps), 2_000, 10_000);
}

function payPersonnel(world: WorldState, state: DefenseCountryState, budget: number): number {
  const government = world.governments.find((item) => item.countryId === state.countryId);
  const cohorts = world.populationCohorts.filter((item) => item.countryId === state.countryId);
  if (!government || !cohorts.length) return 0;
  const recipient = cohorts[world.clock.elapsedMonths % cohorts.length];
  const amount = Math.min(budget, depositOf(world, government.id));
  const tx = amount > 0 ? transferDeposit(world, government.id, recipient.id, amount, "WAGE", `Военное денежное довольствие · ${state.countryId}`) : null;
  if (tx) recordDefenseOutflow(world, state.countryId, amount);
  return tx ? amount : 0;
}

function procure(world: WorldState, state: DefenseCountryState, budget: number): number {
  const government = world.governments.find((item) => item.countryId === state.countryId);
  const sectors = world.defenseEconomy.industries.filter((item) => item.countryId === state.countryId);
  if (!government || !sectors.length || budget <= 0) return 0;
  let paid = 0;
  for (const sector of sectors) {
    const supplier = world.firmCohorts.find((item) => item.id === sector.supplierCohortId);
    if (!supplier) continue;
    sector.inputAvailabilityBps = inputAvailability(world, state.countryId, sector.importDependencyBps);
    const monthlyCapacity = Math.round(sector.capacityMinor * sector.inputAvailabilityBps / 10_000);
    const requested = Math.round(budget / sectors.length);
    const amount = Math.min(requested, monthlyCapacity, depositOf(world, government.id));
    const tx = amount > 0 ? transferDeposit(world, government.id, supplier.id, amount, "PROCUREMENT", `Оборонный заказ · ${sector.category}`) : null;
    if (!tx) continue;
    paid += amount;
    sector.utilizedCapacityBps = clamp(amount * 10_000 / Math.max(1, sector.capacityMinor));
    supplier.revenueCents = Math.max(supplier.revenueCents, amount);
    supplier.valueAddedMinor = Math.max(supplier.valueAddedMinor, Math.round(amount * 4_800 / 10_000));
    if (sector.utilizedCapacityBps > 8_500 && sector.expansionMonthsRemaining === 0) sector.expansionMonthsRemaining = 18;
    if (sector.expansionMonthsRemaining > 0) {
      sector.expansionMonthsRemaining -= 1;
      if (sector.expansionMonthsRemaining === 0) sector.capacityMinor = Math.round(sector.capacityMinor * 1.08);
    }
  }
  return paid;
}

export function runDefenseEconomyMonth(world: WorldState): void {
  for (const state of world.defenseEconomy.countries) {
    const government = world.governments.find((item) => item.countryId === state.countryId);
    const actualGdp = world.countryEconomicAccounts.closedByCountry[state.countryId]?.production.valueAddedMinor
      ?? world.countryScaleReconciliations.find((item) => item.countryId === state.countryId)?.targetMonthlyNominalGdpMinor ?? 1;
    if (!government) continue;
    const planned = Math.min(depositOf(world, government.id), Math.round(actualGdp * state.targetSpendingToGdpBps / 10_000));
    const personnelBudget = Math.round(planned * 3_000 / 10_000);
    const procurementBudget = Math.round(planned * 3_500 / 10_000);
    const operationsBudget = Math.round(planned * 2_000 / 10_000);
    const researchBudget = Math.round(planned * 900 / 10_000);
    const infrastructureBudget = planned - personnelBudget - procurementBudget - operationsBudget - researchBudget;
    state.personnelSpendingMinor = payPersonnel(world, state, personnelBudget);
    state.procurementSpendingMinor = procure(world, state, procurementBudget);
    state.operationsMaintenanceMinor = procure(world, state, operationsBudget);
    state.researchSpendingMinor = procure(world, state, researchBudget);
    state.infrastructureSpendingMinor = procure(world, state, infrastructureBudget);

    const delivered = state.procurementSpendingMinor + state.operationsMaintenanceMinor + state.researchSpendingMinor + state.infrastructureSpendingMinor;
    state.equipmentStockMinor += Math.round(state.procurementSpendingMinor * 0.28);
    state.munitionsStockMinor += Math.round(state.procurementSpendingMinor * 0.24);
    state.fuelStockMinor += Math.round(state.operationsMaintenanceMinor * 0.18);
    state.sparePartsStockMinor += Math.round(state.operationsMaintenanceMinor * 0.22);
    state.medicalLogisticsStockMinor += Math.round(state.operationsMaintenanceMinor * 0.12);
    const maintenanceNeed = Math.max(1, Math.round(state.equipmentStockMinor / 480));
    state.equipmentConditionBps = clamp(state.equipmentConditionBps + (state.operationsMaintenanceMinor >= maintenanceNeed ? 18 : -45));
    state.trainingBps = clamp(state.trainingBps + (state.personnelSpendingMinor > 0 && state.operationsMaintenanceMinor > 0 ? 12 : -30));
    state.logisticsReadinessBps = clamp(state.logisticsReadinessBps + (state.fuelStockMinor > maintenanceNeed && state.sparePartsStockMinor > maintenanceNeed ? 10 : -35));
    const sectors = world.defenseEconomy.industries.filter((item) => item.countryId === state.countryId);
    state.importDependencyBps = sectors.length ? Math.round(sectors.reduce((sum, item) => sum + item.importDependencyBps, 0) / sectors.length) : 0;
    const supplyBps = sectors.length ? Math.round(sectors.reduce((sum, item) => sum + item.inputAvailabilityBps, 0) / sectors.length) : 0;
    const stockBps = clamp((state.munitionsStockMinor + state.fuelStockMinor + state.sparePartsStockMinor) * 10_000 / Math.max(1, actualGdp * 3));
    const targetReadiness = Math.min(
      state.equipmentConditionBps,
      state.trainingBps,
      state.logisticsReadinessBps,
      clamp((state.equipmentConditionBps * 25 + state.trainingBps * 20 + state.logisticsReadinessBps * 20 + stockBps * 20 + supplyBps * 15) / 100),
    );
    state.readinessBps = clamp(state.readinessBps + clamp(targetReadiness - state.readinessBps, -90, 45));
    state.lastCauseCodes = [];
    if (state.operationsMaintenanceMinor < maintenanceNeed) state.lastCauseCodes.push("maintenance-shortage");
    if (supplyBps < 6_000) state.lastCauseCodes.push("restricted-inputs");
    if (state.fuelStockMinor < maintenanceNeed) state.lastCauseCodes.push("fuel-shortage");
    if (delivered < planned * 0.5) state.lastCauseCodes.push("funding-or-capacity-shortage");
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
