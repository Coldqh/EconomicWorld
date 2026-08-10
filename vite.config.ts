import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const buildDate = new Date().toISOString();
let commit = process.env.GITHUB_SHA?.slice(0, 12) ?? "local";
try {
  commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // Архивные сборки могут не содержать каталога .git.
}
const buildInfo = {
  version: packageJson.version,
  buildId: `${packageJson.version}-${commit}-${buildDate.replace(/\D/g, "").slice(0, 12)}`,
  buildDate,
  commit,
};

export default defineConfig({
  // Relative assets make the same build work at / and at /<repository>/ on GitHub Pages.
  base: "./",
  define: { __APP_BUILD__: JSON.stringify(buildInfo) },
  plugins: [react(), {
    name: "economic-world-pwa-metadata",
    generateBundle(_options, bundle) {
      const precache = ["./", "./index.html", "./version.json", "./manifest.webmanifest", "./icon.svg", ...Object.keys(bundle).filter((file) => file.endsWith(".js") || file.endsWith(".css")).map((file) => `./${file}`)];
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(buildInfo, null, 2) });
      this.emitFile({ type: "asset", fileName: "sw.js", source: `
const BUILD = ${JSON.stringify(buildInfo)};
const CACHE_PREFIX = "economic-world-app-";
const CACHE_NAME = CACHE_PREFIX + BUILD.buildId;
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url)))));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") event.source?.postMessage({ type: "APP_VERSION", build: BUILD });
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate" || url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); } return response;
  })));
});
` });
    },
  }],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
