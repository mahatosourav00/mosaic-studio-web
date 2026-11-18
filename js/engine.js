// Thin loader for the Rust/WASM core (pkg/ is produced by build.ps1 / CI).
let mod = null;
let compiled = null;

/** The compiled WebAssembly module. Compiled once on the page and handed to the workers, so a phone does not compile
 *  the 4 MB module again in every worker. */
export function wasmModule() {
  return (compiled ||= (async () => {
    const url = new URL("../pkg/mosaic_core_bg.wasm", import.meta.url);
    try { return await WebAssembly.compileStreaming(fetch(url)); }
    catch { return await WebAssembly.compile(await (await fetch(url)).arrayBuffer()); }
  })());
}
/** In a worker: use the module the page already compiled. */
export function useWasmModule(m) { if (m && !compiled) compiled = Promise.resolve(m); }

export async function loadCore() {
  if (!mod) {
    const m = await import("../pkg/mosaic_core.js");
    await m.default({ module_or_path: await wasmModule() });
    mod = m;
  }
  return mod;
}

/** Create the GPU renderer on a canvas (WebGPU, falling back to WebGL2). */
export async function createGpu(canvas, forceWebgl = false) {
  const core = await loadCore();
  return core.Gpu.create(canvas, forceWebgl);
}

/** Tiny synthetic solve used as a self-test of the CPU solver in WASM. */
export async function solverSelfTest(onProgress) {
  const core = await loadCore();
  const cols = 24, rows = 24, A = 24, T = 120;
  const w = cols * A, h = rows * A;
  const main = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    main[i] = (x * 255 / w) | 0; main[i + 1] = (y * 255 / h) | 0; main[i + 2] = 140;
  }
  const tiles = new Uint8Array(T * 48);
  for (let i = 0; i < tiles.length; i++) tiles[i] = (Math.random() * 255) | 0;
  // [num_tiles, subtiles, subtile%, grid, detail, subject_w, max_uses, min_dist, flip, even, tint, seed]
  const opts = new Float64Array([cols * rows, 0, 20, 2, 1, 0.6, 8, 4, 1, 0.5, 0.5, 42]);
  const t0 = performance.now();
  const out = core.solve_mosaic(main, cols, rows, new Float32Array(0), tiles, opts, onProgress);
  return { ms: performance.now() - t0, cells: (out.length - 6) / 9, swaps: out[2], violations: out[0] };
}
