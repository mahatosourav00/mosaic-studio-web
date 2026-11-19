// Animation player + exporter. The Rust/wgpu renderer draws each frame onto a canvas; MP4 export captures
// those frames with WebCodecs (or records the canvas in real time as WebM where WebCodecs is missing).
import { loadCore } from "./engine.js";
import { decode, coverDraw, makeCanvas } from "./mosaic.js";
import { videoDims, isPhone, QUALITY_BPP } from "./settings.js";

const STYLE_IDX = { swarm: 0, vortex: 1, wave: 2, zoom: 3 };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Create a player on `canvas` for a finished mosaic (`result.scene`). Call `configure(settings)` before `draw`. */
export async function createPlayer(canvas, result, { forceGl = false } = {}) {
  const core = await loadCore();
  const sc = result.scene;
  const mosaicRatio = (sc.cols * sc.tileRatio) / sc.rows;
  const [W0, H0] = videoDims({ video_aspect: "same", video_res: 360 }, mosaicRatio);
  canvas.width = W0; canvas.height = H0;
  const r = await core.Renderer.create(canvas, forceGl, 4);
  r.set_tiles(sc.prep.tiles, sc.prep.tw, sc.prep.th, sc.prep.count);
  const player = { r, W: W0, H: H0, duration: 0, backend: r.backend(), samples: r.samples(), fps: 30 };

  player.configure = async (s0) => {
    const s = s0.quality === "draft" ? { ...s0, video_res: 360, fps: Math.min(15, s0.fps) } : s0;   // draft = small and quick
    const [W, H] = videoDims(s, mosaicRatio);
    if (W !== player.W || H !== player.H) { canvas.width = W; canvas.height = H; r.resize(W, H); player.W = W; player.H = H; }
    const bg = s.bg_color.map((v) => v / 255);
    const opts = new Float64Array([STYLE_IDX[s.style] ?? 0, s.duration, W / H, s.hero_tiles, s.hero_size, s.flight_scale,
      s.pulses, s.pulse_depth, s.frame_margin, s.anim_seed, s.tint > 0 ? 1 : 0, s.dof, s.glow, s.particles, s.bg_mode === "photo" ? 1 : 0,
      s.gap_px / Math.max(s.cell_px, 1), bg[0], bg[1], bg[2],
      s.flight_speed, s.arrival_spread, s.camera_motion, s.spin, s.reveal_time,
      s.entry, s.order, s.arc, s.ease, s.flash, s.hero_hold,
      { photo: 0, solid: 1, gradient: 2 }[s.bg_mode] ?? 0, ...s.bg_color2.map((v) => v / 255), s.bg_amount, s.bg_vignette, s.bg_lights,
      s.accent_mode === "custom" ? 1 : 0, ...s.accent_color.map((v) => v / 255),
      ...(s.cam_keys.length >= 7 ? [1, Math.floor(s.cam_keys.length / 7), ...s.cam_keys.slice(0, Math.floor(s.cam_keys.length / 7) * 7)] : [0, 0])]);
    const heroIds = r.set_scene(sc.cells, sc.cols, sc.rows, sc.tileRatio, sc.prep.patches, opts);
    await loadHeroes(r, sc, heroIds);
    // main picture overlay + blurred backdrop source (framed like the video)
    const mw = isPhone() ? 1024 : 2048, mh = Math.max(1, Math.round(mw / mosaicRatio));
    const mc = makeCanvas(mw, mh); mc.getContext("2d", { willReadFrequently: true }).drawImage(sc.crop, 0, 0, mw, mh);
    const main = mc.getContext("2d").getImageData(0, 0, mw, mh).data;
    const bw = 96, bh = Math.max(8, Math.round((bw * H) / W));
    const bc = makeCanvas(bw, bh), bctx = bc.getContext("2d", { willReadFrequently: true });
    coverDraw(bctx, sc.crop, bw, bh);
    const bpx = bctx.getImageData(0, 0, bw, bh).data, back = new Uint8Array(bw * bh * 3);
    for (let i = 0, j = 0; i < bpx.length; i += 4, j += 3) { back[j] = bpx[i]; back[j + 1] = bpx[i + 1]; back[j + 2] = bpx[i + 2]; }
    r.set_main(new Uint8Array(main.buffer, main.byteOffset, main.byteLength), mw, mh, back, bw, bh, s.main_blend);
    player.duration = r.duration();
    player.fps = s.fps;
    player.bpp = QUALITY_BPP[s0.quality] ?? 0.14;
  };
  player.draw = (t) => r.draw(Math.min(Math.max(t, 0), player.duration));
  return player;
}

async function loadHeroes(r, sc, heroIds) {
  if (!heroIds.length) return;
  const hh = isPhone() ? 256 : 512, hw = Math.max(1, Math.round(hh * sc.tileRatio));
  const out = new Uint8Array(hw * hh * 4 * heroIds.length);
  const cv = makeCanvas(hw, hh), ctx = cv.getContext("2d", { willReadFrequently: true });
  for (let k = 0; k < heroIds.length; k++) {
    const file = sc.files[sc.prep.fileIdx[heroIds[k]]];
    const bmp = file && (await decode(file));
    ctx.clearRect(0, 0, hw, hh);
    if (bmp) { coverDraw(ctx, bmp, hw, hh); bmp.close?.(); }
    else ctx.putImageData(new ImageData(new Uint8ClampedArray(sc.prep.tiles.buffer, sc.prep.tiles.byteOffset + heroIds[k] * sc.prep.tw * sc.prep.th * 4, sc.prep.tw * sc.prep.th * 4), sc.prep.tw, sc.prep.th), 0, 0);
    out.set(ctx.getImageData(0, 0, hw, hh).data, k * hw * hh * 4);
  }
  r.set_heroes(out, hw, hh, heroIds.length);
}

/** Encode the animation to an MP4 (H.264) with WebCodecs. Returns a Blob. */
export async function exportMp4(player, canvas, { onProgress, signal } = {}) {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser cannot save MP4 here. Try the WebM option.");
  const { Muxer, ArrayBufferTarget } = await import("../vendor/mp4-muxer.mjs");
  const { W, H, fps } = player;
  const codec = await pickCodec(W, H, fps);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
  let failure = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  enc.configure({ codec, width: W, height: H, bitrate: Math.round(W * H * fps * (player.bpp || 0.14)), framerate: fps });
  const total = Math.round(player.duration * fps);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) { enc.close(); throw new DOMException("Cancelled", "AbortError"); }
    if (failure) throw failure;
    player.draw(i / fps);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (enc.encodeQueueSize > 6) await tick();     // keep memory flat on phones
    if (i % 6 === 0) { onProgress?.((i + 1) / total); await tick(); }
  }
  await enc.flush();
  enc.close();
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}

async function pickCodec(W, H, fps) {
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42001f", "avc1.640032"]) {
    try { const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 4e6, framerate: fps }); if (r.supported) return codec; } catch {}
  }
  throw new Error("This device cannot encode H.264 video at this size. Try a smaller resolution.");
}

/** Fallback: record the canvas in real time as WebM (works where WebCodecs does not). */
export async function exportWebm(player, canvas, { onProgress, signal } = {}) {
  if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record video.");
  const stream = canvas.captureStream(player.fps);
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(player.W * player.H * player.fps * 0.1) });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  rec.start();
  const t0 = performance.now();
  await new Promise((resolve, reject) => {
    const step = () => {
      if (signal?.aborted) { rec.stop(); return reject(new DOMException("Cancelled", "AbortError")); }
      const t = (performance.now() - t0) / 1000;
      player.draw(t); onProgress?.(Math.min(t / player.duration, 1));
      if (t >= player.duration) resolve(); else requestAnimationFrame(step);
    };
    step();
  });
  rec.stop(); await done;
  return new Blob(chunks, { type: "video/webm" });
}
