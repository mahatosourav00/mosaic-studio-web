// Video page: live preview, style and every video option, save as MP4 (or WebM).
import { app, go, mount, persist, resetButton } from "./app.js";
import { h, $, card, title, row, toggle, slider, seg, select, color, group, toast, syncAll, helpButton } from "./ui.js";
import { cameraEditor, cameraKeys, randomCameraKeys, CAMERAS } from "./camera-editor.js";
import { STYLES, VIDEO_SHAPES, VIDEO_LOOKS, LOOK_KEYS, TILE_KEYS, TILE_PRESETS, BG_KEYS, BG_PRESETS, RANGES, ENTRY, ORDER, EASE, defaults } from "./settings.js";
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
  const looks = h("div", { class: "grid styles" });
  const tileRow = h("div", { class: "row" });
  const bgRow = h("div", { class: "row" });
  let bgSecond, bgAmount, accentPick;
  const bgVis = () => { bgSecond.style.display = st.bg_mode === "gradient" ? "" : "none"; bgAmount.style.display = st.bg_mode === "photo" ? "" : "none"; accentPick.style.display = st.accent_mode === "custom" ? "" : "none"; };
  const camEl = cameraEditor(st, (done) => { persist(); done && later(); }, null);
  const helped = (text, key) => { const t = title(text); t.querySelector("h2").append(" ", helpButton(key)); return t; };
  const myLooks = h("div", {});
  const saveLook = h("button", { class: "btn", type: "button" }, "Save my look");
  const save = h("button", { class: "btn primary big", style: { flex: 1 } }, "Make my video"), cancel = h("button", { class: "btn big", hidden: true }, "Cancel");
  const prog = h("progress", { value: 0, max: 1, hidden: true }), stage = h("p", { class: "hint", role: "status" });
  const dl = h("a", { class: "btn primary", style: { display: "none" } });
  const noVideo = typeof VideoEncoder === "undefined";

  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(apply, 250); };
  const change = () => { persist(); later(); };

  // The preview stays on screen while you scroll through the settings (can be switched off).
  const PIN = "mosaic-studio-pin-preview";
  let pinned = true; try { pinned = localStorage.getItem(PIN) !== "0"; } catch {}
  const pinBtn = h("button", { class: "btn", type: "button" });
  const previewCard = card(cv, info, h("div", { class: "row" }, playBtn, restart, pinBtn));
  const paintPin = () => { previewCard.classList.toggle("sticky-preview", pinned); pinBtn.textContent = pinned ? "📌 Preview pinned" : "📌 Pin preview"; pinBtn.classList.toggle("on", pinned); pinBtn.title = pinned ? "The preview follows you as you scroll. Tap to unpin." : "Keep the preview on screen while you scroll."; };
  pinBtn.onclick = () => { pinned = !pinned; try { localStorage.setItem(PIN, pinned ? "1" : "0"); } catch {} paintPin(); };
  const fitTop = () => { const t = document.querySelector("header.top"); previewCard.style.setProperty("--topH", (t ? t.offsetHeight : 56) + "px"); };
  addEventListener("resize", fitTop); paintPin(); fitTop();
  const content = h("div", { class: "page" },
    previewCard,
    card(helped("Style", "style"), h("p", { class: "hint" }, "Pick the basic choreography. The options below change how it plays."), styles),
    card(helped("Looks", "looks"), h("p", { class: "hint" }, "A Look is a ready-made bundle of settings. Tap one to load it, then fine-tune below. Not sure? Try Surprise me."), looks,
      myLooks, h("div", { class: "row" }, saveLook)),
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
    ], { sub: "8 options" }),
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
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => { st.anim_seed = 1 + Math.floor(Math.random() * 9999); change(); toast("Shuffled the tile order and paths."); } }, "Shuffle the animation")),
    ], { sub: "10 options" }),
    group("Background", [
      h("div", { class: "opt" }, h("div", { class: "opt-top" }, h("label", {}, "Quick presets"), helpButton("bg_presets")), bgRow),
      seg(st, "bg_mode", [["photo", "Photo glow"], ["solid", "Solid colour"], ["gradient", "Gradient"]], { label: "Background type", help: "bg_mode", onChange: () => { bgVis(); change(); } }),
      color(st, "bg_color", { label: "Colour", help: "bg_color", onChange: change }),
      bgSecond = color(st, "bg_color2", { label: "Second colour (bottom)", help: "bg_color2", onChange: change }),
      bgAmount = slider(st, "bg_amount", { label: "Photo strength", help: "bg_amount", min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "bg_vignette", { label: "Edge darkening", help: "bg_vignette", min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "bg_lights", { label: "Colour lights", help: "bg_lights", min: 0, max: 2, step: 0.1, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      seg(st, "accent_mode", [["photo", "Match photo"], ["custom", "My colour"]], { label: "Glow and dust colour", help: "accent_mode", onChange: () => { bgVis(); change(); } }),
      accentPick = color(st, "accent_color", { label: "My glow colour", help: "accent_color", onChange: change }),
    ], { sub: "type, colours, lights", help: "background" }),
    group("Camera", [camEl], { sub: "moves and keyframes", help: "camera" }),
    group("Tile motion and build", [
      h("div", { class: "opt" }, h("div", { class: "opt-top" }, h("label", {}, "Quick presets"), helpButton("tile_presets")), tileRow),
      select(st, "entry", ENTRY, { label: "Tiles fly in from", help: "entry", onChange: change }),
      select(st, "order", ORDER, { label: "Build order", help: "order", onChange: change }),
      slider(st, "arc", { label: "Flight curve", help: "arc", min: 0, max: 2, step: 0.1, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      select(st, "ease", EASE, { label: "Landing feel", help: "ease", onChange: change }),
      slider(st, "flash", { label: "Landing sparkle", help: "flash", min: 0, max: 2, step: 0.1, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
      slider(st, "hero_hold", { label: "Showcase hold", help: "hero_hold", min: 0, max: 0.95, step: 0.05, fmt: (v) => Math.round(v * 100) + "%", onChange: (v, d) => { persist(); d && later(); } }),
    ], { sub: "6 options" }),
    card(title("Make your video"), prog, stage, h("div", { class: "row" }, save, cancel), dl,
      noVideo ? h("p", { class: "hint" }, "This browser cannot save MP4, so the video is recorded live as WebM instead (the video plays in real time while saving).") : null),
    h("div", { class: "row" }, resetButton(videoPage)));

  mount(videoPage, { title: "Design video", step: "video", content, back: "create", next: "home", nextLabel: "Finish" });
  fitTop();

  Object.entries(STYLES).forEach(([k, [name, text]]) => {
    const b = h("button", { class: "style" + (st.style === k ? " on" : ""), type: "button", onclick: () => {
      st.style = k; persist(); [...styles.children].forEach((c) => c.classList.remove("on")); b.classList.add("on"); later(); } },
      h("svg", { viewBox: "0 0 48 48", width: 36, height: 36, html: STYLE_ICONS[k], "aria-hidden": "true" }), h("b", {}, name), h("span", {}, text));
    styles.append(b);
  });
  // svg created via h() needs the SVG namespace: rebuild icons properly
  styles.querySelectorAll("svg").forEach((old, i) => { const k = Object.keys(STYLES)[i]; const sv = document.createElementNS("http://www.w3.org/2000/svg", "svg"); sv.setAttribute("viewBox", "0 0 48 48"); sv.setAttribute("width", 36); sv.setAttribute("height", 36); sv.innerHTML = STYLE_ICONS[k]; old.replaceWith(sv); });

  // ---- Presets: ready-made looks, Default, Surprise me, and the user's own saved looks -------------------
  const MY = "mosaic-studio-looks-v1";
  const mine = () => { try { return JSON.parse(localStorage.getItem(MY)) || {}; } catch { return {}; } };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  /** A full set of look settings: defaults first, then what the look changes, so presets never inherit leftovers. */
  const resolve = (l) => {
    const d = defaults(), out = Object.fromEntries(LOOK_KEYS.map((k) => [k, clone(d[k])]));
    Object.assign(out, clone(l.v || {}));
    if (l.cam) out.cam_keys = cameraKeys(l.cam);
    return out;
  };
  const applyKeys = (v) => {
    Object.assign(st, clone(v));
    persist(); syncAll(content); camEl.refresh();
    [...styles.children].forEach((c, i) => c.classList.toggle("on", Object.keys(STYLES)[i] === st.style));
    paintAll(); later();
  };
  const R = (k) => { const [a, b, step] = RANGES[k]; return Math.round((a + Math.random() * (b - a)) / step) * step; };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const seed = () => 1 + Math.floor(Math.random() * 9999);
  const surpriseLook = () => {
    // start from a real look so the result stays coherent, then vary it
    const base = resolve(pick(Object.values(VIDEO_LOOKS).slice(1)));
    for (const k of Object.keys(RANGES)) if (Math.random() < 0.6) base[k] = R(k);
    base.style = pick(Object.keys(STYLES));
    if (Math.random() < 0.5) base.cam_keys = Math.random() < 0.5 ? randomCameraKeys() : cameraKeys(pick(Object.keys(CAMERAS)));
    if (Math.random() < 0.5) { base.entry = pick([0, 1, 2, 3, 4, 5, 6]); base.order = pick([0, 1, 2, 3, 4, 5, 6, 7]); base.ease = pick([0, 1, 2, 3, 4]); }
    base.anim_seed = seed();
    applyKeys(base);
    toast("A new random look. Tap Surprise me again for another.");
  };

  const lookCards = [];   // { el, v } for highlighting
  const card1 = (icon, label, text, onclick) => h("button", { class: "style", type: "button", onclick }, h("b", {}, (icon ? icon + " " : "") + label), h("span", {}, text));
  const SAME = LOOK_KEYS.filter((k) => k !== "anim_seed");
  const matches = (v) => SAME.every((k) => JSON.stringify(st[k]) === JSON.stringify(v[k]));
  function drawLooks() {
    lookCards.length = 0;
    const kids = [];
    Object.values(VIDEO_LOOKS).forEach((l, i) => {
      const v = resolve(l);
      const el = card1(l.icon, l.label, l.text, () => applyKeys(v));
      lookCards.push({ el, v }); kids.push(el);
      if (i === 0) kids.push(card1("🎲", "Surprise me", "A random look every time. Great for finding ideas.", surpriseLook));
    });
    looks.replaceChildren(...kids);
    const all = mine(), names = Object.keys(all);
    myLooks.replaceChildren();
    if (names.length) {
      const g = h("div", { class: "grid styles" });
      names.forEach((n) => {
        const v = { ...resolve({}), ...all[n] };
        const el = card1("★", n, "Your saved look.", () => applyKeys(v));
        lookCards.push({ el, v });
        g.append(h("div", { class: "mylook" }, el, h("button", { class: "btn ghost", type: "button", onclick: () => {
          if (!confirm(`Delete "${n}"?`)) return; const a = mine(); delete a[n]; try { localStorage.setItem(MY, JSON.stringify(a)); } catch {} drawLooks(); paintAll();
        } }, "Delete")));
      });
      myLooks.append(h("p", { class: "sub-h" }, "My looks"), g);
    }
  }
  saveLook.onclick = () => {
    const name = (prompt("Name your look") || "").trim().slice(0, 24);
    if (!name) return;
    const all = mine(); all[name] = Object.fromEntries(LOOK_KEYS.map((k) => [k, clone(st[k])]));
    try { localStorage.setItem(MY, JSON.stringify(all)); } catch { toast("Could not save in this browser."); return; }
    drawLooks(); paintAll(); toast(`Saved "${name}".`);
  };

  // tile motion presets: Default, Gentle, Lively, Wild, Surprise
  const tileBtns = [];
  const tileSet = (v) => { const d = defaults(); const out = {}; TILE_KEYS.forEach((k) => { out[k] = d[k]; }); return Object.assign(out, v); };
  const tileOpts = [
    ["Default", tileSet({})],
    ...Object.values(TILE_PRESETS).map((p) => [p.label, tileSet(p.v)]),
  ];
  tileOpts.forEach(([label, v]) => { const b = h("button", { class: "btn", type: "button", onclick: () => applyKeys(v) }, label); tileBtns.push({ b, v }); tileRow.append(b); });
  tileRow.append(h("button", { class: "btn", type: "button", onclick: () => {
    const v = tileSet({}); Object.keys(RANGES).forEach((k) => { if (TILE_KEYS.includes(k)) v[k] = R(k); });
    v.entry = pick([0, 1, 2, 3, 4, 5, 6]); v.order = pick([0, 1, 2, 3, 4, 5, 6, 7]); v.ease = pick([0, 1, 2, 3, 4]); v.anim_seed = seed();
    applyKeys(v); toast("Random tile motion.");
  } }, "🎲 Surprise"));

  // background presets: Default, moods, Surprise
  const bgBtns = [];
  const bgSet = (v) => { const d = defaults(); const out = {}; BG_KEYS.forEach((k) => { out[k] = clone(d[k]); }); return Object.assign(out, clone(v)); };
  const hsl = (h2, s2, l2) => { const f = (n) => { const k = (n + h2 / 30) % 12, a = s2 * Math.min(l2, 1 - l2); return Math.round(255 * (l2 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; };
  [["Default", bgSet({})], ...Object.values(BG_PRESETS).map((p) => [p.icon + " " + p.label, bgSet(p.v)])].forEach(([label, v]) => {
    const b = h("button", { class: "btn", type: "button", onclick: () => applyKeys(v) }, label); bgBtns.push({ b, v }); bgRow.append(b);
  });
  bgRow.append(h("button", { class: "btn", type: "button", onclick: () => {
    const hue = Math.floor(Math.random() * 360), light = Math.random() < 0.15;
    const v = bgSet(light ? { bg_mode: "solid", bg_color: hsl(hue, 0.35, 0.92), bg_lights: 0, bg_vignette: 0.15, accent_mode: "custom", accent_color: hsl(hue, 0.5, 0.45) }
      : pick(["gradient", "gradient", "solid", "photo"]) === "photo" ? { bg_mode: "photo", bg_color: hsl(hue, 0.5, 0.06), bg_vignette: 0.5 + Math.random() * 0.4, bg_lights: 0.8 + Math.random() }
      : { bg_mode: "gradient", bg_color: hsl(hue, 0.55, 0.16), bg_color2: hsl((hue + 25 + Math.random() * 40) % 360, 0.5, 0.06 + Math.random() * 0.14), bg_lights: 0.8 + Math.random() * 0.6,
          accent_mode: "custom", accent_color: hsl((hue + 20) % 360, 0.8, 0.7) });
    applyKeys(v); toast("Random background.");
  } }, "🎲 Surprise"));

  function paintAll() {
    lookCards.forEach(({ el, v }) => el.classList.toggle("on", matches(v)));
    bgBtns.forEach(({ b, v }) => b.classList.toggle("on", BG_KEYS.every((k) => JSON.stringify(st[k]) === JSON.stringify(v[k]))));
    bgVis();
    tileBtns.forEach(({ b, v }) => b.classList.toggle("on", TILE_KEYS.every((k) => JSON.stringify(st[k]) === JSON.stringify(v[k]))));
  }
  content.addEventListener("input", paintAll); content.addEventListener("change", paintAll); content.addEventListener("click", () => setTimeout(paintAll, 0));
  drawLooks(); paintAll();

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
