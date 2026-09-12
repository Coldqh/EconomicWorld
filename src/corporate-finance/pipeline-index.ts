import type { WorldState } from "../domain/model.ts";

interface DealPipelineIndex {
  dealsSource: WorldState["mAndADeals"];
  dealsLength: number;
  ipoSource: WorldState["ipoProcesses"];
  ipoLength: number;
  activeDeals: WorldState["mAndADeals"];
  activeIpos: WorldState["ipoProcesses"];
}

const indexes = new WeakMap<WorldState, DealPipelineIndex>();

function build(world: WorldState): DealPipelineIndex {
  const index: DealPipelineIndex = {
    dealsSource: world.mAndADeals,
    dealsLength: world.mAndADeals.length,
    ipoSource: world.ipoProcesses,
    ipoLength: world.ipoProcesses.length,
    activeDeals: world.mAndADeals.filter((deal) => deal.status !== "closed" && deal.status !== "failed"),
    activeIpos: world.ipoProcesses.filter((ipo) => ipo.stage !== "completed" && ipo.stage !== "failed"),
  };
  indexes.set(world, index);
  return index;
}

function pipelineIndex(world: WorldState): DealPipelineIndex {
  const index = indexes.get(world);
  if (!index
    || index.dealsSource !== world.mAndADeals
    || index.dealsLength !== world.mAndADeals.length
    || index.ipoSource !== world.ipoProcesses
    || index.ipoLength !== world.ipoProcesses.length) return build(world);
  index.activeDeals = index.activeDeals.filter((deal) => deal.status !== "closed" && deal.status !== "failed");
  index.activeIpos = index.activeIpos.filter((ipo) => ipo.stage !== "completed" && ipo.stage !== "failed");
  return index;
}

export function activeMAndADeals(world: WorldState): WorldState["mAndADeals"] {
  return pipelineIndex(world).activeDeals;
}

export function activeIpoProcesses(world: WorldState): WorldState["ipoProcesses"] {
  return pipelineIndex(world).activeIpos;
}

