// Photo preparation: decode -> trim borders -> filter blurry/tiny -> smart crop -> tile -> remove duplicates.
// The heavy maths lives in Rust (prep_* functions); this file feeds it and keeps the report.
import { loadCore } from "./engine.js";
import { tileRatio } from "./settings.js";

import { isPhone } from "./settings.js";
import { processPhoto, decode, detectFaces } from "./prep-one.js";
export { decode, detectFaces };

const TILE_H = 128;        // stored tile height
const param = (k) => new URLSearchParams(location.search).get(k);
/** Phones decode big photos at reduced size (add ?nosmall to the address to turn that off when comparing speed). */
const smallDecode = () => isPhone() && param("nosmall") === null;
/** How many photos are read at once. Phones get more now that each decode is light (override with ?workers=N). */
const poolSize = (count) => {
  const want = Number(param("workers")) || (isPhone() ? (smallDecode() ? 5 : 3) : 4);
  return Math.max(1, Math.min(want, (navigator.hardwareConcurrency || 4) - 1, count));
};
const DEBUG =/[?&]debug(&|=|$)/.test(location.search);

/** ?debug only: show where the "Reading your photos" time goes (summed over all photos, so it can exceed the wall time). */
function debugReport(files, results, wall) {
  const sum = {}; let mp = 0, n = 0, failed = 0;
  for (const r of results) { if (!r?.tm) { failed++; continue; } n++; mp += r.mp || 0; for (const k in r.tm) sum[k] = (sum[k] || 0) + r.tm[k]; }
  const f = (v) => Math.round(v) + " ms";
  const lines = [`Reading photos: ${files.length} files in ${f(wall)} (${f(wall / files.length)}/photo)`,
    `avg size ${(mp / Math.max(1, n)).toFixed(1)} MP, ${n} read, ${failed} failed`,
    `cores ${navigator.hardwareConcurrency}, memory ${navigator.deviceMemory ?? "?"} GB, phone mode ${isPhone()}, workers ${poolSize(files.length)}, small decode ${smallDecode()}`,
    "per photo average: " + Object.entries(sum).map(([k, v]) => `${k} ${f(v / Math.max(1, n))}`).join(", ")];
  console.log(lines.join("\n"));
  let box = document.getElementById("debug-timing");
  if (!box) { box = document.createElement("pre"); box.id = "debug-timing"; box.style.cssText = "position:fixed;left:4px;right:4px;bottom:4px;z-index:99999;margin:0;padding:8px;background:#000c;color:#9f9;font:11px/1.4 monospace;white-space:pre-wrap;border-radius:6px"; box.onclick = () => box.remove(); document.body.append(box); }
  box.textContent = lines.join("\n") + "\n(tap to close)";
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

const hamming = (a, b) => { const c = (v) => { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }; return c((a[0] ^ b[0]) >>> 0) + c((a[1] ^ b[1]) >>> 0); };

/**
 * Run every photo through processPhoto, several at a time in Web Workers (the page stays responsive and phones use
 * more than one core). Falls back to one at a time on the main thread if workers are unavailable or fail.
 */
async function processAll(core, files, cfg, { onProgress, signal }) {
  const results = new Array(files.length);
  let done = 0;
  const report = () => onProgress?.(done / files.length);
  const aborted = () => signal?.aborted && (() => { throw new DOMException("Cancelled", "AbortError"); })();
  const n = poolSize(files.length);
  if (typeof Worker !== "undefined" && files.length > 1) {
    const workers = [];
    try {
      await new Promise((resolve, reject) => {
        let next = 0, active = 0, dead = false;
        const stop = (err) => { if (dead) return; dead = true; workers.forEach((w) => w.terminate()); err ? reject(err) : resolve(); };
        const feed = (w) => {
          if (dead) return;
          if (signal?.aborted) return stop(new DOMException("Cancelled", "AbortError"));
          if (next >= files.length) { if (--active === 0) stop(); return; }
          const id = next++; w.currentId = id;
          w.postMessage({ id, file: files[id], cfg });
        };
        for (let k = 0; k < n; k++) {
          const w = new Worker(new URL("./prep-worker.js", import.meta.url), { type: "module" });
          workers.push(w); active++;
          w.onmessage = ({ data }) => {
            results[data.id] = data.error ? { status: "rejected", reason: "could not be read", trimmed: false, thumb: null } : data.r;
            done++; report(); feed(w);
          };
          w.onerror = (ev) => { ev.preventDefault?.(); stop(new Error("worker failed")); };
          feed(w);
        }
      });
      return results;
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      workers.forEach((w) => w.terminate());          // fall through to the main-thread path for what is left
    }
  }
  for (let i = 0; i < files.length; i++) {
    aborted();
    if (results[i]) continue;
    results[i] = await processPhoto(core, files[i], cfg);
    done = results.filter(Boolean).length; report();
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }
  return results;
}

/**
 * Prepare photos. Returns { tiles, patches, count, tw, th, fileIdx, records, counts }.
 * records[i] = { name, status: "ok"|"rejected"|"duplicate", reason, trimmed, thumb } for every input file.
 */
export async function preparePhotos(files, s, { onProgress, signal, thumbs = false } = {}) {
  const core = await loadCore();
  const flags = prepFlags(s);
  const ratio = tileRatio(s), tw = Math.round(TILE_H * ratio), th = TILE_H;
  const cfg = { flags, ratio, tw, th, minSide: s.min_side, minSharp: s.min_sharpness, grayscale: s.grayscale, faces: s.detect_faces, thumbs, small: smallDecode() };
  const t0 = performance.now();
  const results = await processAll(core, files, cfg, { onProgress, signal });
  if (DEBUG) debugReport(files, results, performance.now() - t0);
  const cand = [];     // kept so far (before duplicate removal)
  const records = files.map((file, i) => {
    const r = results[i];
    const rec = { name: file.webkitRelativePath || file.name, status: r.status, reason: r.reason, trimmed: r.trimmed, thumb: r.thumb ? URL.createObjectURL(r.thumb) : null };
    if (r.status === "ok") cand.push({ i, rec, tile: r.tile, sharp: r.sharp, patch: r.patch, hash: r.hash });
    return rec;
  });
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
