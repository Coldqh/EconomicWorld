import type { ArmedConflict, WorldState } from "../domain/model.ts";

const clamp = (value: number, minimum = 0, maximum = 10_000) => Math.min(maximum, Math.max(minimum, Math.round(value)));

export function proposeConflict(world: WorldState, initiatorCountryId: string, defenderCountryId: string, objective: ArmedConflict["objective"] = "coerce"): ArmedConflict | null {
  if (initiatorCountryId === defenderCountryId || world.conflicts.conflicts.some((item) => item.status === "active" && item.participantCountryIds.includes(initiatorCountryId) && item.participantCountryIds.includes(defenderCountryId))) return null;
  const initiator = world.defenseEconomy.countries.find((item) => item.countryId === initiatorCountryId);
  const defender = world.defenseEconomy.countries.find((item) => item.countryId === defenderCountryId);
  const dependence = world.geoeconomics.directionalDependencies.find((item) => item.sourceCountryId === initiatorCountryId && item.targetCountryId === defenderCountryId)?.strategicDependencyBps ?? 0;
  const pressure = world.politicalEconomy.stateCapacity.find((item) => item.countryId === initiatorCountryId);
  if (!initiator || !defender || initiator.readinessBps < 4_500 || dependence > 7_500 || (pressure?.policyCredibilityBps ?? 7_000) < 4_000) return null;
  const conflict: ArmedConflict = {
    id: `conflict-${String(world.conflicts.nextConflictId++).padStart(5, "0")}`, participantCountryIds: [initiatorCountryId, defenderCountryId], initiatorCountryId, defenderCountryId,
    startMonth: world.clock.elapsedMonths, endMonth: null, objective, scope: "aggregate-theatre", intensityBps: 3_500, status: "proposed",
    mobilizationByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, industrialConversionBpsByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    militaryLossesByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, equipmentLossMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    capitalDamageMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, tradeDisruptionBpsByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    fiscalCostMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, civilianConsumptionLossMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    continuationPressureBpsByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, causeCodes: ["strategic-decision"],
  };
  world.conflicts.conflicts.push(conflict);
  return conflict;
}

export function activateConflict(world: WorldState, conflictId: string): boolean {
  const conflict = world.conflicts.conflicts.find((item) => item.id === conflictId && item.status === "proposed");
  if (!conflict) return false;
  conflict.status = "active";
  for (const countryId of conflict.participantCountryIds) {
    const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
    if (defense) defense.targetSpendingToGdpBps = Math.min(1_200, defense.targetSpendingToGdpBps + 250);
  }
  return true;
}

export function mobilizeConflict(world: WorldState, conflictId: string, countryId: string, personnel: number, industrialConversionBps: number): boolean {
  const conflict = world.conflicts.conflicts.find((item) => item.id === conflictId && item.status === "active" && item.participantCountryIds.includes(countryId));
  const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
  if (!conflict || !defense || personnel <= 0) return false;
  const activated = Math.min(Math.floor(personnel), defense.reservePersonnel, defense.reserveActivationCapacity);
  defense.reservePersonnel -= activated; defense.activePersonnel += activated;
  conflict.mobilizationByCountry[countryId] = (conflict.mobilizationByCountry[countryId] ?? 0) + activated;
  const conversion = clamp(industrialConversionBps, 0, defense.industrialConversionCapacityBps);
  conflict.industrialConversionBpsByCountry[countryId] = conversion;
  for (const cohort of world.populationCohorts.filter((item) => item.countryId === countryId)) cohort.employedCount = Math.max(0, cohort.employedCount - Math.round(activated * cohort.populationCount / Math.max(1, world.populationCohorts.filter((item) => item.countryId === countryId).reduce((sum, item) => sum + item.populationCount, 0))));
  for (const sector of world.defenseEconomy.industries.filter((item) => item.countryId === countryId)) sector.capacityMinor = Math.round(sector.capacityMinor * (10_000 + conversion / 24) / 10_000);
  return activated > 0;
}

function applyConflictMonth(world: WorldState, conflict: ArmedConflict): void {
  const [leftId, rightId] = conflict.participantCountryIds;
  for (const [countryId, opponentId] of [[leftId, rightId], [rightId, leftId]] as const) {
    const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId)!;
    const opponent = world.defenseEconomy.countries.find((item) => item.countryId === opponentId)!;
    const supply = Math.min(defense.munitionsStockMinor, defense.fuelStockMinor, defense.sparePartsStockMinor);
    const monthlyGdp = world.countryEconomicAccounts.closedByCountry[countryId]?.production.valueAddedMinor ?? 1;
    const supplyBps = clamp(supply * 10_000 / Math.max(1, monthlyGdp));
    const operationalBps = clamp(defense.readinessBps * 0.55 + supplyBps * 0.25 + defense.logisticsReadinessBps * 0.2);
    const opponentBps = Math.max(1, opponent.readinessBps);
    const lossRateBps = clamp(conflict.intensityBps * opponentBps / Math.max(1, operationalBps) / 30, 4, 180);
    const personnelLoss = Math.min(defense.activePersonnel, Math.round(defense.activePersonnel * lossRateBps / 10_000));
    const equipmentLoss = Math.min(defense.equipmentStockMinor, Math.round(defense.equipmentStockMinor * lossRateBps / 10_000));
    defense.activePersonnel -= personnelLoss; defense.equipmentStockMinor -= equipmentLoss;
    conflict.militaryLossesByCountry[countryId] += personnelLoss; conflict.equipmentLossMinorByCountry[countryId] += equipmentLoss;
    const use = Math.min(supply, Math.round(monthlyGdp * conflict.intensityBps / 10_000 / 20));
    defense.munitionsStockMinor = Math.max(0, defense.munitionsStockMinor - Math.round(use * 0.45));
    defense.fuelStockMinor = Math.max(0, defense.fuelStockMinor - Math.round(use * 0.35));
    defense.sparePartsStockMinor = Math.max(0, defense.sparePartsStockMinor - Math.round(use * 0.2));
    const damage = Math.round(monthlyGdp * conflict.intensityBps / 10_000 / 1_200);
    conflict.capitalDamageMinorByCountry[countryId] += damage;
    const logistics = world.logisticsSectors.find((item) => item.countryId === countryId);
    if (logistics) logistics.capacityMilliUnits = Math.max(1, logistics.capacityMilliUnits - Math.round(logistics.capacityMilliUnits * conflict.intensityBps / 10_000 / 2_400));
    for (const firm of world.firmCohorts.filter((item) => item.countryId === countryId)) firm.capitalCents = Math.max(1, firm.capitalCents - Math.round(damage / Math.max(1, world.firmCohorts.filter((item) => item.countryId === countryId).length)));
    const disruption = clamp(conflict.intensityBps * 0.35);
    conflict.tradeDisruptionBpsByCountry[countryId] = disruption;
    for (const route of world.tradeRoutes.filter((item) => item.originCountryId === countryId || item.destinationCountryId === countryId)) route.capacityMilliUnits = Math.max(1, Math.round(route.capacityMilliUnits * (10_000 - disruption / 24) / 10_000));
    conflict.fiscalCostMinorByCountry[countryId] += defense.personnelSpendingMinor + defense.procurementSpendingMinor + defense.operationsMaintenanceMinor;
    conflict.civilianConsumptionLossMinorByCountry[countryId] += Math.round(monthlyGdp * (conflict.industrialConversionBpsByCountry[countryId] ?? 0) / 10_000);
    const pressure = clamp((10_000 - defense.readinessBps) * 0.35 + conflict.militaryLossesByCountry[countryId] * 10_000 / Math.max(1, defense.activePersonnel + conflict.militaryLossesByCountry[countryId]) + conflict.capitalDamageMinorByCountry[countryId] * 2_000 / Math.max(1, monthlyGdp));
    conflict.continuationPressureBpsByCountry[countryId] = pressure;
  }
  if (conflict.participantCountryIds.every((id) => conflict.continuationPressureBpsByCountry[id] > 7_000)) { conflict.status = "ceasefire"; conflict.endMonth = world.clock.elapsedMonths; conflict.causeCodes.push("mutual-cost-pressure"); }
}

export function runConflictMonth(world: WorldState): void {
  for (const conflict of world.conflicts.conflicts.filter((item) => item.status === "active")) applyConflictMonth(world, conflict);
}

export function settleConflict(world: WorldState, conflictId: string): boolean {
  const conflict = world.conflicts.conflicts.find((item) => item.id === conflictId && (item.status === "ceasefire" || item.status === "active"));
  if (!conflict) return false;
  conflict.status = "settled"; conflict.endMonth ??= world.clock.elapsedMonths; conflict.causeCodes.push("negotiated-settlement");
  for (const countryId of conflict.participantCountryIds) {
    const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
    if (defense) defense.targetSpendingToGdpBps = Math.max(100, defense.targetSpendingToGdpBps - 180);
  }
  return true;
}
