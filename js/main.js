// App entry: router, PWA install/update, engine check page.
import { createGpu, loadCore, solverSelfTest } from "./engine.js";
import { app, mount } from "./app.js";
import { h, $, card, title, toast } from "./ui.js";
import { home, pictures, prepare, design, create } from "./pages.js";
import { videoPage, stopVideo } from "./video-page.js";

const routes = { home, pictures, prepare, design, create, video: videoPage, check };
function render() {
  stopVideo();
  const name = location.hash.slice(1) || "home";
  (routes[name] || home)();
}
addEventListener("hashchange", render);

// ---- engine check (graphics + solver) ----------------------------------------------------------
async function check() {
  const cv = h("canvas", { class: "stage", width: 640, height: 480 });
  const info = h("dl", { class: "kv" }, h("dt", {}, "Status"), h("dd", {}, "Starting…"));
  const solve = h("dl", { class: "kv" }, h("dt", {}, "Status"), h("dd", {}, "Running…"));
  const pg = h("progress", { value: 0, max: 1 });
  let holder = h("div", {}, cv);
  const content = h("div", { class: "page" },
    card(title("Graphics"), holder, info, h("button", { class: "btn", onclick: () => run(true) }, "Retry with WebGL2 only")),
    card(title("Solver (WebAssembly)"), pg, solve));
  mount(check, { title: "Engine check", step: null, content, back: "home" });
  let raf = 0; const token = {}; check.token = token;
  const run = async (forceGl) => {
    cancelAnimationFrame(raf);
    const fresh = h("canvas", { class: "stage", width: 640, height: 480 }); holder.replaceChildren(fresh);
    try {
      const gpu = await createGpu(fresh, forceGl);
      info.replaceChildren(...[["Backend", gpu.backend()], ["Adapter", gpu.adapter_name() || "n/a"], ["Max texture", gpu.max_texture_size() + " px"]].flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
      const t0 = performance.now();
      const tick = () => { if (check.token !== token || !fresh.isConnected) return; gpu.draw_demo((performance.now() - t0) / 1000); raf = requestAnimationFrame(tick); };
      tick();
    } catch (e) { info.replaceChildren(h("dt", {}, "Status"), h("dd", { class: "bad" }, String((e && e.message) || e))); }
  };
  run(false);
  try {
    const r = await solverSelfTest((f) => { pg.value = f; }); pg.value = 1;
    solve.replaceChildren(h("dt", {}, "Result"), h("dd", {}, `${r.cells} cells solved in ${r.ms.toFixed(0)} ms`), h("dt", {}, "Rule violations"), h("dd", {}, String(r.violations)));
  } catch (e) { solve.replaceChildren(h("dt", {}, "Status"), h("dd", { class: "bad" }, String((e && e.message) || e))); }
}

// ---- PWA: install button + update toast --------------------------------------------------------
let deferred;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("#install").hidden = false; });
$("#install").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("#install").hidden = true; };
addEventListener("appinstalled", () => { $("#install").hidden = true; });
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) toast("A new version is ready.", { action: "Update", ms: 60000, fn: () => w.postMessage("skipWaiting") }); });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

loadCore().catch(() => {});   // warm the wasm in the background
render();
