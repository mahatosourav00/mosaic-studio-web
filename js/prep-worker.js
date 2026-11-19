// Module worker: prepares photos off the main thread so the page stays responsive and several photos run at once.
import { loadCore } from "./engine.js";
import { processPhoto } from "./prep-one.js";

let booted = false;
self.onmessage = async (e) => {
  const { id, file, cfg } = e.data;
  try {
    const b0 = performance.now();
    const core = await loadCore();
    const boot = booted ? null : performance.now() - b0;     // only the first message pays for loading the wasm
    booted = true;
    const r = await processPhoto(core, file, cfg);
    self.postMessage({ id, r, boot }, r.tile ? [r.tile.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
