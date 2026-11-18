// Shared app state, navigation and the page shell (top bar, progress rail, bottom action bar).
import { loadSaved, save, defaults } from "./settings.js";
import { $, h, toast } from "./ui.js";

export const app = {
  photos: [],          // File[] chosen as tiles
  main: null,          // File (main picture)
  settings: loadSaved(),
  result: null,        // last finished mosaic { blob, url, scene, ... }
  dirs: [],            // sub-folder names found in a chosen folder: { name, count, off }
};
export const persist = () => save(app.settings);

/** Put every option back to its default (with an Undo), then redraw the current page with `rerender`. */
export function resetSettings(rerender) {
  const before = { ...app.settings };
  Object.assign(app.settings, defaults());
  persist();
  toast("All settings are back to the defaults.", { action: "Undo", fn: () => { Object.assign(app.settings, before); persist(); toast("Your settings are restored."); rerender?.(); } });
  rerender?.();
}
/** A "Reset to defaults" button for the bottom of a settings page. */
export const resetButton = (rerender) => h("button", { class: "btn ghost", type: "button", onclick: () => resetSettings(rerender) }, "Reset to defaults");

export const go = (name) => { location.hash = name === "home" ? "" : name; };

const STEPS = [["pictures", "Pictures"], ["prepare", "Prepare"], ["design", "Design"], ["create", "Create"], ["video", "Video"]];
export const steps = () => STEPS.filter(([k]) => k !== "video" || app.settings.also_video);

const view = () => $("#view"), rail = () => $("#rail"), bar = () => $("#bar"), titleEl = () => $("#title"), back = () => $("#back");

/** Set up the chrome for a page and mount its content. */
export function mount(page, { title, step, content, back: backTo, next, nextLabel = "Next", nextDisabled = false, onNext, hideBar = false }) {
  titleEl().textContent = title;
  back().hidden = !backTo;
  back().onclick = () => go(backTo);
  const list = steps();
  rail().hidden = step == null;
  if (step != null) {
    const idx = Math.max(0, list.findIndex(([k]) => k === step));
    rail().replaceChildren(...list.map(([k, label], i) => h("button", { class: "step" + (i === idx ? " on" : i < idx ? " done" : ""), disabled: i > idx + 1 && !app.result,
      onclick: () => go(k), "aria-current": i === idx ? "step" : null }, h("i", {}, i < idx ? "✓" : String(i + 1)), h("span", {}, label))));
  }
  view().replaceChildren(content);
  view().scrollTop = 0;
  const b = bar();
  b.hidden = hideBar || !next;
  if (!b.hidden) {
    const nb = h("button", { class: "btn primary big", disabled: nextDisabled, onclick: () => { onNext ? onNext() : go(next); } }, nextLabel);
    b.replaceChildren(backTo ? h("button", { class: "btn big ghost", onclick: () => go(backTo) }, "Back") : null, nb);
    page.nextButton = nb;
  }
  document.body.classList.toggle("has-bar", !b.hidden);
}
