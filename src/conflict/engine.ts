import type { ArmedConflict, DefenseCapabilityDomain, WorldState } from "../domain/model.ts";
import { transferDefenseAid } from "../defense-economy/engine.ts";
import { accountIds, ensureAccount, postTransaction } from "../core/ledger.ts";
import { recordInsuranceLossEvent } from "../insurance/engine.ts";
import { recordDecisionTrace, strategicEstimate } from "../information/system.ts";

const clamp = (value: number, minimum = 0, maximum = 10_000) => Math.min(maximum, Math.max(minimum, Math.round(value)));
const domains: DefenseCapabilityDomain[] = ["land", "air", "naval", "airDefense", "logistics", "cyberCommunications"];

function capability(world: WorldState, countryId: string): number {
  const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
  if (!defense) return 0;
  return domains.reduce((sum, domain) => sum + (defense.capabilitiesBps[domain] ?? 0), 0) / domains.length;
}

function allianceRisk(world: WorldState, initiatorId: string, defenderId: string): number {
  const alliances = world.defenseEconomy.alliances.filter((item) => item.memberCountryIds.includes(defenderId) && !item.memberCountryIds.includes(initiatorId));
  return clamp(alliances.reduce((sum, item) => sum + item.mutualSupportCommitmentBps * Math.max(1, item.memberCountryIds.length - 1), 0) / Math.max(1, alliances.length * 2));
}

export function conflictDecisionScore(world: WorldState, initiatorCountryId: string, defenderCountryId: string): { scoreBps: number; expectedCostBps: number; allianceRiskBps: number } {
  const own = world.defenseEconomy.countries.find((item) => item.countryId === initiatorCountryId);
  const enemyExists = world.defenseEconomy.countries.some((item) => item.countryId === defenderCountryId);
  if (!own || !enemyExists) return { scoreBps: 0, expectedCostBps: 10_000, allianceRiskBps: 10_000 };
  const dependence = world.geoeconomics.directionalDependencies.find((item) => item.sourceCountryId === initiatorCountryId && item.targetCountryId === defenderCountryId)?.strategicDependencyBps ?? 0;
  const friction = clamp(world.geoeconomics.policies.filter((item) => item.status === "active" && ((item.actorCountryId === initiatorCountryId && item.targetCountryIds.includes(defenderCountryId)) || (item.actorCountryId === defenderCountryId && item.targetCountryIds.includes(initiatorCountryId)))).reduce((sum, item) => sum + item.accessPenaltyBps + item.rateBps / 2, 0));
  const enemyReadiness = strategicEstimate(world, initiatorCountryId, defenderCountryId, "readiness-bps");
  const enemyStock = strategicEstimate(world, initiatorCountryId, defenderCountryId, "stockpile-minor");
  const relative = clamp(5_000 + capability(world, initiatorCountryId) - (enemyReadiness?.observedValue ?? 5_000));
  const politics = world.politicalEconomy.stateCapacity.find((item) => item.countryId === initiatorCountryId);
  const fiscal = world.geoeconomics.strategicInterests.find((item) => item.countryId === initiatorCountryId)?.fiscalSpaceBps ?? 5_000;
  const alliance = allianceRisk(world, initiatorCountryId, defenderCountryId);
  const stock = clamp((own.munitionsStockMinor + own.fuelStockMinor + own.sparePartsStockMinor) * 10_000 / Math.max(1, enemyStock?.observedValue ?? own.equipmentStockMinor));
  const expectedCostBps = clamp(dependence * 0.35 + alliance * 0.35 + (10_000 - fiscal) * 0.2 + (10_000 - stock) * 0.1);
  const scoreBps = clamp(friction * 0.45 + relative * 0.15 + own.readinessBps * 0.12 + (politics?.policyCredibilityBps ?? 5_000) * 0.1 + fiscal * 0.08 + stock * 0.1 - expectedCostBps * 0.25);
  return { scoreBps, expectedCostBps, allianceRiskBps: alliance };
}

export function proposeConflict(world: WorldState, initiatorCountryId: string, defenderCountryId: string, objective: ArmedConflict["objective"] = "coerce"): ArmedConflict | null {
  if (initiatorCountryId === defenderCountryId || world.conflicts.conflicts.some((item) => !["settled", "terminated", "rejected"].includes(item.status) && item.participantCountryIds.includes(initiatorCountryId) && item.participantCountryIds.includes(defenderCountryId))) return null;
  const initiator = world.defenseEconomy.countries.find((item) => item.countryId === initiatorCountryId);
  const defender = world.defenseEconomy.countries.find((item) => item.countryId === defenderCountryId);
  if (!initiator || !defender || initiator.readinessBps < 3_500) return null;
  const decision = conflictDecisionScore(world, initiatorCountryId, defenderCountryId);
  const readinessBelief = strategicEstimate(world, initiatorCountryId, defenderCountryId, "readiness-bps");
  const stockBelief = strategicEstimate(world, initiatorCountryId, defenderCountryId, "stockpile-minor");
  const governmentId = world.governments.find((item) => item.countryId === initiatorCountryId)?.id ?? `government-${initiatorCountryId}`;
  recordDecisionTrace(world, governmentId, "CONFLICT_ASSESSMENT", defenderCountryId, [readinessBelief, stockBelief].filter((item): item is NonNullable<typeof item> => Boolean(item)), `Предложен конфликт; стратегическая оценка ${decision.scoreBps} б.п.`);
  const conflict: ArmedConflict = {
    id: `conflict-${String(world.conflicts.nextConflictId++).padStart(5, "0")}`, participantCountryIds: [initiatorCountryId, defenderCountryId], initiatorCountryId, defenderCountryId,
    startMonth: world.clock.elapsedMonths, endMonth: null, proposalMonth: world.clock.elapsedMonths, approvedMonth: null, ceasefireMonth: null, negotiationMonth: null,
    objective, scope: "aggregate-theatre", intensityBps: 2_500, status: "proposed", decisionScoreBps: decision.scoreBps, expectedCostBps: decision.expectedCostBps, allianceRiskBps: decision.allianceRiskBps, monthsInStatus: 0,
    mobilizationByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, industrialConversionBpsByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    militaryLossesByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, equipmentLossMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    capitalDamageMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, tradeDisruptionBpsByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    fiscalCostMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, civilianConsumptionLossMinorByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 },
    continuationPressureBpsByCountry: { [initiatorCountryId]: 0, [defenderCountryId]: 0 }, causeCodes: ["strategic-assessment"],
  };
  world.conflicts.conflicts.push(conflict);
  return conflict;
}

export function activateConflict(world: WorldState, conflictId: string): boolean {
  const conflict = world.conflicts.conflicts.find((item) => item.id === conflictId && ["proposed", "approved", "mobilizing"].includes(item.status));
  if (!conflict) return false;
  conflict.status = "active"; conflict.approvedMonth ??= world.clock.elapsedMonths; conflict.monthsInStatus = 0;
  return true;
}

function removeCivilianLabour(world: WorldState, countryId: string, personnel: number): number {
  const cohorts = world.populationCohorts.filter((item) => item.countryId === countryId && item.employedCount > 0);
  let remaining = personnel; let removed = 0;
  const employed = cohorts.reduce((sum, item) => sum + item.employedCount, 0);
  for (const [index, cohort] of cohorts.entries()) {
    const count = Math.min(cohort.employedCount, index === cohorts.length - 1 ? remaining : Math.round(personnel * cohort.employedCount / Math.max(1, employed)));
    cohort.employedCount -= count; remaining -= count; removed += count;
  }
  return removed;
}

function convertCivilianCapacity(world: WorldState, countryId: string, conversionBps: number): number {
  const civilian = world.firmCohorts.filter((item) => item.countryId === countryId && item.capitalCents > 0);
  const defense = world.defenseEconomy.industries.filter((item) => item.countryId === countryId);
  const total = civilian.reduce((sum, item) => sum + item.capitalCents, 0);
  const requested = Math.round(total * conversionBps / 10_000);
  let transferred = 0;
  for (const [index, cohort] of civilian.entries()) {
    const amount = Math.min(cohort.capitalCents, index === civilian.length - 1 ? requested - transferred : Math.round(requested * cohort.capitalCents / Math.max(1, total)));
    cohort.capitalCents -= amount; transferred += amount;
  }
  const delivered = Math.round(transferred * 8_500 / 10_000);
  for (const [index, sector] of defense.entries()) {
    const amount = index === defense.length - 1 ? delivered - Math.floor(delivered / Math.max(1, defense.length)) * index : Math.floor(delivered / Math.max(1, defense.length));
    sector.capacityMinor += amount; sector.civilianCapacityTransferredMinor = (sector.civilianCapacityTransferredMinor ?? 0) + amount;
  }
  return transferred;
}

export function mobilizeConflict(world: WorldState, conflictId: string, countryId: string, personnel: number, industrialConversionBps: number): boolean {
  const conflict = world.conflicts.conflicts.find((item) => item.id === conflictId && ["approved", "mobilizing", "active"].includes(item.status) && item.participantCountryIds.includes(countryId));
  const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
  if (!conflict || !defense || personnel <= 0) return false;
  const activated = Math.min(Math.floor(personnel), defense.reservePersonnel, defense.reserveActivationCapacity);
  const removed = removeCivilianLabour(world, countryId, activated);
  defense.reservePersonnel -= removed; defense.activePersonnel += removed; defense.mobilizedPersonnel = (defense.mobilizedPersonnel ?? 0) + removed;
  conflict.mobilizationByCountry[countryId] = (conflict.mobilizationByCountry[countryId] ?? 0) + removed;
  const conversion = clamp(industrialConversionBps, 0, defense.industrialConversionCapacityBps);
  conflict.industrialConversionBpsByCountry[countryId] = conversion;
  convertCivilianCapacity(world, countryId, conversion);
  return removed > 0;
}

function autonomousInitiation(world: WorldState): void {
  if (world.clock.elapsedMonths === 0 || world.clock.elapsedMonths % 6 !== 0) return;
  for (const initiator of world.countries) {
    if (world.conflicts.conflicts.some((item) => !["settled", "terminated", "rejected"].includes(item.status) && item.participantCountryIds.includes(initiator.id))) continue;
    let best: { target: string; score: number } | null = null;
    for (const target of world.countries.filter((item) => item.id !== initiator.id)) {
      const score = conflictDecisionScore(world, initiator.id, target.id).scoreBps;
      if (!best || score > best.score) best = { target: target.id, score };
    }
    if (best && best.score >= 6_200) proposeConflict(world, initiator.id, best.target, "limited-political");
  }
}

function advanceProposals(world: WorldState): void {
  for (const conflict of world.conflicts.conflicts) {
    conflict.monthsInStatus = (conflict.monthsInStatus ?? 0) + 1;
    if (conflict.status === "proposed" && world.clock.elapsedMonths > (conflict.proposalMonth ?? conflict.startMonth)) {
      const politics = world.politicalEconomy.stateCapacity.find((item) => item.countryId === conflict.initiatorCountryId);
      const approval = (conflict.decisionScoreBps ?? 0) + (politics?.policyCredibilityBps ?? 5_000) * 0.15;
      conflict.status = approval >= 6_700 ? "approved" : "rejected"; conflict.approvedMonth = approval >= 6_700 ? world.clock.elapsedMonths : null; conflict.monthsInStatus = 0;
    } else if (conflict.status === "approved") {
      conflict.status = "mobilizing"; conflict.monthsInStatus = 0;
      for (const countryId of conflict.participantCountryIds) {
        const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
        if (defense) mobilizeConflict(world, conflict.id, countryId, Math.max(1, Math.round(defense.reserveActivationCapacity * 0.18)), 350);
      }
    } else if (conflict.status === "mobilizing" && (conflict.monthsInStatus ?? 0) >= 1) activateConflict(world, conflict.id);
  }
}

function applyPendingRouteDamage(world: WorldState): void {
  for (const route of world.tradeRoutes) {
    const damageBps = route.conflictDamageBps ?? 0;
    if (damageBps <= 0) continue;
    route.capacityMilliUnits = Math.max(1, Math.round(route.capacityMilliUnits * (10_000 - damageBps) / 10_000));
    route.reconstructionBacklogMinor = (route.reconstructionBacklogMinor ?? 0) + Math.round(route.capacityMilliUnits * damageBps / 10_000);
    route.conflictDamageBps = 0;
    route.usedCapacityMilliUnits = Math.min(route.usedCapacityMilliUnits, route.capacityMilliUnits);
  }
}

export function runConflictPreEconomy(world: WorldState): void {
  autonomousInitiation(world);
  advanceProposals(world);
  applyPendingRouteDamage(world);
}

function applyCasualties(world: WorldState, countryId: string, losses: number): void {
  const cohorts = world.populationCohorts.filter((item) => item.countryId === countryId && item.ageBand !== "65+");
  const population = cohorts.reduce((sum, item) => sum + item.populationCount, 0);
  let remaining = losses;
  for (const [index, cohort] of cohorts.entries()) {
    const killed = Math.min(cohort.populationCount, index === cohorts.length - 1 ? remaining : Math.round(losses * cohort.populationCount / Math.max(1, population)));
    cohort.populationCount -= killed;
    cohort.employedCount = Math.min(cohort.employedCount, cohort.populationCount);
    remaining -= killed;
  }
}

function allianceResponse(world: WorldState, conflict: ArmedConflict): void {
  if ((conflict.monthsInStatus ?? 0) !== 1) return;
  for (const alliance of world.defenseEconomy.alliances.filter((item) => item.memberCountryIds.includes(conflict.defenderCountryId))) {
    for (const allyId of alliance.memberCountryIds.filter((item) => item !== conflict.defenderCountryId && item !== conflict.initiatorCountryId)) {
      const ally = world.defenseEconomy.countries.find((item) => item.countryId === allyId);
      if (!ally || alliance.mutualSupportCommitmentBps < 4_000) continue;
      const equipment = Math.round(ally.equipmentStockMinor * alliance.mutualSupportCommitmentBps / 10_000 / 1_000);
      const supplies = Math.round(ally.medicalLogisticsStockMinor * alliance.mutualSupportCommitmentBps / 10_000 / 500);
      if (transferDefenseAid(world, allyId, conflict.defenderCountryId, equipment, supplies)) conflict.causeCodes.push(`alliance-aid:${allyId}`);
    }
  }
}

function applyConflictOperations(world: WorldState, conflict: ArmedConflict): void {
  const [leftId, rightId] = conflict.participantCountryIds;
  allianceResponse(world, conflict);
  const averagePressure = conflict.participantCountryIds.reduce((sum, id) => sum + (conflict.continuationPressureBpsByCountry[id] ?? 0), 0) / conflict.participantCountryIds.length;
  conflict.intensityBps = clamp(conflict.intensityBps + (5_000 - averagePressure) / 80, 800, 7_500);
  for (const [countryId, opponentId] of [[leftId, rightId], [rightId, leftId]] as const) {
    const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
    const opponent = world.defenseEconomy.countries.find((item) => item.countryId === opponentId);
    if (!defense || !opponent) continue;
    const supply = Math.min(defense.munitionsStockMinor, defense.fuelStockMinor, defense.sparePartsStockMinor);
    const monthlyGdp = world.countryEconomicAccounts.closedByCountry[countryId]?.production.valueAddedMinor ?? world.countryScaleReconciliations.find((item) => item.countryId === countryId)?.targetMonthlyNominalGdpMinor ?? 1;
    const supplyBps = clamp(supply * 10_000 / Math.max(1, monthlyGdp));
    const ownDomain = capability(world, countryId);
    const enemyDomain = capability(world, opponentId);
    const operationalBps = clamp(defense.readinessBps * 0.4 + supplyBps * 0.2 + defense.logisticsReadinessBps * 0.15 + ownDomain * 0.25);
    const lossRateBps = clamp(conflict.intensityBps * Math.max(1, enemyDomain) / Math.max(1, operationalBps) / 35, 3, 160);
    const personnelLoss = Math.min(defense.activePersonnel, Math.round(defense.activePersonnel * lossRateBps / 10_000));
    const equipmentLoss = Math.min(defense.equipmentStockMinor, Math.round(defense.equipmentStockMinor * lossRateBps / 10_000));
    defense.activePersonnel -= personnelLoss; defense.mobilizedPersonnel = Math.max(0, (defense.mobilizedPersonnel ?? 0) - personnelLoss); defense.equipmentStockMinor -= equipmentLoss;
    applyCasualties(world, countryId, personnelLoss);
    conflict.militaryLossesByCountry[countryId] += personnelLoss; conflict.equipmentLossMinorByCountry[countryId] += equipmentLoss;
    for (const domain of defense.domainStates ?? []) { const loss = Math.round(equipmentLoss * domain.personnelShareBps / 10_000); domain.grossCapitalMinor = Math.max(0, domain.grossCapitalMinor - loss); domain.serviceableCapitalMinor = Math.min(domain.serviceableCapitalMinor, domain.grossCapitalMinor); }
    const use = Math.min(supply, Math.round(monthlyGdp * conflict.intensityBps / 200_000));
    defense.munitionsStockMinor = Math.max(0, defense.munitionsStockMinor - Math.round(use * 0.45)); defense.fuelStockMinor = Math.max(0, defense.fuelStockMinor - Math.round(use * 0.35)); defense.sparePartsStockMinor = Math.max(0, defense.sparePartsStockMinor - Math.round(use * 0.2));
    const damage = Math.round(monthlyGdp * conflict.intensityBps / 12_000_000);
    conflict.capitalDamageMinorByCountry[countryId] += damage;
    const logistics = world.logisticsSectors.find((item) => item.countryId === countryId);
    if (logistics) logistics.capacityMilliUnits = Math.max(1, logistics.capacityMilliUnits - Math.round(logistics.capacityMilliUnits * conflict.intensityBps / 24_000_000));
    const firms = world.firmCohorts.filter((item) => item.countryId === countryId);
    const explicitCompanies = world.companies.filter((item) => item.active && item.headquartersCountryId === countryId && item.productiveCapital.bookValueCents > 0);
    const cohortCapital = firms.reduce((sum, firm) => sum + firm.capitalCents, 0);
    const explicitCapital = explicitCompanies.reduce((sum, company) => sum + company.productiveCapital.bookValueCents, 0);
    const explicitDamagePool = Math.round(damage * explicitCapital / Math.max(1, explicitCapital + cohortCapital));
    const cohortDamagePool = Math.max(0, damage - explicitDamagePool);
    for (const firm of firms) firm.capitalCents = Math.max(0, firm.capitalCents - Math.round(cohortDamagePool * firm.capitalCents / Math.max(1, cohortCapital)));
    for (const company of explicitCompanies) {
      const companyDamage = Math.min(company.productiveCapital.bookValueCents, Math.max(0, Math.round(explicitDamagePool * company.productiveCapital.bookValueCents / Math.max(1, explicitCapital))));
      if (companyDamage <= 0) continue;
      const currency = world.countries.find((item) => item.id === countryId)?.currencyReference ?? "RUB";
      const impairmentExpense = `expense:asset-impairment:${company.id}`;
      ensureAccount(world.ledger, impairmentExpense, company.id, "Убыток от повреждения капитала", "expense", currency);
      ensureAccount(world.ledger, accountIds.productiveCapital(company.id), company.id, "Производственный капитал", "asset", currency);
      const transactionId = postTransaction(world, "ASSET_IMPAIRMENT", `Военный ущерб ${conflict.id}`, [
        { accountId: impairmentExpense, side: "debit", amountCents: companyDamage },
        { accountId: accountIds.productiveCapital(company.id), side: "credit", amountCents: companyDamage },
      ], [conflict.id]);
      company.productiveCapital.bookValueCents -= companyDamage;
      recordInsuranceLossEvent(world, { ownerId: company.id, assetId: accountIds.productiveCapital(company.id), line: "corporate", category: "conflict-damage", sourceSystem: "conflict-engine", economicLossMinor: companyDamage, description: `Повреждение производственного капитала в конфликте ${conflict.id}`, causeIds: [conflict.id, transactionId] });
    }
    const disruption = clamp(conflict.intensityBps * 0.35);
    conflict.tradeDisruptionBpsByCountry[countryId] = disruption;
    for (const route of world.tradeRoutes.filter((item) => item.originCountryId === countryId || item.destinationCountryId === countryId)) route.conflictDamageBps = clamp((route.conflictDamageBps ?? 0) + disruption / 240, 0, 600);
    conflict.fiscalCostMinorByCountry[countryId] += defense.personnelSpendingMinor + defense.procurementSpendingMinor + defense.operationsMaintenanceMinor;
    conflict.civilianConsumptionLossMinorByCountry[countryId] += Math.round(monthlyGdp * (conflict.industrialConversionBpsByCountry[countryId] ?? 0) / 10_000);
    conflict.continuationPressureBpsByCountry[countryId] = clamp((10_000 - defense.readinessBps) * 0.3 + conflict.militaryLossesByCountry[countryId] * 10_000 / Math.max(1, defense.activePersonnel + conflict.militaryLossesByCountry[countryId]) + conflict.capitalDamageMinorByCountry[countryId] * 1_500 / Math.max(1, monthlyGdp) + (conflict.expectedCostBps ?? 0) * 0.2);
  }
  if (conflict.participantCountryIds.every((id) => conflict.continuationPressureBpsByCountry[id] > 6_500) || (conflict.monthsInStatus ?? 0) >= 60) {
    conflict.status = "ceasefire"; conflict.ceasefireMonth = world.clock.elapsedMonths; conflict.monthsInStatus = 0; conflict.causeCodes.push("mutual-cost-pressure");
  }
}

function restoreAfterSettlement(world: WorldState, conflict: ArmedConflict): void {
  for (const countryId of conflict.participantCountryIds) {
    const defense = world.defenseEconomy.countries.find((item) => item.countryId === countryId);
    if (!defense) continue;
    const returning = Math.min(defense.mobilizedPersonnel ?? 0, conflict.mobilizationByCountry[countryId] ?? 0);
    const cohorts = world.populationCohorts.filter((item) => item.countryId === countryId);
    const population = cohorts.reduce((sum, item) => sum + item.populationCount, 0);
    for (const cohort of cohorts) cohort.employedCount = Math.min(cohort.populationCount, cohort.employedCount + Math.round(returning * cohort.populationCount / Math.max(1, population)));
    defense.activePersonnel = Math.max(0, defense.activePersonnel - returning); defense.reservePersonnel += returning; defense.mobilizedPersonnel = 0;
    defense.targetSpendingToGdpBps = Math.max(defense.baselineTargetSpendingToGdpBps ?? 100, Math.round(defense.targetSpendingToGdpBps * 0.98));
  }
}

export function runConflictPostEconomy(world: WorldState): void {
  for (const conflict of world.conflicts.conflicts) {
    if (conflict.status === "active") applyConflictOperations(world, conflict);
    else if (conflict.status === "ceasefire" && (conflict.monthsInStatus ?? 0) >= 2) { conflict.status = "negotiation"; conflict.negotiationMonth = world.clock.elapsedMonths; conflict.monthsInStatus = 0; }
    else if (conflict.status === "negotiation" && (conflict.monthsInStatus ?? 0) >= 3) settleConflict(world, conflict.id);
  }
}

export function runConflictMonth(world: WorldState): void { runConflictPostEconomy(world); }

export function settleConflict(world: WorldState, conflictId: string): boolean {
  const conflict = world.conflicts.conflicts.find((item) => item.id === conflictId && ["ceasefire", "negotiation", "active"].includes(item.status));
  if (!conflict) return false;
  conflict.status = "settled"; conflict.endMonth ??= world.clock.elapsedMonths; conflict.monthsInStatus = 0; conflict.causeCodes.push("negotiated-settlement");
  restoreAfterSettlement(world, conflict);
  return true;
}
