// Service worker: precache the app shell + wasm so the app works offline.
// Bump VERSION on every release (CI does this with the commit hash) so clients pick up the update.
const VERSION = "v0.1.1";
const CACHE = `mosaic-studio-${VERSION}`;
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/main.js", "js/engine.js", "js/settings.js", "js/mosaic.js", "js/video.js", "js/app.js", "js/ui.js", "js/pages.js", "js/video-page.js", "js/prep.js", "js/prep-one.js", "js/prep-worker.js", "js/solve-worker.js", "js/dpi.js", "js/help.js", "vendor/mp4-muxer.mjs",
  "pkg/mosaic_core.js", "pkg/mosaic_core_bg.wasm",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));   // new worker waits; the page offers "Update"
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("mosaic-studio-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
      throw err;
    }
  })());
});
