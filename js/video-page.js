// Video page: live preview, style and every video option, save as MP4 (or WebM).
import { app, go, mount, persist, resetButton } from "./app.js";
import { h, $, card, title, row, toggle, slider, seg, select, color, group, toast } from "./ui.js";
import { STYLES, VIDEO_SHAPES } from "./settings.js";
import { createPlayer, exportMp4, exportWebm } from "./video.js";

let player = null, playing = null;
export function stopVideo() { if (playing) cancelAnimationFrame(playing.raf); playing = null; }

const STYLE_ICONS = {
  swarm: '<path d="M6 30c8-22 28-22 36-6M10 38c10-12 20-12 30 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  vortex: '<path d="M24 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M24 24c4-6 12-3 12 4s-10 13-20 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  wave: '<path d="M4 28c6-12 10 12 16 0s10 12 16 0 6-6 8-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  zoom: '<rect x="14" y="14" width="20" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6 6l8 8M42 6l-8 8M6 42l8-8M42 42l-8-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
};

export async function videoPage() {
  stopVideo();
  const st = app.settings;
  if (!app.result) { go("create"); return; }
  const cv = h("canvas", { class: "stage", id: "vcv" });
  const info = h("p", { class: "hint", role: "status" }, "Starting…");
  const playBtn = h("button", { class: "btn", type: "button" }, "Pause"), restart = h("button", { class: "btn", type: "button" }, "Restart");
  const styles = h("div", { class: "grid styles" });
  const save = h("button", { class: "btn primary big", style: { flex: 1 } }, "Make my video"), cancel = h("button", { class: "btn big", hidden: true }, "Cancel");
  const prog = h("progress", { value: 0, max: 1, hidden: true }), stage = h("p", { class: "hint", role: "status" });
  const dl = h("a", { class: "btn primary", style: { display: "none" } });
  const noVideo = typeof VideoEncoder === "undefined";

  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(apply, 250); };
  const change = () => { persist(); later(); };

  const content = h("div", { class: "page" },
    card(cv, info, h("div", { class: "row" }, playBtn, restart)),
    card(title("Style"), h("p", { class: "hint" }, ""), styles),
    card(title("Length and quality"),
      slider(st, "duration", { label: "Length", help: "length", min: 8, max: 40, step: 1, fmt: (v) => v + " s", onChange: (v, done) => { persist(); if (done) later(); } }),
      seg(st, "quality", [["draft", "Draft"], ["standard", "Standard"], ["high", "High"]], { label: "Video quality", help: "quality", onChange: change })),
    group("Advanced video options", [
      seg(st, "video_res", [[360, "360p"], [540, "540p"], [720, "720p"], [1080, "1080p"], [1440, "1440p"], [2160, "4K"]], { label: "Video resolution", help: "resolution", hint: "Draft quality always uses 360p.", onChange: change }),
      seg(st, "fps", [[30, "30"], [60, "60"]], { label: "Smoothness (frames per second)", help: "fps", onChange: change }),
      select(st, "video_aspect", VIDEO_SHAPES, { label: "Video shape", help: "video_shape", onChange: change }),
      slider(st, "hero_tiles", { label: "Showcase photos", help: "showcase", min: 0, max: 30, step: 1, onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "dof", { label: "Depth blur", help: "dof", min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "glow", { label: "Glow and shadow", help: "glow", min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "particles", { label: "Floating dust", help: "particles", min: 0, max: 500, step: 10, onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "pulses", { label: "Arrival waves", help: "pulses", min: 0, max: 8, step: 1, onChange: (v, d) => { persist(); d && later(); } }),
      toggle(st, "backdrop", { label: "Blurred backdrop", help: "backdrop", onChange: change }),
    ], { sub: "9 options" }),
    group("Look and motion", [
      slider(st, "hero_size", { label: "Showcase photo size", help: "hero_size", min: 0.2, max: 0.6, step: 0.02, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "flight_scale", { label: "How far tiles fly in from", help: "flight_scale", min: 1, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) + "x", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "flight_speed", { label: "Tile flight time", help: "flight_speed", min: 0.6, max: 1.6, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "arrival_spread", { label: "How long tiles keep arriving", help: "arrival_spread", min: 0.6, max: 1.2, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "spin", { label: "Tile spin and tilt", help: "spin", min: 0, max: 2, step: 0.1, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "pulse_depth", { label: "Arrival wave strength", help: "pulse_depth", min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "camera_motion", { label: "Camera sway", help: "camera_motion", min: 0, max: 2, step: 0.1, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "frame_margin", { label: "Camera framing (higher is closer)", help: "frame_margin", min: 0.5, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "reveal_time", { label: "Final picture appears at", help: "reveal_time", min: 0.6, max: 0.8, step: 0.02, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      color(st, "bg_color", { label: "Background colour", help: "bg_color", onChange: change }),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => { st.anim_seed = 1 + Math.floor(Math.random() * 9999); change(); toast("Shuffled the tile order and paths."); } }, "Shuffle the animation")),
    ], { sub: "11 options" }),
    card(title("Make your video"), prog, stage, h("div", { class: "row" }, save, cancel), dl,
      noVideo ? h("p", { class: "hint" }, "This browser cannot save MP4, so the video is recorded live as WebM instead (the video plays in real time while saving).") : null),
    h("div", { class: "row" }, resetButton(videoPage)));

  mount(videoPage, { title: "Design video", step: "video", content, back: "create", next: "home", nextLabel: "Finish" });

  Object.entries(STYLES).forEach(([k, [name, text]]) => {
    const b = h("button", { class: "style" + (st.style === k ? " on" : ""), type: "button", onclick: () => {
      st.style = k; persist(); [...styles.children].forEach((c) => c.classList.remove("on")); b.classList.add("on"); later(); } },
      h("svg", { viewBox: "0 0 48 48", width: 36, height: 36, html: STYLE_ICONS[k], "aria-hidden": "true" }), h("b", {}, name), h("span", {}, text));
    styles.append(b);
  });
  // svg created via h() needs the SVG namespace: rebuild icons properly
  styles.querySelectorAll("svg").forEach((old, i) => { const k = Object.keys(STYLES)[i]; const sv = document.createElementNS("http://www.w3.org/2000/svg", "svg"); sv.setAttribute("viewBox", "0 0 48 48"); sv.setAttribute("width", 36); sv.setAttribute("height", 36); sv.innerHTML = STYLE_ICONS[k]; old.replaceWith(sv); });

  try { player = await createPlayer(cv, app.result); }
  catch (e) { info.textContent = "Could not start the graphics: " + (e.message || e); return; }

  const startLoop = () => {
    const state = { t0: performance.now(), paused: false, raf: 0 };
    playing = state;
    const frame = () => {
      if (playing !== state) return;
      if (!state.paused) {
        const t = (performance.now() - state.t0) / 1000;
        if (t > player.duration + 1.5) state.t0 = performance.now();
        try { player.draw(Math.min(t, player.duration)); } catch (e) { info.textContent = "Drawing failed: " + (e.message || e); return; }
      }
      state.raf = requestAnimationFrame(frame);
    };
    frame();
    playBtn.onclick = () => { state.paused = !state.paused; playBtn.textContent = state.paused ? "Play" : "Pause"; if (!state.paused) state.t0 = performance.now(); };
    restart.onclick = () => { state.t0 = performance.now(); state.paused = false; playBtn.textContent = "Pause"; };
  };
  async function apply() {
    stopVideo();
    await player.configure(st);
    info.textContent = `${player.W} x ${player.H} · ${Math.round(player.duration)} s · ${player.fps} fps · ${player.backend}${player.samples > 1 ? " + smoothing" : ""}`;
    startLoop();
  }
  let ctl = null;
  save.onclick = async () => {
    ctl = new AbortController(); stopVideo();
    save.disabled = true; cancel.hidden = false; prog.hidden = false; dl.style.display = "none";
    let wake = null; try { wake = await navigator.wakeLock?.request("screen"); } catch {}
    try {
      stage.textContent = noVideo ? "Recording the video (this takes as long as the video)…" : "Rendering the video…";
      const blob = await (noVideo ? exportWebm : exportMp4)(player, cv, { signal: ctl.signal, onProgress: (f) => { prog.value = f; } });
      dl.href = URL.createObjectURL(blob); dl.download = "mosaic." + (noVideo ? "webm" : "mp4"); dl.style.display = "inline-flex"; dl.textContent = `Save the video (${(blob.size / 1e6).toFixed(1)} MB)`;
      stage.textContent = "Done.";
    } catch (e) { stage.textContent = e.name === "AbortError" ? "Cancelled." : "Something went wrong: " + (e.message || e); }
    finally { wake?.release?.(); save.disabled = false; cancel.hidden = true; prog.hidden = true; startLoop(); }
  };
  cancel.onclick = () => ctl?.abort();
  await apply();
}
