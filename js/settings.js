// Every user option (names follow mosaicvid/settings.py), presets, size maths and settings files.
export const isPhone = () => matchMedia("(pointer: coarse)").matches || (navigator.deviceMemory || 8) <= 4;

export const PRESETS = {
  draft:    { label: "Quick draft",  num_tiles: 800,  cell_px: 32 },
  balanced: { label: "Balanced",     num_tiles: 1500, cell_px: 64 },
  best:     { label: "Best quality", num_tiles: 3000, cell_px: 96 },
};
export const SHAPES = { image: "Same as the main picture", "9:16": "Story 9:16", "4:5": "Portrait 4:5", "1:1": "Square 1:1", "16:9": "Wide 16:9" };
export const TILE_SHAPES = { "1:1": "Square", "4:3": "Wide 4:3", "3:2": "Wide 3:2", "3:4": "Tall 3:4", "2:3": "Tall 2:3" };
export const VIDEO_SHAPES = { same: "Same as the mosaic", "9:16": "Story 9:16", "4:5": "Portrait 4:5", "1:1": "Square 1:1", "16:9": "Wide 16:9" };
export const STYLES = {
  swarm: ["Swarm", "Tiles swoop in from all sides while the camera orbits and sweeps."],
  vortex: ["Vortex", "The camera circles the subject as tiles spiral in."],
  wave: ["Wave", "A sideways tracking shot follows a wave of tiles."],
  zoom: ["Zoom", "Starts macro-close, then pulls straight back to reveal the picture."],
};
export const EXACT_SIZES = [["Full HD", 1920], ["4K", 3840], ["8K", 7680], ["12K", 12000], ["16K", 16000]];

export function defaults() {
  const phone = isPhone();
  return {
    // pictures / prepare
    include_subfolders: true, exclude_dirs: [],
    prep_skip: false, trim_borders: true, dedupe: true, filter_photos: true, smart_crop: true,
    min_sharpness: 8, min_side: 96,
    // mosaic
    preset: "balanced", num_tiles: 1500, tile_aspect: "1:1", mosaic_aspect: "image", cell_px: 64, gap_px: 0, gap_color: [0, 0, 0],
    max_uses: 0, min_distance: 6, allow_flip: true, even_usage: 0.5,
    use_subtiles: false, subtile_percent: 20, subtile_grid: 2, subtile_select: "detail",
    tint: 0.6, main_blend: 0.1, subject_weight: 0.6, detect_faces: true, grayscale: false, seed: 42,
    // output image
    also_video: true, output_mode: "screen", print_w: 24, print_unit: "in", print_dpi: 300, exact_side: "width", exact_px: 3840,
    image_format: "png", image_quality: 95,
    // video
    style: "swarm", duration: 20, quality: "standard", video_res: phone ? 720 : 1080, fps: 30, video_aspect: "same",
    hero_tiles: 12, hero_size: 0.38, flight_scale: 1.7, pulses: 4, pulse_depth: 0.55, dof: 0.7, frame_margin: 0.8,
    backdrop: true, glow: 0.6, particles: phone ? 120 : 220, bg_color: [10, 10, 14], anim_seed: 7,
    flight_speed: 1, arrival_spread: 1, camera_motion: 1, spin: 1, reveal_time: 0.78,
  };
}

export function tileRatio(s) { const [a, b] = s.tile_aspect.split(":").map(Number); return a / b; }

/** Biggest still image we allow, in pixels (phones are tight on memory). */
export function maxStillPixels() { return isPhone() ? 16e6 : 64e6; }

/** Pixel height of one base cell so the still has the requested size. Returns { cellH, capped, width, height, dpi }. */
export function stillPlan(s, cols, rows) {
  const r = tileRatio(s);
  const W = (h) => cols * Math.max(1, Math.round(h * r)), H = (h) => rows * h;
  let cellH = s.cell_px, dpi = 0;
  if (s.output_mode === "print") {
    const inches = s.print_unit === "cm" ? s.print_w / 2.54 : s.print_w;
    cellH = Math.round((inches * s.print_dpi) / (cols * r)); dpi = s.print_dpi;
  } else if (s.output_mode === "exact") {
    cellH = s.exact_side === "width" ? Math.round(s.exact_px / (cols * r)) : Math.round(s.exact_px / rows);
  }
  cellH = Math.min(512, Math.max(8, cellH));
  let capped = false;
  while (cellH > 8 && W(cellH) * H(cellH) > maxStillPixels()) { cellH = Math.floor(cellH * 0.92); capped = true; }
  return { cellH, capped, width: W(cellH), height: H(cellH), dpi };
}

/** Plain-language advice about how often each photo repeats. */
export function repeatAdvice(cells, photos) {
  if (!photos) return null;
  const per = cells / photos;
  if (per <= 1.2) return { tone: "ok", text: "Every photo can be used about once. Great variety." };
  if (per <= 4) return { tone: "ok", text: `Each photo will appear about ${Math.round(per)} times. Looks varied.` };
  if (per <= 10) return { tone: "warn", text: `Each photo will appear about ${Math.round(per)} times. Add more photos or choose fewer tiles for more variety.` };
  return { tone: "bad", text: `Each photo would repeat about ${Math.round(per)} times. Choose fewer tiles or add more photos.` };
}

/** Video size in pixels (even numbers); `res` is the short side. */
export function videoDims(s, mosaicRatio) {
  let a, b;
  if (s.video_aspect === "same") { a = mosaicRatio; b = 1; } else { [a, b] = s.video_aspect.split(":").map(Number); }
  const [w, h] = a <= b ? [s.video_res, (s.video_res * b) / a] : [(s.video_res * a) / b, s.video_res];
  return [Math.round(w / 2) * 2, Math.round(h / 2) * 2];
}

/** bits per pixel per frame for the three video quality levels */
export const QUALITY_BPP = { draft: 0.07, standard: 0.14, high: 0.26 };

// ---- persistence and settings files (photo folders are never stored) ------------------------
const KEY = "mosaic-studio-settings-v1";
export function loadSaved() {
  const s = defaults();
  try { Object.assign(s, pick(JSON.parse(localStorage.getItem(KEY) || "{}"), s)); } catch {}
  return s;
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
function pick(src, like) { const o = {}; for (const k of Object.keys(like)) if (k in src && typeof src[k] === typeof like[k]) o[k] = src[k]; return o; }
export function toFile(s) { const o = { ...s }; delete o.exclude_dirs; return new Blob([JSON.stringify({ app: "mosaic-studio-web", settings: o }, null, 2)], { type: "application/json" }); }
export function fromText(text, s) {
  const j = JSON.parse(text);
  Object.assign(s, pick(j.settings || j, defaults()));
  s.exclude_dirs = [];
  return s;
}
