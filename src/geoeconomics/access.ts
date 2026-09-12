import type { GeoeconomicPolicy, WorldState } from "../domain/model.ts";

export type EconomicAccessKind = "trade" | "investment" | "finance" | "asset";

export interface EconomicPolicyAccessRequest {
  sourceCountryId: string;
  destinationCountryId: string;
  kind: EconomicAccessKind;
  commodityId?: string;
}

export interface EconomicPolicyAccessDecision {
  allowed: boolean;
  accessScoreBps: number;
  tariffBps: number;
  reasons: string[];
  evidenceIds: string[];
}

const appliesToCommodity = (policy: GeoeconomicPolicy, commodityId?: string): boolean =>
  policy.commodityIds.length === 0 || (!!commodityId && policy.commodityIds.includes(commodityId));

const activePolicies = (world: WorldState): GeoeconomicPolicy[] => world.geoeconomics.policies.filter((policy) =>
  policy.status === "active"
  && policy.startsAtMonth <= world.clock.elapsedMonths
  && (policy.endsAtMonth === null || policy.endsAtMonth >= world.clock.elapsedMonths));

/** One gateway used by trade, investment and cross-border finance. */
export function evaluateEconomicPolicyAccess(world: WorldState, request: EconomicPolicyAccessRequest): EconomicPolicyAccessDecision {
  let tariffBps = 0;
  let accessScoreBps = 10_000;
  const reasons: string[] = [];
  const evidenceIds: string[] = [];
  let hardFrozen = false;
  const restrictions = activePolicies(world).filter((policy) => {
    if (!appliesToCommodity(policy, request.commodityId)) return false;
    const inbound = policy.actorCountryId === request.destinationCountryId && policy.targetCountryIds.includes(request.sourceCountryId);
    const outbound = policy.actorCountryId === request.sourceCountryId && policy.targetCountryIds.includes(request.destinationCountryId);
    return inbound || outbound;
  });
  for (const policy of restrictions) {
    const inbound = policy.actorCountryId === request.destinationCountryId;
    const relevant =
      (request.kind === "trade" && (policy.kind === "tariff" || policy.kind === "export-control" || policy.kind === "sanction"))
      || (request.kind === "investment" && (policy.kind === "investment-screening" || policy.kind === "capital-control" || policy.kind === "sanction" || policy.kind === "asset-freeze"))
      || (request.kind === "finance" && (policy.kind === "financial-restriction" || policy.kind === "capital-control" || policy.kind === "sanction" || policy.kind === "asset-freeze"))
      || (request.kind === "asset" && (policy.kind === "asset-freeze" || policy.kind === "sanction"));
    if (!relevant) continue;
    evidenceIds.push(policy.id);
    if (policy.kind === "asset-freeze" && (request.kind === "asset" || request.kind === "finance" || request.kind === "investment")) {
      hardFrozen = true;
      reasons.push(`asset-freeze: ${policy.actorCountryId} → ${policy.targetCountryIds.join(", ")}`);
      continue;
    }
    if (policy.kind === "tariff" && inbound && request.kind === "trade") tariffBps += policy.rateBps;
    accessScoreBps -= policy.accessPenaltyBps;
    reasons.push(`${policy.kind}: ${policy.actorCountryId} → ${policy.targetCountryIds.join(", ")}`);
  }
  for (const agreement of world.geoeconomics.tradeAgreements.filter((item) => item.status === "active")) {
    if (!agreement.memberCountryIds.includes(request.sourceCountryId) || !agreement.memberCountryIds.includes(request.destinationCountryId)) continue;
    evidenceIds.push(agreement.id);
    if (request.kind === "trade") tariffBps = Math.max(0, tariffBps - agreement.tariffReductionBps);
    if (request.kind === "investment" || request.kind === "finance") accessScoreBps += agreement.investmentAccessBonusBps;
    reasons.push(`agreement: ${agreement.name}`);
  }
  if ((request.kind === "finance" || request.kind === "investment" || request.kind === "asset") && world.politicalEconomy) {
    const sourceCompliance = world.politicalEconomy.compliance.find((item) => item.countryId === request.sourceCountryId);
    if (sourceCompliance && sourceCompliance.financialComplianceBps < 5_000) {
      const penalty = Math.round((5_000 - sourceCompliance.financialComplianceBps) * 0.75);
      accessScoreBps -= penalty;
      reasons.push(`financial compliance: ${request.sourceCountryId}`);
      evidenceIds.push(`compliance:${request.sourceCountryId}`);
    }
  }
  accessScoreBps = Math.max(0, Math.min(10_000, accessScoreBps));
  tariffBps = Math.max(0, Math.min(20_000, tariffBps));
  return { allowed: !hardFrozen && accessScoreBps >= 2_500, accessScoreBps: hardFrozen ? 0 : accessScoreBps, tariffBps, reasons, evidenceIds: [...new Set(evidenceIds)] };
}
