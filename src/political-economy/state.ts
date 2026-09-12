import { seedDeposit } from "../core/ledger.ts";
import type { InstitutionType, PoliticalEconomyState, WorldState } from "../domain/model.ts";
import { REAL_WORLD_INSTITUTION_PROFILES } from "./profiles.ts";

export function createPoliticalEconomyState(): PoliticalEconomyState {
  return { institutions: [], stateCapacity: [], interestGroups: [], policyProposals: [], coalitions: [], procurementContracts: [], corruptionNetworks: [], shadowEconomy: [], compliance: [], connectedLending: [], soeGovernance: [], zombieFirms: [], decisionTraces: [], nextProposalId: 1, nextCoalitionId: 1, nextProcurementId: 1, nextDecisionTraceId: 1 };
}

export function seedPoliticalEconomy(world: WorldState): void {
  world.politicalEconomy ??= createPoliticalEconomyState();
  const types: InstitutionType[] = ["executive", "legislature", "judiciary", "regulator", "tax-authority", "procurement-authority"];
  for (const country of world.countries) {
    const profile = world.countryEconomicProfiles.find((item) => item.countryId === country.id);
    const institutional = world.baselineReference.mode === "REAL_WORLD" ? REAL_WORLD_INSTITUTION_PROFILES[country.id] : undefined;
    const base = institutional ? Math.round((institutional.taxAdministrationBps + institutional.regulatoryCapacityBps + institutional.contractEnforcementBps + institutional.procurementIntegrityBps + institutional.corruptionEnforcementBps + institutional.policyStabilityBps) / 6) : Math.max(3_500, Math.min(9_000, Math.round(4_000 + (profile?.productivityIndexBps ?? 8_000) * 0.35)));
    if (!world.politicalEconomy.institutions.some((item) => item.countryId === country.id)) for (const [index, type] of types.entries()) world.politicalEconomy.institutions.push({ id: `institution:${country.id}:${type}`, countryId: country.id, type, capacityBps: Math.max(2_500, base - index * 120), independenceBps: Math.max(2_000, base - 700 + index * 90), integrityBps: Math.max(2_000, base - 350 - index * 70), accountabilityBps: Math.max(2_000, base - 200 + index * 40) });
    if (!world.politicalEconomy.compliance.some((item) => item.countryId === country.id)) world.politicalEconomy.compliance.push({ countryId: country.id, taxComplianceBps: Math.min(9_500, base + 400), labourComplianceBps: Math.min(9_500, base), financialComplianceBps: Math.min(9_500, base + 250), beneficialOwnershipTransparencyBps: Math.max(2_000, base - 500), updatedAtMonth: 0 });
    if (!world.politicalEconomy.corruptionNetworks.some((item) => item.countryId === country.id)) world.politicalEconomy.corruptionNetworks.push({ id: `corruption-network:${country.id}`, countryId: country.id, memberEntityIds: [`institution:${country.id}:procurement-authority`], captureBps: Math.max(250, 10_000 - base), hiddenBalanceMinor: 0, detectedLossMinor: 0, transactionIds: [] });
    const bank = world.banks.find((item) => item.countryId === country.id);
    const companies = world.companies.filter((item) => item.headquartersCountryId === country.id && item.active);
    if (bank) for (const institution of world.politicalEconomy.institutions.filter((item) => item.countryId === country.id)) if (!world.bankAccounts.some((item) => item.ownerId === institution.id)) seedDeposit(world, institution.id, bank.id, 1);
    const groupSeeds = [
      { type: "business" as const, entities: companies.slice(0, 3).map((item) => item.id), preference: "industrial-policy" },
      { type: "finance" as const, entities: bank ? [bank.id] : [], preference: "banking" },
      { type: "labour" as const, entities: world.populationCohorts.filter((item) => item.countryId === country.id).slice(0, 3).map((item) => item.id), preference: "labour-formalization" },
    ];
    for (const seed of groupSeeds) {
      const id = `interest-group:${country.id}:${seed.type}`;
      if (!world.politicalEconomy.interestGroups.some((item) => item.id === id)) world.politicalEconomy.interestGroups.push({ id, countryId: country.id, type: seed.type, memberEntityIds: seed.entities, resourcesMinor: 2_000_000, influenceBps: seed.type === "business" ? 6_000 : 5_000, preferredPolicy: seed.preference, lobbyingTransactionIds: [] });
      if (bank && !world.bankAccounts.some((item) => item.ownerId === id)) seedDeposit(world, id, bank.id, 2_000_000);
    }
    const network = world.politicalEconomy.corruptionNetworks.find((item) => item.countryId === country.id)!;
    if (bank && !world.bankAccounts.some((item) => item.ownerId === network.id)) seedDeposit(world, network.id, bank.id, 1);
    if (bank && companies[0] && !world.politicalEconomy.connectedLending.some((item) => item.countryId === country.id)) world.politicalEconomy.connectedLending.push({ id: `connected-lending:${country.id}`, countryId: country.id, bankId: bank.id, borrowerCompanyId: companies[0].id, connectionBps: Math.max(1_000, 10_000 - base), preferentialSpreadBps: 250, loanIds: [], status: "active" });
  }
  const controlled = new Set(world.geoeconomics.soeMandates.map((item) => item.companyId));
  world.politicalEconomy.soeGovernance = world.politicalEconomy.soeGovernance.filter((item) => controlled.has(item.companyId));
  for (const mandate of world.geoeconomics.soeMandates) if (!world.politicalEconomy.soeGovernance.some((item) => item.companyId === mandate.companyId)) world.politicalEconomy.soeGovernance.push({ companyId: mandate.companyId, countryId: mandate.countryId, boardIndependenceBps: 4_500, disclosureBps: 6_000, politicalAppointmentsBps: 5_500, softBudgetConstraintBps: mandate.softBudgetConstraintBps, subsidyTransactionIds: [] });
}
