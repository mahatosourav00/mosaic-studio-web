// Photo preparation: decode -> trim borders -> filter blurry/tiny -> smart crop -> tile -> remove duplicates.
// The heavy maths lives in Rust (prep_* functions); this file feeds it and keeps the report.
import { loadCore } from "./engine.js";
import { tileRatio } from "./settings.js";

const WORK = 640;          // long side of the working copy used for analysis
const TILE_H = 128;        // stored tile height
const makeCanvas = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
const tick = () => new Promise((r) => setTimeout(r, 0));

export async function decode(file) {
  try { return await createImageBitmap(file); }       // applies the photo's own rotation (EXIF)
  catch { return null; }
}

let faceDet;
/** Face boxes as [x, y, w, h] fractions of the canvas, using the browser's FaceDetector when it exists. */
export async function detectFaces(canvas) {
  try {
    if (faceDet === undefined) faceDet = "FaceDetector" in self ? new self.FaceDetector({ fastMode: true, maxDetectedFaces: 6 }) : null;
    if (!faceDet) return [];
    const faces = await faceDet.detect(canvas);
    return faces.flatMap((f) => [f.boundingBox.x / canvas.width, f.boundingBox.y / canvas.height, f.boundingBox.width / canvas.width, f.boundingBox.height / canvas.height]);
  } catch { return []; }
}

/** Effective preparation switches (the master "skip" switch turns everything off). */
export function prepFlags(s) {
  if (s.prep_skip) return { trim: false, dedupe: false, filter: false, crop: false };
  return { trim: s.trim_borders, dedupe: s.dedupe, filter: s.filter_photos, crop: s.smart_crop };
}

/** Key that changes whenever the prepared tiles would change. */
export function prepKey(files, s) {
  const f = prepFlags(s);
  return JSON.stringify([files.map((x) => [x.name, x.size, x.lastModified]), f, s.min_sharpness, s.min_side, s.tile_aspect, s.grayscale, s.detect_faces]);
}

function subRect(rgba, w, x, y, cw, ch) {
  const out = new Uint8Array(cw * ch * 4);
  for (let r = 0; r < ch; r++) out.set(rgba.subarray(((y + r) * w + x) * 4, ((y + r) * w + x + cw) * 4), r * cw * 4);
  return out;
}

function patch4(px, w, h) {
  const out = new Uint8Array(48);
  for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
    const x0 = (bx * w / 4) | 0, x1 = ((bx + 1) * w / 4) | 0, y0 = (by * h / 4) | 0, y1 = ((by + 1) * h / 4) | 0;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    const o = (by * 4 + bx) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}

const hamming = (a, b) => { const c = (v) => { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }; return c((a[0] ^ b[0]) >>> 0) + c((a[1] ^ b[1]) >>> 0); };

/**
 * Prepare photos. Returns { tiles, patches, count, tw, th, fileIdx, records, counts }.
 * records[i] = { name, status: "ok"|"rejected"|"duplicate", reason, trimmed, thumb } for every input file.
 */
export async function preparePhotos(files, s, { onProgress, signal, thumbs = false } = {}) {
  const core = await loadCore();
  const flags = prepFlags(s);
  const ratio = tileRatio(s), tw = Math.round(TILE_H * ratio), th = TILE_H;
  const tcv = makeCanvas(tw, th), tctx = tcv.getContext("2d", { willReadFrequently: true });
  const thumbCv = makeCanvas(1, 1);
  const makeThumb = async (src) => {
    if (!thumbs) return null;
    const k = 72 / Math.max(src.width, src.height);
    thumbCv.width = Math.max(1, Math.round(src.width * k)); thumbCv.height = Math.max(1, Math.round(src.height * k));
    thumbCv.getContext("2d").drawImage(src, 0, 0, thumbCv.width, thumbCv.height);
    const blob = thumbCv.convertToBlob ? await thumbCv.convertToBlob({ type: "image/jpeg", quality: 0.6 }) : await new Promise((r) => thumbCv.toBlob(r, "image/jpeg", 0.6));
    return URL.createObjectURL(blob);
  };
  const cand = [];     // kept so far (before duplicate removal)
  const records = [];
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const file = files[i];
    const rec = { name: file.webkitRelativePath || file.name, status: "ok", reason: "", trimmed: false, thumb: null };
    records.push(rec);
    const bmp = await decode(file);
    if (!bmp) { rec.status = "rejected"; rec.reason = "could not be read"; onProgress?.((i + 1) / files.length); continue; }
    const k = Math.min(1, WORK / Math.max(bmp.width, bmp.height));
    const ww = Math.max(1, Math.round(bmp.width * k)), wh = Math.max(1, Math.round(bmp.height * k));
    const wcv = makeCanvas(ww, wh), wctx = wcv.getContext("2d", { willReadFrequently: true });
    wctx.imageSmoothingQuality = "high"; wctx.drawImage(bmp, 0, 0, ww, wh);
    const work = wctx.getImageData(0, 0, ww, wh).data;
    // 1) borders
    let [t, b, l, r] = flags.trim ? Array.from(core.prep_trim_borders(work, ww, wh)) : [0, 0, 0, 0];
    rec.trimmed = t + b + l + r > 0;
    const cw = ww - l - r, ch = wh - t - b;
    const body = rec.trimmed ? subRect(work, ww, l, t, cw, ch) : work;
    // 2) filters (size is judged on the original, after trimming)
    const origW = bmp.width - Math.round((l + r) / k), origH = bmp.height - Math.round((t + b) / k);
    const sharp = core.prep_sharpness(body, cw, ch);
    if (flags.filter && Math.min(origW, origH) < s.min_side) { rec.status = "rejected"; rec.reason = `too small (${origW}x${origH})`; }
    else if (flags.filter && sharp < s.min_sharpness) { rec.status = "rejected"; rec.reason = `too blurry (${sharp.toFixed(1)})`; }
    else if (Math.min(origW, origH) < 8) { rec.status = "rejected"; rec.reason = "too small"; }
    if (rec.status === "rejected") { rec.thumb = await makeThumb(wcv); bmp.close?.(); onProgress?.((i + 1) / files.length); if (i % 4 === 3) await tick(); continue; }
    // 3) crop to the tile shape
    let crop;
    if (flags.crop) {
      const faces = s.detect_faces ? await detectFaces(wcv) : [];
      // faces are fractions of the full working copy: shift them into the trimmed body
      const fb = []; for (let q = 0; q < faces.length; q += 4) fb.push((faces[q] * ww - l) / cw, (faces[q + 1] * wh - t) / ch, faces[q + 2] * ww / cw, faces[q + 3] * wh / ch);
      crop = Array.from(core.prep_smart_crop(body, cw, ch, ratio, new Float32Array(fb)));
    } else {
      const sr = cw / ch; let cwid = cw, chei = ch;
      if (sr > ratio) cwid = Math.round(ch * ratio); else chei = Math.round(cw / ratio);
      crop = [Math.round((cw - cwid) / 2), Math.round((ch - chei) / 2), cwid, chei];
    }
    // map the crop back to full-resolution pixels and draw the tile from the original
    const f = 1 / k;
    tctx.clearRect(0, 0, tw, th); tctx.imageSmoothingQuality = "high";
    tctx.drawImage(bmp, (l + crop[0]) * f, (t + crop[1]) * f, crop[2] * f, crop[3] * f, 0, 0, tw, th);
    const px = tctx.getImageData(0, 0, tw, th).data;
    if (s.grayscale) for (let q = 0; q < px.length; q += 4) { const g = (0.299 * px[q] + 0.587 * px[q + 1] + 0.114 * px[q + 2]) | 0; px[q] = px[q + 1] = px[q + 2] = g; }
    const tile = new Uint8Array(px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength));
    rec.thumb = await makeThumb(tcv);
    cand.push({ i, rec, tile, sharp, patch: patch4(tile, tw, th), hash: flags.dedupe ? Array.from(core.prep_hash(tile, tw, th)) : null });
    bmp.close?.();
    onProgress?.((i + 1) / files.length);
    if (i % 3 === 2) await tick();
  }
  // 4) near-duplicates: keep the sharpest of each group
  let kept = cand;
  if (flags.dedupe && cand.length > 1) {
    const order = [...cand].sort((a, b) => b.sharp - a.sharp);
    const keep = [];
    for (const c of order) {
      const twin = keep.find((k) => hamming(c.hash, k.hash) <= 4);
      if (twin) { c.rec.status = "duplicate"; c.rec.reason = `looks like ${twin.rec.name.split("/").pop()}`; } else keep.push(c);
    }
    kept = cand.filter((c) => c.rec.status === "ok");
  }
  const T = kept.length, tl = tw * th * 4;
  const all = new Uint8Array(T * tl), pa = new Uint8Array(T * 48);
  kept.forEach((c, n) => { all.set(c.tile, n * tl); pa.set(c.patch, n * 48); c.rec.tileIndex = n; });
  const counts = { ok: T, rejected: records.filter((r) => r.status === "rejected").length, duplicate: records.filter((r) => r.status === "duplicate").length,
                   trimmed: records.filter((r) => r.trimmed && r.status === "ok").length };
  return { tiles: all, patches: pa, count: T, tw, th, fileIdx: kept.map((c) => c.i), records, counts, skipped: counts.rejected + counts.duplicate };
}
