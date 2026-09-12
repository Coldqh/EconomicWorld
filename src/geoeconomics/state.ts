import type { GeoeconomicsState, WorldState } from "../domain/model.ts";

const members = (world: WorldState, ids: string[]): string[] => ids.filter((id) => world.countries.some((country) => country.id === id));

export function createGeoeconomicsState(): GeoeconomicsState {
  return {
    strategicInterests: [], directionalDependencies: [], policies: [], tradeAgreements: [], blocs: [], soeMandates: [],
    industrialPolicyPrograms: [], sovereignLendingFacilities: [], decisionTraces: [],
    nextPolicyId: 1, nextDecisionTraceId: 1, nextProgramId: 1, nextFacilityId: 1,
  };
}

export function seedGeoeconomics(world: WorldState): void {
  world.geoeconomics ??= createGeoeconomicsState();
  if (world.geoeconomics.blocs.length === 0) {
    const eu = members(world, ["de", "fr", "it", "es", "nl"]);
    const pacific = members(world, ["us", "ca", "jp", "kr"]);
    if (eu.length > 1) world.geoeconomics.blocs.push({ id: "bloc-europe", name: "Европейский экономический блок", memberCountryIds: eu, coordinationBps: 8_000 });
    if (pacific.length > 1) world.geoeconomics.blocs.push({ id: "bloc-pacific", name: "Тихоокеанское партнёрство", memberCountryIds: pacific, coordinationBps: 6_500 });
    for (const bloc of world.geoeconomics.blocs) world.geoeconomics.tradeAgreements.push({
      id: `agreement-${bloc.id}`, name: bloc.name, memberCountryIds: [...bloc.memberCountryIds], tariffReductionBps: 500,
      investmentAccessBonusBps: 800, startsAtMonth: 0, endsAtMonth: null, status: "active",
    });
  }
  // Cap table is the only ownership source. Invalid legacy metadata is discarded.
  world.geoeconomics.soeMandates = world.companies.flatMap((company) => {
    const security = world.equitySecurities.find((item) => item.id === company.equitySecurityId);
    if (!security || security.sharesOutstanding <= 0) return [];
    const governmentIds = new Set(world.governments.filter((item) => item.countryId === company.headquartersCountryId).map((item) => item.id));
    const stateShares = world.equityHoldings.filter((item) => item.securityId === security.id && governmentIds.has(item.ownerId)).reduce((sum, item) => sum + item.shares, 0);
    const stateOwnershipBps = Math.round(stateShares * 10_000 / security.sharesOutstanding);
    if (stateOwnershipBps < 5_001) return [];
    return [{ companyId: company.id, countryId: company.headquartersCountryId, stateOwnershipBps, mandate: company.goodId === "energy" ? "energy-security" as const : "infrastructure" as const, softBudgetConstraintBps: 4_000 }];
  });
}
