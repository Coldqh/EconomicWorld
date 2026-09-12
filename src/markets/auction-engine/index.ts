import type { AuctionAllocation, AuctionBid, AuctionMechanism, EconomicAuction, WorldState } from "../../domain/model.ts";

export interface CreateAuctionInput { sellerId: string; objectType: EconomicAuction["objectType"]; objectId: string; mechanism: AuctionMechanism; quantity: number; reserveMinor: number; eligibleBidderIds?: string[]; durationMonths?: number }

export function createAuction(world: WorldState, input: CreateAuctionInput): EconomicAuction {
  const auction: EconomicAuction = { id: `auction-${world.clock.elapsedMonths}-${world.economicAuctions.length + 1}`, sellerId: input.sellerId, objectType: input.objectType, objectId: input.objectId, mechanism: input.mechanism, quantity: Math.max(1, Math.floor(input.quantity)), reserveMinor: Math.max(0, Math.floor(input.reserveMinor)), eligibleBidderIds: input.eligibleBidderIds ?? [], status: "open", openedAtMonth: world.clock.elapsedMonths, closesAtMonth: world.clock.elapsedMonths + Math.max(0, input.durationMonths ?? 1), bids: [], allocations: [] };
  world.economicAuctions.push(auction); return auction;
}

export function submitBid(world: WorldState, auctionId: string, bidderId: string, priceMinor: number, quantity = 1, yieldBps: number | null = null, packageIds: string[] = []): AuctionBid | null {
  const auction = world.economicAuctions.find((item) => item.id === auctionId && item.status === "open");
  if (!auction || priceMinor < 0 || quantity <= 0 || (auction.eligibleBidderIds.length && !auction.eligibleBidderIds.includes(bidderId))) return null;
  if (auction.mechanism === "english" && auction.bids.length && priceMinor <= Math.max(...auction.bids.map((bid) => bid.priceMinor))) return null;
  const bid: AuctionBid = { id: `bid-${auction.id}-${auction.bids.length + 1}`, auctionId, bidderId, priceMinor: Math.floor(priceMinor), yieldBps, quantity: Math.floor(quantity), packageIds, sequence: auction.bids.length + 1, submittedAtMonth: world.clock.elapsedMonths };
  auction.bids.push(bid); return bid;
}

function allocateMultiUnit(valid: AuctionBid[], quantity: number, uniform: boolean): AuctionAllocation[] {
  const ranked = [...valid].sort((a, b) => b.priceMinor - a.priceMinor || a.sequence - b.sequence); let remaining = quantity; const accepted: Array<{ bid: AuctionBid; quantity: number }> = [];
  for (const bid of ranked) { const fill = Math.min(remaining, bid.quantity); if (fill > 0) accepted.push({ bid, quantity: fill }); remaining -= fill; if (!remaining) break; }
  const clearing = accepted.at(-1)?.bid.priceMinor ?? 0;
  return accepted.map(({ bid, quantity: fill }) => ({ bidderId: bid.bidderId, quantity: fill, clearingPriceMinor: uniform ? clearing : bid.priceMinor, bidId: bid.id }));
}

export function clearAuction(world: WorldState, auctionId: string, descendingAcceptanceMinor?: number): AuctionAllocation[] {
  const auction = world.economicAuctions.find((item) => item.id === auctionId && item.status === "open"); if (!auction) return [];
  const reverse = auction.mechanism === "reverse-first-price";
  const valid = auction.bids.filter((bid) => reverse ? bid.priceMinor <= auction.reserveMinor : bid.priceMinor >= auction.reserveMinor); let allocations: AuctionAllocation[] = [];
  const ranked = [...valid].sort((a, b) => reverse ? a.priceMinor - b.priceMinor || a.sequence - b.sequence : b.priceMinor - a.priceMinor || a.sequence - b.sequence);
  if (auction.mechanism === "dutch") { const accepted = auction.bids.find((bid) => bid.priceMinor >= auction.reserveMinor && (descendingAcceptanceMinor == null || bid.priceMinor >= descendingAcceptanceMinor)); if (accepted) allocations = [{ bidderId: accepted.bidderId, quantity: Math.min(auction.quantity, accepted.quantity), clearingPriceMinor: descendingAcceptanceMinor ?? accepted.priceMinor, bidId: accepted.id }]; }
  else if (auction.mechanism === "vickrey" && ranked[0]) allocations = [{ bidderId: ranked[0].bidderId, quantity: 1, clearingPriceMinor: Math.max(auction.reserveMinor, ranked[1]?.priceMinor ?? auction.reserveMinor), bidId: ranked[0].id }];
  else if ((auction.mechanism === "english" || auction.mechanism === "first-price" || auction.mechanism === "reverse-first-price") && ranked[0]) allocations = [{ bidderId: ranked[0].bidderId, quantity: Math.min(auction.quantity, ranked[0].quantity), clearingPriceMinor: ranked[0].priceMinor, bidId: ranked[0].id }];
  else if (auction.mechanism === "uniform-price") allocations = allocateMultiUnit(valid, auction.quantity, true);
  else if (auction.mechanism === "pay-as-bid") allocations = allocateMultiUnit(valid, auction.quantity, false);
  auction.allocations = allocations; auction.status = allocations.length ? "closed" : "failed"; return allocations;
}

export function settleAuction(world: WorldState, auctionId: string, settlement: (allocation: AuctionAllocation, auction: EconomicAuction) => boolean): boolean {
  const auction = world.economicAuctions.find((item) => item.id === auctionId && item.status === "closed"); if (!auction) return false;
  if (!auction.allocations.every((allocation) => settlement(allocation, auction))) return false; auction.status = "settled"; return true;
}
