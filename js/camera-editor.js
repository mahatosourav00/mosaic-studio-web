// Camera designer: ready-made camera moves + a small timeline where you drag keyframes.
// A keyframe is [time 0..1, distance (1 = whole picture), pan x, pan y, turn, tilt, roll]. The camera always ends on the full picture.
import { h, slider, helpButton } from "./ui.js";

export const CAMERAS = {
  orbit:   { label: "Orbit",     text: "Circles around the picture, then settles.",
             keys: [[0, 0.4, 0, 0, 50, 15, 0], [0.25, 0.55, 0.1, -0.05, 10, 20, 4], [0.5, 0.7, -0.1, 0.05, -35, 10, -4], [0.75, 0.9, 0, 0, 12, 4, 0]] },
  push:    { label: "Push in",   text: "Starts wide and glides closer.",
             keys: [[0, 1.5, 0, 0, 0, 0, 0], [0.45, 0.8, 0, 0, 0, 0, 0], [0.8, 0.95, 0, 0, 0, 0, 0]] },
  pull:    { label: "Pull back", text: "Starts tight on the middle, then reveals everything.",
             keys: [[0, 0.2, 0, 0, 0, 0, 0], [0.4, 0.35, 0, 0, 0, 0, 0], [0.75, 0.8, 0, 0, 0, 0, 0]] },
  sweep:   { label: "Sweep",     text: "Slides across the picture from left to right.",
             keys: [[0, 0.45, -0.3, 0, 22, 0, 0], [0.3, 0.45, -0.1, 0, 10, 0, 0], [0.6, 0.5, 0.2, 0, -8, 0, 0], [0.8, 0.85, 0, 0, 0, 0, 0]] },
  crane:   { label: "Crane",     text: "Swoops down from high above.",
             keys: [[0, 0.8, 0, 0.1, 0, 55, 0], [0.4, 0.55, 0, 0, 12, 25, 3], [0.75, 0.9, 0, 0, 0, 4, 0]] },
  static:  { label: "Static",    text: "A steady, locked-off shot of the whole picture.",
             keys: [[0, 1, 0, 0, 0, 0, 0]] },
};

const W = 320, Ht = 120, PAD = 14, DMIN = 0.1, DMAX = 2.2;
const tx = (t) => PAD + t * (W - 2 * PAD);
const dy = (d) => PAD + (1 - (Math.log(Math.min(Math.max(d, DMIN), DMAX)) - Math.log(DMIN)) / (Math.log(DMAX) - Math.log(DMIN))) * (Ht - 2 * PAD);
const dFromY = (y) => Math.exp(Math.log(DMIN) + (1 - (y - PAD) / (Ht - 2 * PAD)) * (Math.log(DMAX) - Math.log(DMIN)));
const ns = (n) => document.createElementNS("http://www.w3.org/2000/svg", n);
const flat = (keys) => keys.flat();
export const cameraKeys = (name) => (CAMERAS[name] ? flat(CAMERAS[name].keys) : []);
const rnd = (a, b, step) => Math.round((a + Math.random() * (b - a)) / step) * step;
/** Random but pleasant camera: 3 or 4 keyframes with moderate moves. */
export function randomCameraKeys() {
  const n = 3 + Math.floor(Math.random() * 2), keys = [];
  for (let i = 0; i < n; i++) {
    const t = i === 0 ? 0 : Math.round(((i / n) * 0.8 + Math.random() * 0.05) * 100) / 100;
    keys.push([t, rnd(0.3, i === n - 1 ? 1 : 1.6, 0.05), rnd(-0.2, 0.2, 0.02), rnd(-0.12, 0.12, 0.02), rnd(-60, 60, 1), rnd(0, 35, 1), rnd(-6, 6, 1)]);
  }
  return keys.flat();
}
const rows = (flatKeys) => { const r = []; for (let i = 0; i + 6 < flatKeys.length; i += 7) r.push(flatKeys.slice(i, i + 7)); return r; };

/** Builds the camera card body. `st` is the settings object; `changed(done)` is called on every edit (done = finished dragging). */
export function cameraEditor(st, changed, onPreset) {
  let sel = 0;
  const get = () => rows(st.cam_keys);
  const put = (r) => { st.cam_keys = flat(r); };

  const presets = h("div", { class: "grid styles" });
  const svg = ns("svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${Ht}`); svg.setAttribute("class", "camline"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Camera timeline. Drag a dot sideways to change when it happens, up or down to change how close the camera is.");
  svg.style.cssText = "width:100%;height:auto;max-height:190px;touch-action:none;background:var(--s2);border-radius:12px;display:block";
  const detail = h("div", {});
  const note = h("p", { class: "hint" });

  const sliders = {};
  const mk = (key, idx, o) => {
    const proxy = { get [key]() { return get()[sel]?.[idx] ?? 0; }, set [key](v) { const r = get(); if (r[sel]) { r[sel][idx] = v; put(r); } } };
    const el = slider(proxy, key, { ...o, onChange: (v, d) => { draw(); changed(d); } });
    sliders[key] = el; return el;
  };
  const sTime = mk("cam_time", 0, { label: "When (share of the video)", help: "cam_time", min: 0, max: 0.85, step: 0.01, fmt: (v) => Math.round(v * 100) + "%" });
  const sZoom = mk("cam_zoom", 1, { label: "Distance (smaller is closer)", help: "cam_zoom", min: 0.1, max: 2.2, step: 0.05, fmt: (v) => v.toFixed(2) + "x" });
  const sPx = mk("cam_px", 2, { label: "Move left / right", help: "cam_pan", min: -0.5, max: 0.5, step: 0.02, fmt: (v) => Math.round(v * 100) + "%" });
  const sPy = mk("cam_py", 3, { label: "Move up / down", help: "cam_pan", min: -0.5, max: 0.5, step: 0.02, fmt: (v) => Math.round(v * 100) + "%" });
  const sYaw = mk("cam_yaw", 4, { label: "Turn around the picture", help: "cam_yaw", min: -180, max: 180, step: 1, fmt: (v) => v + "°" });
  const sPitch = mk("cam_pitch", 5, { label: "Look from above / below", help: "cam_pitch", min: -80, max: 80, step: 1, fmt: (v) => v + "°" });
  const sRoll = mk("cam_roll", 6, { label: "Tilt the horizon", help: "cam_roll", min: -45, max: 45, step: 1, fmt: (v) => v + "°" });

  const add = h("button", { class: "btn", type: "button", onclick: () => {
    const r = get(); if (r.length >= 8) return;
    const a = r[sel], b = r[sel + 1];
    const t = b ? (a[0] + b[0]) / 2 : Math.min(0.85, a[0] + 0.12);
    if (t - a[0] < 0.03 || t > 0.85) return;
    const nk = b ? a.map((v, i) => (v + b[i]) / 2) : [...a]; nk[0] = t;
    r.splice(sel + 1, 0, nk); put(r); sel++; draw(); changed(true);
  } }, "Add a keyframe");
  const del = h("button", { class: "btn", type: "button", onclick: () => {
    const r = get(); if (r.length <= 1) return;
    r.splice(sel, 1); if (r[0]) r[0][0] = 0; put(r); sel = Math.max(0, sel - 1); draw(); changed(true);
  } }, "Remove this keyframe");

  function draw() {
    const r = get();
    const on = r.length > 0;
    svg.replaceChildren(); detail.style.display = on ? "" : "none";
    note.textContent = on ? "Drag the dots: sideways changes when, up or down changes how close the camera is. Tap a dot to fine-tune it below."
                          : "The camera follows the Style you picked. Choose a camera move above to design your own.";
    if (!on) { svg.style.display = "none"; return; }
    svg.style.display = "block";
    sel = Math.min(sel, r.length - 1);
    const rev = ns("line"); rev.setAttribute("x1", tx(0.92)); rev.setAttribute("x2", tx(0.92)); rev.setAttribute("y1", 4); rev.setAttribute("y2", Ht - 4);
    rev.setAttribute("stroke", "currentColor"); rev.setAttribute("stroke-dasharray", "3 4"); rev.setAttribute("opacity", ".35"); svg.append(rev);
    const lab = ns("text"); lab.textContent = "full picture"; lab.setAttribute("x", tx(0.92) - 4); lab.setAttribute("y", Ht - 4); lab.setAttribute("text-anchor", "end");
    lab.setAttribute("font-size", "9"); lab.setAttribute("fill", "currentColor"); lab.setAttribute("opacity", ".6"); svg.append(lab);
    const pts = [...r.map((k) => [tx(k[0]), dy(k[1])]), [tx(0.92), dy(1)], [tx(1), dy(0.985)]];
    const line = ns("polyline"); line.setAttribute("points", pts.map((q) => q.join(",")).join(" ")); line.setAttribute("fill", "none");
    line.setAttribute("stroke", "var(--accent)"); line.setAttribute("stroke-width", "2.5"); line.setAttribute("stroke-linejoin", "round"); svg.append(line);
    r.forEach((k, i) => {
      const c = ns("circle"); c.setAttribute("cx", tx(k[0])); c.setAttribute("cy", dy(k[1])); c.setAttribute("r", i === sel ? 9 : 7);
      c.setAttribute("fill", i === sel ? "var(--accent)" : "var(--s1)"); c.setAttribute("stroke", "var(--accent)"); c.setAttribute("stroke-width", "2.5");
      c.style.cursor = "grab";
      c.addEventListener("pointerdown", (e) => { e.preventDefault(); sel = i; c.setPointerCapture(e.pointerId); drag = i; syncSliders(); draw(); });
      svg.append(c);
    });
    syncSliders();
  }
  let drag = -1;
  const pos = (e) => { const b = svg.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * Ht]; };
  svg.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const r = get(), [x, y] = pos(e);
    const lo = drag === 0 ? 0 : r[drag - 1][0] + 0.03, hi = drag === r.length - 1 ? 0.85 : r[drag + 1][0] - 0.03;
    r[drag][0] = drag === 0 ? 0 : Math.min(hi, Math.max(lo, (x - PAD) / (W - 2 * PAD)));
    r[drag][1] = Math.round(Math.min(DMAX, Math.max(DMIN, dFromY(y))) * 20) / 20;
    put(r); redrawDots(); syncSliders();
  });
  const end = () => { if (drag >= 0) { drag = -1; draw(); changed(true); } };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  function redrawDots() { const keepSel = sel; draw(); sel = keepSel; }
  function syncSliders() { Object.values(sliders).forEach((s) => s.sync && s.sync()); sTime.style.display = sel === 0 ? "none" : ""; del.disabled = get().length <= 1; }

  const fresh = () => { // rebuild preset buttons (highlights the one that matches)
    presets.replaceChildren(
      h("button", { class: "style" + (st.cam_keys.length ? "" : " on"), type: "button", onclick: () => { st.cam_keys = []; sel = 0; draw(); paintPresets(); changed(true); } },
        h("b", {}, "As the style designed"), h("span", {}, "Use the camera that comes with the chosen Style.")),
      ...Object.entries(CAMERAS).map(([k, c]) => h("button", { class: "style", type: "button", "data-cam": k,
        onclick: () => { st.cam_keys = flat(c.keys); sel = 0; draw(); paintPresets(); changed(true); } }, h("b", {}, c.label), h("span", {}, c.text))));
  };
  function paintPresets() {
    const same = (k) => JSON.stringify(flat(CAMERAS[k].keys)) === JSON.stringify(st.cam_keys);
    [...presets.children].forEach((b, i) => b.classList.toggle("on", i === 0 ? st.cam_keys.length === 0 : same(Object.keys(CAMERAS)[i - 1])));
  }
  fresh(); paintPresets();

  const dice = h("button", { class: "btn", type: "button", onclick: () => { st.cam_keys = randomCameraKeys(); sel = 0; draw(); paintPresets(); changed(true); } }, "🎲 Surprise camera");
  const root = h("div", {}, presets, h("div", { class: "row" }, dice), svg, note, detail);
  detail.append(sTime, sZoom, sPx, sPy, sYaw, sPitch, sRoll, h("div", { class: "row" }, add, del));
  root.refresh = () => { sel = 0; draw(); paintPresets(); };
  draw();
  return root;
}
