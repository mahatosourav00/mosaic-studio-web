// Prepares ONE photo (decode -> trim -> filter -> crop -> tile). Used on the main thread and inside prep-worker.js,
// so it must not touch `document` or `window`.
const WORK = 640;          // long side of the working copy used for analysis
const makeCanvas = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));

export async function decode(file) {
  try { return await createImageBitmap(file); }       // applies the photo's own rotation (EXIF)
  catch { return null; }
}

const DECODE_MAX = 1024;   // phones decode photos no larger than this (tiles are only 128 px tall)

/** Oriented pixel size of a JPEG read from its first bytes, or null (not a JPEG / unreadable). */
async function readSize(file) {
  try {
    const v = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (v.getUint16(0) !== 0xffd8) return null;
    let p = 2, w = 0, h = 0, orient = 1;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) return null;
      const m = v.getUint8(p + 1), len = v.getUint16(p + 2);
      if (m === 0xff) { p++; continue; }
      if (m === 0xe1 && len >= 14 && v.getUint32(p + 4) === 0x45786966) {           // "Exif"
        const t = p + 10, le = v.getUint16(t) === 0x4949, ifd = t + v.getUint32(t + 4, le);
        if (ifd + 2 <= v.byteLength) {
          const n = v.getUint16(ifd, le);
          for (let i = 0; i < n && ifd + 2 + i * 12 + 12 <= v.byteLength; i++) {
            const e = ifd + 2 + i * 12;
            if (v.getUint16(e, le) === 0x0112) orient = v.getUint16(e + 8, le);
          }
        }
      } else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        h = v.getUint16(p + 5); w = v.getUint16(p + 7); break;
      }
      p += 2 + len;
    }
    if (!w || !h) return null;
    return orient >= 5 && orient <= 8 ? { w: h, h: w } : { w, h };
  } catch { return null; }
}

/** Decode for preparation. With `small`, big JPEGs are decoded at reduced size (faster, far less memory). Returns { bmp, origW, origH } or null. */
async function decodeForPrep(file, small) {
  const sz = small ? await readSize(file) : null;
  if (sz && Math.max(sz.w, sz.h) > DECODE_MAX) {
    const k = DECODE_MAX / Math.max(sz.w, sz.h);
    try {
      const bmp = await createImageBitmap(file, { resizeWidth: Math.max(1, Math.round(sz.w * k)), resizeHeight: Math.max(1, Math.round(sz.h * k)), resizeQuality: "low" });
      if (Math.abs(bmp.width / bmp.height - sz.w / sz.h) < 0.05) return { bmp, origW: sz.w, origH: sz.h };
      bmp.close?.();                                  // orientation came out different from expected: use the safe path
    } catch { /* fall through to the full decode */ }
  }
  const bmp = await decode(file);
  return bmp && { bmp, origW: bmp.width, origH: bmp.height };
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

function subRect(rgba, w, x, y, cw, ch) {
  const out = new Uint8Array(cw * ch * 4);
  for (let r = 0; r < ch; r++) out.set(rgba.subarray(((y + r) * w + x) * 4, ((y + r) * w + x + cw) * 4), r * cw * 4);
  return out;
}

export function patch4(px, w, h) {
  const out = new Uint8Array(48);
  for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
    const x0 = (bx * w / 4) | 0, x1 = ((bx + 1) * w / 4) | 0, y0 = (by * h / 4) | 0, y1 = ((by + 1) * h / 4) | 0;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    const o = (by * 4 + bx) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}

let tile = null, thumb = null;                 // reusable canvases (one set per thread)
const tileCtx = (tw, th) => {
  if (!tile || tile.cv.width !== tw || tile.cv.height !== th) { const cv = makeCanvas(tw, th); tile = { cv, ctx: cv.getContext("2d", { willReadFrequently: true }) }; }
  return tile;
};
async function makeThumb(src) {
  thumb ||= makeCanvas(1, 1);
  const k = 72 / Math.max(src.width, src.height);
  thumb.width = Math.max(1, Math.round(src.width * k)); thumb.height = Math.max(1, Math.round(src.height * k));
  thumb.getContext("2d").drawImage(src, 0, 0, thumb.width, thumb.height);
  return thumb.convertToBlob ? await thumb.convertToBlob({ type: "image/jpeg", quality: 0.6 }) : await new Promise((r) => thumb.toBlob(r, "image/jpeg", 0.6));
}

/**
 * Process one photo. `cfg` = { flags, ratio, tw, th, minSide, minSharp, grayscale, faces, thumbs }.
 * Returns { status: "ok"|"rejected", reason, trimmed, thumb (Blob|null), tile, sharp, patch, hash }.
 */
export async function processPhoto(core, file, cfg) {
  const { flags, ratio, tw, th } = cfg;
  const out = { status: "ok", reason: "", trimmed: false, thumb: null };
  const T0 = performance.now(); let T = T0; const tm = {}; const lap = (k) => { const n = performance.now(); tm[k] = n - T; T = n; };
  out.tm = tm;
  const dec = await decodeForPrep(file, cfg.small); lap("decode");
  if (!dec) { out.status = "rejected"; out.reason = "could not be read"; return out; }
  const { bmp } = dec, sc = dec.origW / bmp.width;            // bitmap pixels -> original pixels
  const k = Math.min(1, WORK / Math.max(bmp.width, bmp.height));
  const ww = Math.max(1, Math.round(bmp.width * k)), wh = Math.max(1, Math.round(bmp.height * k));
  const wcv = makeCanvas(ww, wh), wctx = wcv.getContext("2d", { willReadFrequently: true });
  wctx.imageSmoothingQuality = "high"; wctx.drawImage(bmp, 0, 0, ww, wh);
  const work = wctx.getImageData(0, 0, ww, wh).data; lap("resize");
  out.mp = dec.origW * dec.origH / 1e6;
  // 1) borders
  const [t, b, l, r] = flags.trim ? Array.from(core.prep_trim_borders(work, ww, wh)) : [0, 0, 0, 0];
  out.trimmed = t + b + l + r > 0;
  const cw = ww - l - r, ch = wh - t - b;
  const body = out.trimmed ? subRect(work, ww, l, t, cw, ch) : work;
  // 2) filters (size is judged on the original, after trimming)
  const origW = Math.round(dec.origW - (l + r) / k * sc), origH = Math.round(dec.origH - (t + b) / k * sc);
  lap("trim");
  const sharp = core.prep_sharpness(body, cw, ch); lap("sharpness");
  if (flags.filter && Math.min(origW, origH) < cfg.minSide) { out.status = "rejected"; out.reason = `too small (${origW}x${origH})`; }
  else if (flags.filter && sharp < cfg.minSharp) { out.status = "rejected"; out.reason = `too blurry (${sharp.toFixed(1)})`; }
  else if (Math.min(origW, origH) < 8) { out.status = "rejected"; out.reason = "too small"; }
  if (out.status === "rejected") { if (cfg.thumbs) out.thumb = await makeThumb(wcv); bmp.close?.(); return out; }
  // 3) crop to the tile shape
  let crop;
  if (flags.crop) {
    const faces = cfg.faces ? await detectFaces(wcv) : [];
    // faces are fractions of the full working copy: shift them into the trimmed body
    const fb = []; for (let q = 0; q < faces.length; q += 4) fb.push((faces[q] * ww - l) / cw, (faces[q + 1] * wh - t) / ch, faces[q + 2] * ww / cw, faces[q + 3] * wh / ch);
    crop = Array.from(core.prep_smart_crop(body, cw, ch, ratio, new Float32Array(fb)));
  } else {
    const sr = cw / ch; let cwid = cw, chei = ch;
    if (sr > ratio) cwid = Math.round(ch * ratio); else chei = Math.round(cw / ratio);
    crop = [Math.round((cw - cwid) / 2), Math.round((ch - chei) / 2), cwid, chei];
  }
  lap("crop");
  // map the crop back to full-resolution pixels and draw the tile from the original
  const f = 1 / k, { cv: tcv, ctx: tctx } = tileCtx(tw, th);
  tctx.clearRect(0, 0, tw, th); tctx.imageSmoothingQuality = "high";
  tctx.drawImage(bmp, (l + crop[0]) * f, (t + crop[1]) * f, crop[2] * f, crop[3] * f, 0, 0, tw, th);
  const px = tctx.getImageData(0, 0, tw, th).data;
  if (cfg.grayscale) for (let q = 0; q < px.length; q += 4) { const g = (0.299 * px[q] + 0.587 * px[q + 1] + 0.114 * px[q + 2]) | 0; px[q] = px[q + 1] = px[q + 2] = g; }
  out.tile = new Uint8Array(px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength));
  if (cfg.thumbs) out.thumb = await makeThumb(tcv);
  out.sharp = sharp;
  out.patch = patch4(out.tile, tw, th);
  out.hash = flags.dedupe ? Array.from(core.prep_hash(out.tile, tw, th)) : null; lap("tile");
  bmp.close?.();
  return out;
}
