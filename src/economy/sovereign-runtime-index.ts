import type { SovereignBond, WorldState } from "../domain/model.ts";

interface SovereignRuntimeIndex {
  source: WorldState["sovereignBonds"];
  sourceLength: number;
  active: SovereignBond[];
  byGovernment: Map<string, SovereignBond[]>;
  byCountry: Map<string, SovereignBond[]>;
  outstandingByGovernment: Map<string, SovereignBond[]>;
}

const indexes = new WeakMap<WorldState, SovereignRuntimeIndex>();

export function invalidateSovereignRuntimeIndex(world: WorldState): void {
  indexes.delete(world);
}

function performing(bond: SovereignBond): boolean {
  return bond.status === "active" || bond.status === "restructured";
}

function build(world: WorldState): SovereignRuntimeIndex {
  const active = world.sovereignBonds.filter(performing);
  const byGovernment = new Map<string, SovereignBond[]>();
  const byCountry = new Map<string, SovereignBond[]>();
  const outstandingByGovernment = new Map<string, SovereignBond[]>();
  for (const bond of world.sovereignBonds) if (bond.status !== "matured") {
    const outstanding = outstandingByGovernment.get(bond.governmentId) ?? [];
    outstanding.push(bond);
    outstandingByGovernment.set(bond.governmentId, outstanding);
  }
  for (const bond of active) {
    const government = byGovernment.get(bond.governmentId) ?? [];
    government.push(bond);
    byGovernment.set(bond.governmentId, government);
    const country = byCountry.get(bond.countryId) ?? [];
    country.push(bond);
    byCountry.set(bond.countryId, country);
  }
  const index = { source: world.sovereignBonds, sourceLength: world.sovereignBonds.length, active, byGovernment, byCountry, outstandingByGovernment };
  indexes.set(world, index);
  return index;
}

function indexFor(world: WorldState): SovereignRuntimeIndex {
  let index = indexes.get(world);
  if (!index || index.source !== world.sovereignBonds || index.sourceLength !== world.sovereignBonds.length) return build(world);
  if (index.active.some((bond) => !performing(bond))) index = build(world);
  return index;
}

export function activeSovereignBonds(world: WorldState): readonly SovereignBond[] {
  return indexFor(world).active;
}

export function activeSovereignBondsForGovernment(world: WorldState, governmentId: string): readonly SovereignBond[] {
  return indexFor(world).byGovernment.get(governmentId) ?? [];
}

export function activeSovereignBondsForCountry(world: WorldState, countryId: string): readonly SovereignBond[] {
  return indexFor(world).byCountry.get(countryId) ?? [];
}

export function outstandingSovereignBondsForGovernment(world: WorldState, governmentId: string): readonly SovereignBond[] {
  return indexFor(world).outstandingByGovernment.get(governmentId) ?? [];
}
