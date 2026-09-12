/// <reference lib="webworker" />
import type { WorldState } from "../domain/model.ts";
import { stepMonth } from "./simulation.ts";

type RunMessage = { type: "run"; requestId: string; world: WorldState; months: number; postedAt?: number };
type CancelMessage = { type: "cancel"; requestId: string };

const cancelled = new Set<string>();

self.onmessage = (event: MessageEvent<RunMessage | CancelMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled.add(message.requestId);
    return;
  }
  const { requestId, world, months } = message;
  try {
    const progressInterval = Math.max(12, Math.ceil(months / 24));
    for (let completed = 0; completed < months; completed += 1) {
      if (cancelled.has(requestId)) {
        cancelled.delete(requestId);
        self.postMessage({ type: "cancelled", requestId });
        return;
      }
      stepMonth(world);
      if ((completed + 1) % progressInterval === 0 || completed + 1 === months) {
        self.postMessage({
          type: "progress",
          requestId,
          completed: completed + 1,
          total: months,
          elapsedMonth: world.clock.elapsedMonths,
          diagnostics: {
            activeMarketOrders: world.diagnostics.activeMarketOrders,
            activeDerivativeContracts: world.diagnostics.activeDerivativeContracts,
            memoryPressure: world.diagnostics.memoryPressure,
          },
        });
      }
    }
    self.postMessage({ type: "complete", requestId, world, postedAt: performance.now() });
  } catch (error) {
    self.postMessage({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
  }
};

export {};
