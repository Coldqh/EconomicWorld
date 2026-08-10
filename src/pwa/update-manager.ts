export interface AppBuildInfo {
  version: string;
  buildId: string;
  buildDate: string;
  commit: string;
}

export type UpdateState = "unsupported" | "current" | "checking" | "available" | "applying" | "offline" | "error";

declare const __APP_BUILD__: AppBuildInfo;

export const APP_BUILD: AppBuildInfo = __APP_BUILD__;

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
const updateListeners = new Set<() => void>();

export function registerAppServiceWorker(onUpdateAvailable?: () => void): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  if (onUpdateAvailable) updateListeners.add(onUpdateAvailable);
  if (registrationPromise) return registrationPromise;
  registrationPromise = navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then((registration) => {
    if (registration.waiting) updateListeners.forEach((listener) => listener());
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) updateListeners.forEach((listener) => listener());
      });
    });
    return registration;
  }).catch(() => null);
  return registrationPromise;
}

export async function checkForUpdate(): Promise<UpdateState> {
  const registration = await registerAppServiceWorker();
  if (!registration) return "unsupported";
  if (!navigator.onLine) return "offline";
  try {
    await registration.update();
    return registration.waiting ? "available" : "current";
  } catch {
    return "error";
  }
}

function waitForControllerChange(): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 4_000);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export async function applyAppUpdate(saveWorld: () => Promise<void>, force = false): Promise<void> {
  await saveWorld();
  const registration = await registerAppServiceWorker();
  if (!registration) return;
  if (force && "caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("economic-world-app-")).map((name) => caches.delete(name)));
  }
  await registration.update().catch(() => undefined);
  const waiting = registration.waiting;
  if (waiting) {
    const changed = waitForControllerChange();
    waiting.postMessage({ type: "SKIP_WAITING" });
    await changed;
  }
  window.location.reload();
}

export async function serviceWorkerDiagnostics(): Promise<{ controlled: boolean; state: string; scriptUrl: string | null; cacheNames: string[] }> {
  const registration = await registerAppServiceWorker();
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
  return {
    controlled: Boolean(navigator.serviceWorker?.controller),
    state: worker?.state ?? "нет",
    scriptUrl: worker?.scriptURL ?? null,
    cacheNames: "caches" in window ? await caches.keys() : [],
  };
}
