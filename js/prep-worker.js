// Module worker: prepares photos off the main thread so the page stays responsive and several photos run at once.
import { loadCore } from "./engine.js";
import { processPhoto } from "./prep-one.js";

self.onmessage = async (e) => {
  const { id, file, cfg } = e.data;
  try {
    const core = await loadCore();
    const r = await processPhoto(core, file, cfg);
    self.postMessage({ id, r }, r.tile ? [r.tile.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
