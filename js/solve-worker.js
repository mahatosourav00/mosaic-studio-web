// Module worker: matches photos to the picture and paints the still, off the main thread, so the page stays alive
// (and the progress bar keeps moving) while the heavy Rust/WebAssembly steps run.
import { loadCore, useWasmModule } from "./engine.js";

self.onmessage = async (e) => {
  const j = e.data;
  try {
    useWasmModule(j.wasm);
    const core = await loadCore();
    const out = core.solve_mosaic(j.rgb, j.cols, j.rows, j.subject, j.patches, j.opts, (f) => self.postMessage({ stage: "Matching photos to the picture", progress: f }));
    self.postMessage({ stage: "Painting the mosaic", progress: 0.3 });
    const rgba = core.render_still(out.subarray(6), j.tiles, j.tw, j.th, j.cols, j.rows, j.ratio, j.cellH, j.gap, j.gapColor, j.tint);
    self.postMessage({ done: true, out, rgba }, [out.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
