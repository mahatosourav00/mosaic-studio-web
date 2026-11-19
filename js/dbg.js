// ?debug helpers: a timeline of marks (seconds since the button was pressed) and the small green report box.
// Everything here does nothing unless the address has ?debug.
export const DEBUG = /[?&]debug(&|=|$)/.test(location.search);

let t0 = 0, marks = [];
/** Record "name happened now". Pass reset=true on the button press to start a new timeline. */
export function mark(name, reset = false) {
  if (!DEBUG) return;
  const t = performance.now();
  if (reset) { t0 = t; marks = []; }
  marks.push(`${((t - t0) / 1000).toFixed(1)}s ${name}`);
}
export const timeline = () => "timeline: " + marks.join(" > ");

const sections = {};
/** Show/replace one named section of the green box (tap the box to close it). */
export function showDebug(key, lines) {
  if (!DEBUG) return;
  sections[key] = lines.join("\n");
  console.log(sections[key]);
  let box = document.getElementById("debug-timing");
  if (!box) {
    box = document.createElement("pre"); box.id = "debug-timing";
    box.style.cssText = "position:fixed;left:4px;right:4px;bottom:4px;z-index:99999;margin:0;padding:8px;max-height:45vh;overflow:auto;background:#000c;color:#9f9;font:11px/1.4 monospace;white-space:pre-wrap;border-radius:6px";
    box.onclick = () => box.remove(); document.body.append(box);
  }
  box.textContent = Object.values(sections).join("\n") + "\n(tap to close)";
}
