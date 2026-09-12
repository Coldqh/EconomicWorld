import type { BrokerageAccount, MarketOrder, WorldState } from "../domain/model.ts";

const ACTIVE = new Set<MarketOrder["status"]>(["open", "partially-filled"]);

interface BookSide {
  market: MarketOrder[];
  priceKeys: number[];
  levels: Map<number, MarketOrder[]>;
  direction: "buy" | "sell";
}

interface OrderBook {
  buy: BookSide;
  sell: BookSide;
}

export interface MarketRuntimeIndex {
  ordersRef: MarketOrder[];
  orderCount: number;
  listingCount: number;
  brokerageCount: number;
  bankAccountCount: number;
  agentCount: number;
  books: Map<string, OrderBook>;
  orderById: Map<string, MarketOrder>;
  brokerageById: Map<string, BrokerageAccount>;
  brokerageByOwner: Map<string, BrokerageAccount>;
  brokerageByOwnerCurrency: Map<string, BrokerageAccount>;
  ownerActiveOrders: Map<string, Set<MarketOrder>>;
  brokerageActiveBuys: Map<string, Set<MarketOrder>>;
  listingsBySecurity: Map<string, WorldState["listings"]>;
  listingByPair: Map<string, WorldState["listings"][number]>;
  securityVenueIndex: Map<string, string[]>;
  venueSecurityIndex: Map<string, string[]>;
  crossListedSecurityIds: string[];
  arbitrageVenuePairs: Map<string, Array<[string, string]>>;
  makerIdsByPair: Map<string, string[]>;
  arbitrageAgents: WorldState["marketAgents"];
  fxTrianglesByOwner: Map<string, Array<[string, string, string]>>;
  exchangeById: Map<string, WorldState["exchanges"][number]>;
  brokerById: Map<string, WorldState["brokers"][number]>;
  bankAccountById: Map<string, WorldState["bankAccounts"][number]>;
}

const cache = new WeakMap<WorldState, MarketRuntimeIndex>();

interface OhlcvRuntimeIndex {
  source: WorldState["ohlcvBars"];
  indexedLength: number;
  bySecurity: Map<string, WorldState["ohlcvBars"]>;
  bySecurityMonth: Map<string, WorldState["ohlcvBars"][number]>;
}

const ohlcvIndexes = new WeakMap<WorldState, OhlcvRuntimeIndex>();

function ohlcvKey(securityId: string, elapsedMonth: number): string {
  return `${securityId}\u0000${elapsedMonth}`;
}

function ohlcvRuntimeIndex(world: WorldState): OhlcvRuntimeIndex {
  let index = ohlcvIndexes.get(world);
  if (!index || index.source !== world.ohlcvBars || index.indexedLength > world.ohlcvBars.length) {
    index = { source: world.ohlcvBars, indexedLength: 0, bySecurity: new Map(), bySecurityMonth: new Map() };
    ohlcvIndexes.set(world, index);
  }
  for (let position = index.indexedLength; position < world.ohlcvBars.length; position += 1) {
    const bar = world.ohlcvBars[position];
    const bars = index.bySecurity.get(bar.securityId) ?? [];
    bars.push(bar);
    index.bySecurity.set(bar.securityId, bars);
    index.bySecurityMonth.set(ohlcvKey(bar.securityId, bar.elapsedMonth), bar);
  }
  index.indexedLength = world.ohlcvBars.length;
  return index;
}

export function ohlcvBarForMonth(world: WorldState, securityId: string, elapsedMonth: number) {
  return ohlcvRuntimeIndex(world).bySecurityMonth.get(ohlcvKey(securityId, elapsedMonth));
}

export function recentOhlcvBars(world: WorldState, securityId: string, count: number): WorldState["ohlcvBars"] {
  const bars = ohlcvRuntimeIndex(world).bySecurity.get(securityId) ?? [];
  return bars.length <= count ? bars : bars.slice(bars.length - count);
}

export function registerOhlcvBar(world: WorldState, bar: WorldState["ohlcvBars"][number]): void {
  const index = ohlcvRuntimeIndex(world);
  if (index.bySecurityMonth.has(ohlcvKey(bar.securityId, bar.elapsedMonth))) return;
  const bars = index.bySecurity.get(bar.securityId) ?? [];
  bars.push(bar);
  index.bySecurity.set(bar.securityId, bars);
  index.bySecurityMonth.set(ohlcvKey(bar.securityId, bar.elapsedMonth), bar);
  index.indexedLength = world.ohlcvBars.length;
}

export function marketPairKey(securityId: string, exchangeId: string): string {
  return `${securityId}\u0000${exchangeId}`;
}

function ownerCurrencyKey(ownerId: string, currencyId: string): string {
  return `${ownerId}\u0000${currencyId}`;
}

function active(order: MarketOrder): boolean {
  return ACTIVE.has(order.status) && order.remainingQuantity > 0;
}

function makeSide(direction: "buy" | "sell"): BookSide {
  return { market: [], priceKeys: [], levels: new Map(), direction };
}

function bookFor(index: MarketRuntimeIndex, order: MarketOrder): OrderBook {
  const key = marketPairKey(order.securityId, order.exchangeId);
  let book = index.books.get(key);
  if (!book) {
    book = { buy: makeSide("buy"), sell: makeSide("sell") };
    index.books.set(key, book);
  }
  return book;
}

function insertPrice(keys: number[], price: number, direction: "buy" | "sell"): void {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const before = direction === "buy" ? keys[middle] > price : keys[middle] < price;
    if (before) low = middle + 1;
    else high = middle;
  }
  if (keys[low] !== price) keys.splice(low, 0, price);
}

function indexOrder(index: MarketRuntimeIndex, order: MarketOrder): void {
  index.orderById.set(order.id, order);
  if (!active(order)) return;
  const side = bookFor(index, order)[order.side];
  if (order.type === "market") side.market.push(order);
  else {
    const price = order.limitPriceCents!;
    let queue = side.levels.get(price);
    if (!queue) {
      queue = [];
      side.levels.set(price, queue);
      insertPrice(side.priceKeys, price, side.direction);
    }
    queue.push(order);
  }
  const owner = index.brokerageById.get(order.brokerageAccountId)?.ownerId;
  if (owner) {
    const orders = index.ownerActiveOrders.get(owner) ?? new Set<MarketOrder>();
    orders.add(order);
    index.ownerActiveOrders.set(owner, orders);
  }
  if (order.side === "buy") {
    const orders = index.brokerageActiveBuys.get(order.brokerageAccountId) ?? new Set<MarketOrder>();
    orders.add(order);
    index.brokerageActiveBuys.set(order.brokerageAccountId, orders);
  }
}

function build(world: WorldState): MarketRuntimeIndex {
  const brokerageById = new Map(world.brokerageAccounts.map((item) => [item.id, item]));
  const index: MarketRuntimeIndex = {
    ordersRef: world.marketOrders,
    orderCount: world.marketOrders.length,
    listingCount: world.listings.length,
    brokerageCount: world.brokerageAccounts.length,
    bankAccountCount: world.bankAccounts.length,
    agentCount: world.marketAgents.length,
    books: new Map(),
    orderById: new Map(),
    brokerageById,
    brokerageByOwner: new Map(),
    brokerageByOwnerCurrency: new Map(),
    ownerActiveOrders: new Map(),
    brokerageActiveBuys: new Map(),
    listingsBySecurity: new Map(),
    listingByPair: new Map(),
    securityVenueIndex: new Map(),
    venueSecurityIndex: new Map(),
    crossListedSecurityIds: [],
    arbitrageVenuePairs: new Map(),
    makerIdsByPair: new Map(),
    arbitrageAgents: world.marketAgents.filter((item) => item.active && item.kind === "arbitrageur"),
    fxTrianglesByOwner: new Map(),
    exchangeById: new Map(world.exchanges.map((item) => [item.id, item])),
    brokerById: new Map(world.brokers.map((item) => [item.id, item])),
    bankAccountById: new Map(world.bankAccounts.map((item) => [item.id, item])),
  };
  for (const account of world.brokerageAccounts) {
    if (account.status !== "active") continue;
    if (!index.brokerageByOwner.has(account.ownerId)) index.brokerageByOwner.set(account.ownerId, account);
    const key = ownerCurrencyKey(account.ownerId, account.currencyId);
    if (!index.brokerageByOwnerCurrency.has(key)) index.brokerageByOwnerCurrency.set(key, account);
  }
  for (const listing of world.listings) {
    const listings = index.listingsBySecurity.get(listing.securityId) ?? [];
    listings.push(listing);
    index.listingsBySecurity.set(listing.securityId, listings);
    index.listingByPair.set(marketPairKey(listing.securityId, listing.exchangeId), listing);
    const venues = index.securityVenueIndex.get(listing.securityId) ?? [];
    if (!venues.includes(listing.exchangeId)) venues.push(listing.exchangeId);
    index.securityVenueIndex.set(listing.securityId, venues);
    const securities = index.venueSecurityIndex.get(listing.exchangeId) ?? [];
    if (!securities.includes(listing.securityId)) securities.push(listing.securityId);
    index.venueSecurityIndex.set(listing.exchangeId, securities);
  }
  for (const [securityId, venues] of index.securityVenueIndex) {
    if (venues.length < 2) continue;
    index.crossListedSecurityIds.push(securityId);
    const pairs: Array<[string, string]> = [];
    for (let left = 0; left < venues.length - 1; left += 1) {
      for (let right = left + 1; right < venues.length; right += 1) pairs.push([venues[left], venues[right]]);
    }
    index.arbitrageVenuePairs.set(securityId, pairs);
  }
  for (const listing of world.listings) {
    const makers = world.marketAgents
      .filter((item) => item.active && item.kind === "market-maker" && item.exchangeIds.includes(listing.exchangeId))
      .map((item) => item.id);
    index.makerIdsByPair.set(marketPairKey(listing.securityId, listing.exchangeId), makers);
  }
  for (const agent of index.arbitrageAgents) {
    if (index.fxTrianglesByOwner.has(agent.ownerId)) continue;
    const currencies = [...new Set(world.bankAccounts.filter((account) => account.ownerId === agent.ownerId && account.status === "active").map((account) => account.currencyId))];
    const triangles: Array<[string, string, string]> = [];
    for (let first = 0; first < currencies.length - 2; first += 1) {
      for (let second = first + 1; second < currencies.length - 1; second += 1) {
        for (let third = second + 1; third < currencies.length; third += 1) triangles.push([currencies[first], currencies[second], currencies[third]]);
      }
    }
    index.fxTrianglesByOwner.set(agent.ownerId, triangles);
  }
  for (const order of world.marketOrders) indexOrder(index, order);
  cache.set(world, index);
  return index;
}

export function marketRuntimeIndex(world: WorldState): MarketRuntimeIndex {
  const index = cache.get(world);
  if (!index
    || index.ordersRef !== world.marketOrders
    || index.orderCount !== world.marketOrders.length
    || index.listingCount !== world.listings.length
    || index.brokerageCount !== world.brokerageAccounts.length
    || index.bankAccountCount !== world.bankAccounts.length
    || index.agentCount !== world.marketAgents.length) return build(world);
  return index;
}

export function invalidateMarketRuntimeIndex(world: WorldState): void {
  cache.delete(world);
}

export function registerMarketOrder(world: WorldState, order: MarketOrder): void {
  let index = cache.get(world);
  if (!index || index.ordersRef !== world.marketOrders || index.orderCount !== world.marketOrders.length - 1) index = build(world);
  if (!index.orderById.has(order.id)) indexOrder(index, order);
  index.orderCount = world.marketOrders.length;
}

function cleanQueue(queue: MarketOrder[]): void {
  while (queue.length && !active(queue[0])) queue.shift();
}

function bestFromSide(side: BookSide, includeMarket: boolean): MarketOrder | undefined {
  if (includeMarket) {
    cleanQueue(side.market);
    if (side.market[0]) return side.market[0];
  }
  while (side.priceKeys.length) {
    const price = side.priceKeys[0];
    const queue = side.levels.get(price);
    if (!queue) {
      side.priceKeys.shift();
      continue;
    }
    cleanQueue(queue);
    if (queue[0]) return queue[0];
    side.levels.delete(price);
    side.priceKeys.shift();
  }
  return undefined;
}

export function bestOrder(world: WorldState, securityId: string, exchangeId: string, side: "buy" | "sell", includeMarket = true): MarketOrder | undefined {
  const book = marketRuntimeIndex(world).books.get(marketPairKey(securityId, exchangeId));
  return book ? bestFromSide(book[side], includeMarket) : undefined;
}

export function ownerReservedShares(world: WorldState, ownerId: string, securityId: string): number {
  let reserved = 0;
  for (const order of marketRuntimeIndex(world).ownerActiveOrders.get(ownerId) ?? []) {
    if (active(order) && order.side === "sell" && order.securityId === securityId) reserved += order.remainingQuantity;
  }
  return reserved;
}

export function brokerageOpenCommitment(world: WorldState, brokerageAccountId: string): number {
  const index = marketRuntimeIndex(world);
  let committed = 0;
  for (const order of index.brokerageActiveBuys.get(brokerageAccountId) ?? []) {
    if (!active(order)) continue;
    const listing = index.listingByPair.get(marketPairKey(order.securityId, order.exchangeId));
    committed += order.remainingQuantity * (order.limitPriceCents ?? listing?.lastPriceCents ?? 0);
  }
  return committed;
}

export function activeOrdersForOwnerPair(world: WorldState, ownerId: string, securityId: string, exchangeId: string): MarketOrder[] {
  const result: MarketOrder[] = [];
  for (const order of marketRuntimeIndex(world).ownerActiveOrders.get(ownerId) ?? []) {
    if (active(order) && order.securityId === securityId && order.exchangeId === exchangeId) result.push(order);
  }
  return result;
}

export function brokerageForOwnerCurrency(world: WorldState, ownerId: string, currencyId: string): BrokerageAccount | undefined {
  return marketRuntimeIndex(world).brokerageByOwnerCurrency.get(ownerCurrencyKey(ownerId, currencyId));
}

export function brokerageForOwner(world: WorldState, ownerId: string): BrokerageAccount | undefined {
  return marketRuntimeIndex(world).brokerageByOwner.get(ownerId);
}
