import type {
  DomainEvent,
  EventType,
  GoodsMovement,
  WorldState,
} from "../domain/model.ts";

export function emitEvent(
  world: WorldState,
  event: Omit<DomainEvent, "id" | "elapsedMonth">,
): string {
  const id = `event-${String(world.nextEventId++).padStart(8, "0")}`;
  world.events.push({
    ...event,
    id,
    elapsedMonth: world.clock.elapsedMonths,
  });
  return id;
}

export function emitSimpleEvent(
  world: WorldState,
  type: EventType,
  title: string,
  detail: string,
  actorIds: string[],
  severity: DomainEvent["severity"] = "info",
  causeIds: string[] = [],
  data: DomainEvent["data"] = {},
): string {
  return emitEvent(world, {
    type,
    title,
    detail,
    actorIds,
    causeIds,
    severity,
    data,
  });
}

export function recordGoodsMovement(
  world: WorldState,
  movement: Omit<GoodsMovement, "id" | "elapsedMonth">,
): string {
  if (!Number.isSafeInteger(movement.quantityMilliUnits) || movement.quantityMilliUnits <= 0) {
    throw new Error(`Некорректное движение товара: ${movement.quantityMilliUnits}`);
  }
  const id = `goods-${String(world.nextGoodsMovementId++).padStart(8, "0")}`;
  world.goodsMovements.push({
    ...movement,
    id,
    elapsedMonth: world.clock.elapsedMonths,
  });
  return id;
}
