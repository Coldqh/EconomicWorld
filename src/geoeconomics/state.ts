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
  if (world.geoeconomics.soeMandates.length === 0) {
    for (const country of world.countries) {
      const company = world.companies.find((item) => item.headquartersCountryId === country.id && item.active);
      if (company) world.geoeconomics.soeMandates.push({ companyId: company.id, countryId: country.id, stateOwnershipBps: 5_100, mandate: company.goodId === "energy" ? "energy-security" : "infrastructure", softBudgetConstraintBps: 4_000 });
    }
  }
}

