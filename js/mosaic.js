// Photos -> tiles -> solve (WASM) -> finished still. Runs on the main thread for now (moves to a worker later).
import { loadCore } from "./engine.js";
import { tileRatio, stillPlan } from "./settings.js";
import { preparePhotos, prepKey, decode, detectFaces } from "./prep.js";
import { withDpi } from "./dpi.js";

export { decode };
const ANALYSIS_PX = 24;
export const makeCanvas = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Draw `bmp` cover-cropped to dw x dh onto a 2D context, keeping `focus` (fractions) as centred as possible. */
export function coverDraw(ctx, bmp, dw, dh, focus = [0.5, 0.5]) {
  const sr = bmp.width / bmp.height, dr = dw / dh;
  let sw = bmp.width, sh = bmp.height;
  if (sr > dr) sw = bmp.height * dr; else sh = bmp.width / dr;
  const sx = Math.min(Math.max(focus[0] * bmp.width - sw / 2, 0), bmp.width - sw);
  const sy = Math.min(Math.max(focus[1] * bmp.height - sh / 2, 0), bmp.height - sh);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
}

let prepCache = null;
/** Prepare (or reuse) the tiles for these photos and settings. */
export async function getPrepared(files, s, opts = {}) {
  const key = prepKey(files, s);
  if (prepCache && prepCache.key === key && (!opts.thumbs || prepCache.thumbs)) return prepCache.data;
  const data = await preparePhotos(files, s, opts);
  prepCache = { key, data, thumbs: !!opts.thumbs };
  return data;
}

function targetAspect(s, bmp) {
  if (s.mosaic_aspect === "image") return bmp.width / bmp.height;
  const [a, b] = s.mosaic_aspect.split(":").map(Number); return a / b;
}

const toCentres = (f) => { const o = []; for (let i = 0; i < f.length; i += 4) o.push(f[i] + f[i + 2] / 2, f[i + 1] + f[i + 3] / 2, f[i + 2], f[i + 3]); return o; };

/** Main picture -> grid, analysis pixels, subject map and a crop for the overlay. */
export async function prepareMain(file, s) {
  const core = await loadCore();
  const bmp = await decode(file);
  if (!bmp) throw new Error("The main picture could not be read.");
  const r = tileRatio(s);
  const [cols, rows] = core.grid_dims(targetAspect(s, bmp) / r, s.num_tiles);
  const ratio = (cols * r) / rows;                                   // mosaic width / height
  // find the subject on the whole picture first, so the crop keeps it in frame
  const k0 = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const w0 = Math.max(8, Math.round(bmp.width * k0)), h0 = Math.max(8, Math.round(bmp.height * k0));
  const c0 = makeCanvas(w0, h0), x0 = c0.getContext("2d", { willReadFrequently: true }); x0.drawImage(bmp, 0, 0, w0, h0);
  const faces0 = s.detect_faces ? toCentres(await detectFaces(c0)) : [];
  const px0 = x0.getImageData(0, 0, w0, h0).data, rgb0 = new Uint8Array(w0 * h0 * 3);
  for (let i = 0, j = 0; i < px0.length; i += 4, j += 3) { rgb0[j] = px0[i]; rgb0[j + 1] = px0[i + 1]; rgb0[j + 2] = px0[i + 2]; }
  const cen = core.subject_centroid(core.subject_map(rgb0, w0, h0, new Float32Array(faces0), w0, h0), w0, h0);
  const focus = [cen[0], cen[1]];

  const aw = cols * ANALYSIS_PX, ah = rows * ANALYSIS_PX;
  const cv = makeCanvas(aw, ah), ctx = cv.getContext("2d", { willReadFrequently: true });
  coverDraw(ctx, bmp, aw, ah, focus);
  const rgba = ctx.getImageData(0, 0, aw, ah).data;
  const rgb = new Uint8Array(aw * ah * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    if (s.grayscale) { const g = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0; rgb[j] = rgb[j + 1] = rgb[j + 2] = g; }
    else { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  }
  let subject = new Float32Array(0);
  if (s.subject_weight > 0) {
    const faces = s.detect_faces ? toCentres(await detectFaces(cv)) : [];
    subject = core.subject_map(rgb, aw, ah, new Float32Array(faces), aw, ah);
  }
  // overlay crop (up to 1600 px on the long side), framed like the analysis image
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const bw = bmp.width * k, bh = bmp.height * k;
  const cropW = Math.round(ratio > bw / bh ? bw : bh * ratio), cropH = Math.round(ratio > bw / bh ? bw / ratio : bh);
  const crop = makeCanvas(Math.max(1, cropW), Math.max(1, cropH));
  coverDraw(crop.getContext("2d"), bmp, crop.width, crop.height, focus);
  if (s.grayscale) { const g = crop.getContext("2d"); g.globalCompositeOperation = "saturation"; g.fillStyle = "#808080"; g.fillRect(0, 0, crop.width, crop.height); g.globalCompositeOperation = "source-over"; }
  bmp.close?.();
  return { rgb, subject, aw, ah, cols, rows, ratio, crop };
}

/** The main picture drawn over the mosaic, stronger on the subject. */
function overlayWith(ctx, m, s, W, H) {
  if (s.main_blend <= 0) return;
  if (m.subject.length && s.subject_weight > 0) {
    const a = makeCanvas(m.aw, m.ah), actx = a.getContext("2d");
    const img = actx.createImageData(m.aw, m.ah);
    for (let i = 0; i < m.subject.length; i++) img.data[i * 4 + 3] = Math.min(1, s.main_blend * (1 + 1.5 * s.subject_weight * m.subject[i])) * 255;
    actx.putImageData(img, 0, 0);
    const t = makeCanvas(W, H), tctx = t.getContext("2d");
    tctx.imageSmoothingQuality = "high"; tctx.drawImage(m.crop, 0, 0, W, H);
    tctx.globalCompositeOperation = "destination-in"; tctx.drawImage(a, 0, 0, W, H);
    ctx.drawImage(t, 0, 0);
  } else {
    ctx.globalAlpha = s.main_blend; ctx.imageSmoothingQuality = "high"; ctx.drawImage(m.crop, 0, 0, W, H); ctx.globalAlpha = 1;
  }
}

/** Solve and paint in a worker (page stays responsive); falls back to the main thread if workers are unavailable. */
async function solveAndRender(core, j, onStage, signal) {
  if (typeof Worker !== "undefined") {
    try {
      return await new Promise((resolve, reject) => {
        const w = new Worker(new URL("./solve-worker.js", import.meta.url), { type: "module" });
        const fail = (e) => { w.terminate(); reject(e); };
        w.onmessage = ({ data }) => {
          if (data.done) { w.terminate(); resolve(data); }
          else if (data.error) fail(Object.assign(new Error(data.error), { real: true }));
          else onStage?.(data.stage, data.progress);
        };
        w.onerror = (ev) => { ev.preventDefault?.(); fail(new Error("worker failed")); };
        signal?.addEventListener("abort", () => fail(new DOMException("Cancelled", "AbortError")), { once: true });
        w.postMessage(j);
      });
    } catch (e) {
      if (e?.name === "AbortError" || e?.real) throw e;
    }
  }
  const out = core.solve_mosaic(j.rgb, j.cols, j.rows, j.subject, j.patches, j.opts, (f) => onStage?.("Matching photos to the picture", f));
  await tick();
  const rgba = core.render_still(out.subarray(6), j.tiles, j.tw, j.th, j.cols, j.rows, j.ratio, j.cellH, j.gap, j.gapColor, j.tint);
  return { out, rgba };
}

/**
 * Full pipeline. `onStage(name, fraction)` drives the progress bar. `preview` makes a small fast draft.
 * Returns {blob, width, height, dpi, capped, stats, scene (not for previews), ...}.
 */
export async function buildMosaic({ photos, main, settings, onStage, signal, preview = false }) {
  onStage?.("Getting ready", 0);
  const core = await loadCore();
  const s = preview ? { ...settings, output_mode: "screen", cell_px: 24 } : settings;
  onStage?.("Reading your photos", 0);
  const prep = await getPrepared(photos, s, { onProgress: (f) => onStage?.("Reading your photos", f), signal });
  if (prep.count < 4) throw new Error(`Only ${prep.count} usable photos were found (${prep.skipped} left out). Pick at least 4, or loosen the photo preparation options.`);
  await tick();
  onStage?.("Reading the main picture", 0);
  const m = await prepareMain(main, s);
  await tick();

  // [num_tiles, subtiles, subtile%, grid, detail, subject_w, max_uses, min_dist, flip, even, tint, seed]
  const opts = new Float64Array([m.cols * m.rows, s.use_subtiles ? 1 : 0, s.subtile_percent, s.subtile_grid,
    s.subtile_select === "detail" ? 1 : 0, s.subject_weight, s.max_uses, s.min_distance,
    s.allow_flip ? 1 : 0, s.even_usage, s.tint, s.seed]);
  onStage?.("Matching photos to the picture", 0);
  await tick();
  const plan = stillPlan(s, m.cols, m.rows);
  const r = tileRatio(s);
  const job = { rgb: m.rgb, cols: m.cols, rows: m.rows, subject: m.subject, patches: prep.patches, opts, tiles: prep.tiles, tw: prep.tw, th: prep.th,
                ratio: r, cellH: plan.cellH, gap: s.gap_px, gapColor: new Uint8Array(s.gap_color), tint: s.tint > 0 };
  const { out, rgba } = await solveAndRender(core, job, onStage, signal);
  const stats = { violations: out[0], raised: !!out[1], swaps: out[2], minUsed: out[3], maxUsed: out[4], unused: out[5] };
  const cells = out.subarray(6);
  onStage?.("Painting the mosaic", 0.6);
  await tick();
  const W = plan.width, H = plan.height;
  const cv = makeCanvas(W, H), ctx = cv.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), W, H), 0, 0);
  overlayWith(ctx, m, s, W, H);
  const fmt = preview ? "jpg" : s.image_format;
  const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[fmt] || "image/png";
  let blob = cv.convertToBlob ? await cv.convertToBlob({ type, quality: s.image_quality / 100 }) : await new Promise((res) => cv.toBlob(res, type, s.image_quality / 100));
  if (!preview) blob = await withDpi(blob, plan.dpi);
  onStage?.("Done", 1);
  const res = { blob, width: W, height: H, dpi: plan.dpi, capped: plan.capped, cols: m.cols, rows: m.rows, photos: prep.count, skipped: prep.skipped,
                cellH: plan.cellH, stats, counts: prep.counts };
  if (!preview) res.scene = { cells: Float32Array.from(cells), cols: m.cols, rows: m.rows, tileRatio: r, prep, crop: m.crop, files: photos };
  return res;
}
