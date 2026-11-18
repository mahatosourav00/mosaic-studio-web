// Small UI toolkit: option rows, toggles, sliders, segmented controls, "?" guides, banners, sheets.
import { HELP } from "./help.js";

export const $ = (s, r = document) => r.querySelector(s);
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

// ---- bottom sheet (used for "?" guides and the photo report) --------------------------------
export function sheet(title, body, { actions } = {}) {
  const back = h("div", { class: "sheet-back" });
  const close = () => { back.classList.remove("open"); setTimeout(() => back.remove(), 200); document.removeEventListener("keydown", esc); };
  const esc = (e) => e.key === "Escape" && close();
  const box = h("div", { class: "sheet", role: "dialog", "aria-label": title },
    h("div", { class: "grab" }),
    h("div", { class: "sheet-head" }, h("h2", {}, title), h("button", { class: "icon-btn", "aria-label": "Close", onclick: close }, "✕")),
    h("div", { class: "sheet-body" }, body),
    actions ? h("div", { class: "sheet-actions" }, actions) : null);
  back.append(box);
  back.addEventListener("click", (e) => e.target === back && close());
  document.addEventListener("keydown", esc);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add("open"));
  return { close, box };
}

export function helpButton(key, fallback) {
  const g = HELP[key] || fallback;
  if (!g) return null;
  return h("button", { class: "help", "aria-label": `About: ${g.title}`, type: "button", onclick: () => {
    sheet(g.title, [h("p", {}, g.text), g.rec ? h("p", { class: "rec" }, h("b", {}, "Recommended: "), g.rec) : null]);
  } }, "?");
}

// ---- layout pieces ---------------------------------------------------------------------------
export const card = (...kids) => h("section", { class: "card" }, ...kids);
export const title = (text, sub) => h("div", { class: "hd" }, h("h2", {}, text), sub ? h("p", {}, sub) : null);

/** An option: label (+ "?"), optional value text, optional hint, then the control(s). */
export function row({ label, help, value, hint, inline }, ...controls) {
  const valueEl = h("span", { class: "val" }, value ?? "");
  const el = h("div", { class: "opt" + (inline ? " inline" : "") },
    h("div", { class: "opt-top" }, h("label", {}, label), valueEl, help ? helpButton(help) : null),
    hint ? h("p", { class: "hint" }, hint) : null, ...controls);
  el.setValue = (t) => { valueEl.textContent = t; };
  return el;
}

export function banner(tone, text) { return h("div", { class: `banner ${tone}` }, h("span", { class: "dot" }), h("span", {}, text)); }

/** Collapsible group; `open` keeps it expanded. */
export function group(label, kids, { open = false, sub } = {}) {
  const d = h("details", { class: "group" }, h("summary", {}, h("span", {}, label), sub ? h("small", {}, sub) : null), h("div", { class: "group-body" }, kids));
  if (open) d.open = true;
  return d;
}

// ---- controls bound to a settings object -----------------------------------------------------
/** On/off switch. */
export function toggle(s, key, { label, help, hint, onChange, invert } = {}) {
  const get = () => (invert ? !s[key] : !!s[key]);
  const input = h("input", { type: "checkbox", role: "switch", id: "t_" + key });
  input.checked = get();
  input.addEventListener("change", () => { s[key] = invert ? !input.checked : input.checked; onChange?.(s[key]); });
  const sw = h("label", { class: "switch", for: "t_" + key }, input, h("span", { class: "knob" }));
  const el = h("div", { class: "opt inline" }, h("div", { class: "opt-top" }, h("label", { for: "t_" + key }, label), help ? helpButton(help) : null, sw), hint ? h("p", { class: "hint" }, hint) : null);
  el.sync = () => { input.checked = get(); };
  el.input = input;
  return el;
}

/** Slider with a live value. `fmt` formats the number for display; `scale` multiplies it (0..1 -> 0..100). */
export function slider(s, key, { label, help, hint, min, max, step = 1, fmt = (v) => v, onChange, off } = {}) {
  const input = h("input", { type: "range", min, max, step, id: "s_" + key, value: s[key] });
  const show = (v) => (off != null && +v === off.at ? off.text : fmt(+v));
  const el = row({ label, help, hint, value: show(s[key]) }, h("div", { class: "range" }, h("span", {}, show(min)), input, h("span", {}, show(max))));
  const paint = () => { const p = ((input.value - min) / (max - min)) * 100; input.style.setProperty("--p", p + "%"); };
  input.addEventListener("input", () => { s[key] = +input.value; el.setValue(show(input.value)); paint(); onChange?.(s[key], false); });
  input.addEventListener("change", () => onChange?.(s[key], true));
  el.sync = () => { input.value = s[key]; el.setValue(show(s[key])); paint(); };
  paint();
  return el;
}

/** Segmented choice. `options`: [[value, label], ...] */
export function seg(s, key, options, { label, help, hint, onChange } = {}) {
  const btns = options.map(([v, l]) => h("button", { type: "button", class: "seg-b", "data-v": String(v), onclick: () => { s[key] = v; paint(); onChange?.(v); } }, l));
  const paint = () => btns.forEach((b, i) => { const on = String(options[i][0]) === String(s[key]); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  const el = h("div", { class: "opt" }, label ? h("div", { class: "opt-top" }, h("label", {}, label), help ? helpButton(help) : null) : null,
    hint ? h("p", { class: "hint" }, hint) : null, h("div", { class: "seg" }, btns));
  paint();
  el.sync = paint;
  return el;
}

/** Drop-down. `options`: object value -> label. */
export function select(s, key, options, { label, help, hint, onChange } = {}) {
  const sel = h("select", { id: "d_" + key }, Object.entries(options).map(([v, l]) => h("option", { value: v }, l)));
  sel.value = String(s[key]);
  sel.addEventListener("change", () => { s[key] = typeof s[key] === "number" ? +sel.value : sel.value; onChange?.(s[key]); });
  const el = row({ label, help, hint }, h("div", { class: "selwrap" }, sel));
  el.sync = () => { sel.value = String(s[key]); };
  return el;
}

/** Colour picker for an [r,g,b] setting. */
export function color(s, key, { label, help, onChange } = {}) {
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const input = h("input", { type: "color", id: "c_" + key, value: hex(s[key]) });
  input.addEventListener("input", () => { const v = input.value; s[key] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)); onChange?.(s[key]); });
  const el = h("div", { class: "opt inline" }, h("div", { class: "opt-top" }, h("label", { for: "c_" + key }, label), help ? helpButton(help) : null, input));
  el.sync = () => { input.value = hex(s[key]); };
  return el;
}

/** A number box with unit text. */
export function number(s, key, { label, help, min, max, step = 1, unit, onChange } = {}) {
  const input = h("input", { type: "number", inputmode: "decimal", min, max, step, value: s[key], id: "n_" + key });
  input.addEventListener("change", () => { let v = parseFloat(input.value); if (Number.isNaN(v)) v = s[key]; v = Math.min(max ?? v, Math.max(min ?? v, v)); input.value = v; s[key] = v; onChange?.(v); });
  const el = row({ label, help }, h("div", { class: "numwrap" }, input, unit ? h("span", {}, unit) : null));
  el.sync = () => { input.value = s[key]; };
  return el;
}

/** Re-sync all controls under `root` after settings changed from outside (preset, loaded file). */
export function syncAll(root) { root.querySelectorAll("*").forEach((n) => n.sync && n.sync()); }

// ---- toasts ----------------------------------------------------------------------------------
let toastTimer;
export function toast(msg, { action, fn, ms } = {}) {
  const t = $("#toast"); if (!t) return;
  const hide = () => { clearTimeout(toastTimer); t.hidden = true; };
  t.replaceChildren(h("span", {}, msg), action ? h("button", { class: "chip", onclick: () => { hide(); fn?.(); } }, action) : null);
  t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, ms ?? (action ? 8000 : 3500));   // a message with a button stays a little longer, but never forever
}
