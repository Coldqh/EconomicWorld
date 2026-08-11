import type { WorldState } from "../domain/model.ts";

let sequence = 1;

export interface SimulationRun {
  promise: Promise<WorldState>;
  cancel: () => void;
}

export function runSimulationOffThread(world: WorldState, months: number, onProgress?: (completed: number, total: number) => void): SimulationRun {
  const worker = new Worker(new URL("./simulation-worker.ts", import.meta.url), { type: "module" });
  const requestId = `simulation-run-${sequence++}`;
  let settled = false;
  const promise = new Promise<WorldState>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ type: string; requestId: string; completed?: number; total?: number; world?: WorldState; message?: string }>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === "progress") onProgress?.(message.completed ?? 0, message.total ?? months);
      if (message.type === "complete" && message.world) {
        settled = true;
        worker.terminate();
        resolve(message.world);
      }
      if (message.type === "cancelled") {
        settled = true;
        worker.terminate();
        reject(new DOMException("Симуляция отменена", "AbortError"));
      }
      if (message.type === "error") {
        settled = true;
        worker.terminate();
        reject(new Error(message.message ?? "Ошибка Simulation Worker"));
      }
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ type: "run", requestId, world, months });
  });
  return {
    promise,
    cancel: () => {
      if (!settled) worker.postMessage({ type: "cancel", requestId });
    },
  };
}
