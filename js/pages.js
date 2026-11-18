// Pages: home, pictures, prepare, design, create. (The video page is in video-page.js.)
import { app, go, mount, persist, steps, resetSettings, resetButton } from "./app.js";
import { h, $, card, title, row, toggle, slider, seg, select, color, number, banner, group, sheet, syncAll, toast } from "./ui.js";
import { PRESETS, SHAPES, TILE_SHAPES, EXACT_SIZES, defaults, stillPlan, repeatAdvice, maxStillPixels, isPhone, toFile, fromText } from "./settings.js";
import { buildMosaic, getPrepared } from "./mosaic.js";

const s = () => app.settings;
const pct = (v) => Math.round(v * 100) + "%";

// ------------------------------------------------------------------------------------------ home
export function home() {
  const results = app.result;
  const fileIn = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { fromText(await f.text(), s()); persist(); toast("Settings loaded."); } catch { toast("That file is not a settings file."); }
  } });
  // Settings file tools live in a small sheet instead of taking space on the home screen.
  const openSettings = () => sheet("Settings", [
    h("p", {}, "Save your options to a file, load them again later (or on another device), or put everything back to the defaults. Your photos are never stored in a settings file."),
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => { const a = h("a", { href: URL.createObjectURL(toFile(s())), download: "mosaic-settings.json" }); a.click(); } }, "Save settings file"),
      h("button", { class: "btn", onclick: () => fileIn.click() }, "Load settings file"),
      h("button", { class: "btn ghost", onclick: () => { document.querySelector(".sheet-back")?.click(); resetSettings(); } }, "Reset to defaults")),
    fileIn]);
  const content = h("div", { class: "page" },
    h("div", { class: "hero" },
      h("div", { class: "logo", html: '<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="3" y="3" width="19" height="19" rx="4" fill="#8b7cff"/><rect x="26" y="3" width="19" height="19" rx="4" fill="#4fc3f7"/><rect x="3" y="26" width="19" height="19" rx="4" fill="#4fc3f7" opacity=".7"/><rect x="26" y="26" width="19" height="19" rx="4" fill="#8b7cff" opacity=".7"/></svg>' }),
      h("h2", {}, "Turn your photos into one big picture"),
      h("p", {}, "Build a mosaic from your own photos, then watch it assemble itself. Everything stays on your device."),
      h("button", { class: "btn primary big", onclick: () => go("pictures") }, "Create a mosaic")),
    results ? card(title("Your last mosaic", `${results.width} x ${results.height} px`), h("img", { class: "thumb-wide", src: results.url, alt: "Your last mosaic" }),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => go("create") }, "Open"), steps().some(([k]) => k === "video") ? h("button", { class: "btn primary", onclick: () => go("video") }, "Make an animation") : null)) : null,
    h("p", { class: "foot" }, h("button", { class: "linkish", type: "button", onclick: openSettings }, "Settings"), " · ", h("a", { href: "#check" }, "Engine check"), " · Plugins are not in the web version yet"));
  mount(home, { title: "Mosaic Studio", step: null, content, back: null });
}

// -------------------------------------------------------------------------------------- pictures
export function pictures() {
  const pageRef = {};
  const refreshAll = () => {
    // every chosen file, minus left-out folders, and (optionally) minus sub-folder photos
    app.photos = (app.allFiles || []).filter((f) => {
      const p = (f.webkitRelativePath || "").split("/");
      if (p.length > 2 && !s().include_subfolders) return false;
      return !app.dirs.some((d) => d.off && p.slice(1, -1).join("/").startsWith(d.name));
    });
    countEl.replaceChildren(...countBanner());
    dirsBox.replaceChildren(...dirList());
    if (pageRef.nextButton) pageRef.nextButton.disabled = !(app.photos.length >= 4 && app.main);
  };
  const countBanner = () => {
    const n = app.photos.length;
    if (!n) return [];
    return [banner(n < 100 ? "warn" : n < 300 ? "ok" : "good", n < 100 ? `${n} photos. That works, but more (100+) gives a richer mosaic.` : n < 300 ? `${n} photos. Good.` : `${n} photos. Plenty!`)];
  };
  const dirList = () => {
    if (!app.dirs.length) return [];
    return [group("Folders found", [
      toggle(s(), "include_subfolders", { label: "Include photos in sub-folders", help: "subfolders", onChange: () => { persist(); refreshAll(); } }),
      ...app.dirs.map((d) => { const o = { off: d.off }; const t = toggle(o, "off", { label: `Leave out “${d.name}” (${d.count})`, onChange: (v) => { d.off = v; refreshAll(); } }); return t; }),
    ], { open: true, sub: `${app.dirs.length}` })];
  };
  const countEl = h("div", {}), dirsBox = h("div", {});
  const phIn = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: (e) => { app.allFiles = [...e.target.files]; app.dirs = []; refreshAll(); } });
  const dirIn = h("input", { type: "file", multiple: true, hidden: true, webkitdirectory: true, onchange: (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|gif|avif|heic)$/i.test(f.name));
    app.allFiles = files;
    const m = new Map();
    for (const f of files) { const p = f.webkitRelativePath.split("/"); if (p.length > 2) { const d = p.slice(1, -1).join("/"); m.set(d, (m.get(d) || 0) + 1); } }
    app.dirs = [...m].map(([name, count]) => ({ name, count, off: false }));
    refreshAll();
  } });
  const mnIn = h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => {
    app.main = e.target.files[0] || null;
    if (app.main) { if (app.mainUrl) URL.revokeObjectURL(app.mainUrl); app.mainUrl = URL.createObjectURL(app.main); }
    paintMain(); refreshAll();
  } });
  const mainBox = h("div", {});
  const paintMain = () => mainBox.replaceChildren(app.main ? h("div", { class: "pick" }, h("img", { src: app.mainUrl, alt: "Main picture" }), h("span", {}, app.main.name)) : h("p", { class: "hint" }, "No picture chosen yet."));
  const content = h("div", { class: "page" },
    card(title("Your photos", "These become the tiny tiles. Pick as many as you like."),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => phIn.click() }, "Choose photos"),
        h("button", { class: "btn", onclick: () => dirIn.click() }, "Choose a folder")), phIn, dirIn, countEl, dirsBox),
    card(title("Main picture", "The big picture your mosaic will look like. A clear subject works best."),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => mnIn.click() }, app.main ? "Choose another" : "Choose picture")), mnIn, mainBox));
  mount(pageRef, { title: "Pictures", step: "pictures", content, back: "home", next: "prepare", nextDisabled: !(app.photos.length >= 4 && app.main) });
  paintMain(); refreshAll();
}

// --------------------------------------------------------------------------------------- prepare
export function prepare() {
  const st = s();
  const dis = h("div", { class: "stack" });
  const paintDis = () => dis.classList.toggle("disabled", st.prep_skip);
  const report = h("div", {});
  const runReport = async () => {
    const btn = $("#prevBtn"), prog = $("#prevProg");
    btn.disabled = true; prog.hidden = false; prog.value = 0;
    try {
      const data = await getPrepared(app.photos, st, { thumbs: true, onProgress: (f) => { prog.value = f; } });
      showReport(data);
    } catch (e) { toast(e.name === "AbortError" ? "Cancelled." : "Could not check the photos: " + (e.message || e)); }
    finally { btn.disabled = false; prog.hidden = true; }
  };
  const content = h("div", { class: "page" },
    card(title("Photo preparation", "Cleans your photos before they become tiles. Every step has its own switch."),
      toggle(st, "prep_skip", { label: "Skip all preparation", help: "prep_skip", onChange: () => { persist(); paintDis(); } }),
      dis),
    card(title("See what will change"), h("p", { class: "hint" }, `Checks your ${app.photos.length} photos and shows which are kept, trimmed, left out or treated as duplicates.`),
      h("button", { class: "btn", id: "prevBtn", onclick: runReport, disabled: !app.photos.length }, "Preview what will change"),
      h("progress", { id: "prevProg", value: 0, max: 1, hidden: true }), report),
    h("div", { class: "row" }, resetButton(prepare)),
    h("p", { class: "foot" }, "“Fix sideways photos” is not in the web version yet. Phones already rotate photos upright."));
  dis.append(
    toggle(st, "trim_borders", { label: "Trim borders and frames", help: "prep_trim", onChange: persist }),
    toggle(st, "dedupe", { label: "Remove duplicates", help: "prep_dedupe", onChange: persist }),
    toggle(st, "filter_photos", { label: "Skip blurry and tiny photos", help: "prep_filter", onChange: persist }),
    toggle(st, "smart_crop", { label: "Smart square crop", help: "prep_crop", onChange: persist }),
    group("Advanced", [
      slider(st, "min_sharpness", { label: "Blur strictness", help: "min_sharpness", min: 2, max: 40, step: 1, onChange: persist }),
      slider(st, "min_side", { label: "Smallest photo size", help: "min_side", min: 32, max: 512, step: 16, fmt: (v) => v + " px", onChange: persist }),
    ]));
  mount(prepare, { title: "Prepare photos", step: "prepare", content, back: "pictures", next: "design" });
  paintDis();
}

function showReport(data) {
  const tabs = [["ok", "Kept", (r) => r.status === "ok"], ["trim", "Trimmed", (r) => r.trimmed && r.status === "ok"],
                ["out", "Left out", (r) => r.status === "rejected"], ["dup", "Duplicates", (r) => r.status === "duplicate"]];
  const body = h("div", {}), grid = h("div", { class: "thumbs" });
  let cur = 0;
  const bar = h("div", { class: "seg" }, tabs.map(([, label, f], i) => h("button", { class: "seg-b", onclick: () => { cur = i; paint(); } }, `${label} ${data.records.filter(f).length}`)));
  const paint = () => {
    [...bar.children].forEach((b, i) => b.classList.toggle("on", i === cur));
    const list = data.records.filter(tabs[cur][2]);
    grid.replaceChildren(...(list.length ? list.slice(0, 240).map((r) => h("figure", {}, r.thumb ? h("img", { src: r.thumb, alt: "" }) : h("div", { class: "ph" }), h("figcaption", {}, r.reason || r.name.split("/").pop()))) : [h("p", { class: "hint" }, "Nothing here.")]));
  };
  body.append(bar, grid); paint();
  sheet("What will change", body);
}

// ---------------------------------------------------------------------------------------- design
export function design() {
  const st = s();
  const dyn = h("div", { class: "stack" });          // parts that depend on other options
  const adviceBox = h("div", {});
  const refreshAdvice = () => {
    const photos = app.photos.length;
    const cells = Math.round(st.num_tiles * (st.use_subtiles ? 1 + (st.subtile_percent / 100) * (st.subtile_grid ** 2 - 1) : 1));
    const a = repeatAdvice(cells, photos);
    adviceBox.replaceChildren(...(a ? [banner(a.tone, a.text)] : []));
  };
  const detailSeg = seg(st, "num_tiles", [[800, "Rough"], [1500, "Normal"], [3000, "Fine"]], { label: "Detail", help: "detail", onChange: () => { st.preset = "custom"; persist(); syncAll(root); refreshAdvice(); } });
  const detailSlider = slider(st, "num_tiles", { label: "Exact number of tiles", min: 300, max: 6000, step: 50, onChange: (v, done) => { st.preset = "custom"; if (done) { persist(); syncAll(root); } refreshAdvice(); } });
  const presetSeg = seg(st, "preset", Object.entries(PRESETS).map(([k, v]) => [k, v.label]), { label: "Quality preset", help: "preset", onChange: (k) => {
    Object.assign(st, { num_tiles: PRESETS[k].num_tiles, cell_px: PRESETS[k].cell_px }); persist(); syncAll(root); refreshAdvice(); paintOutput();
  } });
  const colourSeg = seg(st, "tint", [[0.3, "Natural"], [0.6, "Balanced"], [0.9, "Vivid"]], { label: "Colour match", help: "colour", onChange: () => { persist(); syncAll(root); } });
  const colourSlider = slider(st, "tint", { label: "Fine-tune colour match", min: 0, max: 1, step: 0.05, fmt: pct, onChange: (v, d) => d && (persist(), syncAll(root)) });
  const out = h("div", { class: "stack" });
  const sizeNote = h("p", { class: "hint" });
  const paintOutput = () => {
    const subs = [];
    if (st.output_mode === "screen") subs.push(seg(st, "cell_px", [[32, "Small"], [64, "Standard"], [96, "Large"], [128, "Huge"]], { label: "Image sharpness", help: "size", onChange: () => { persist(); sizeLine(); } }));
    if (st.output_mode === "print") subs.push(
      h("div", { class: "two" }, number(st, "print_w", { label: "Width", min: 1, max: 500, step: 1, onChange: () => { persist(); sizeLine(); } }),
        select(st, "print_unit", { in: "inches", cm: "cm" }, { label: "Unit", onChange: () => { persist(); sizeLine(); } })),
      seg(st, "print_dpi", [[150, "150 DPI"], [300, "300 DPI"], [600, "600 DPI"]], { label: "Print quality", onChange: () => { persist(); sizeLine(); } }));
    if (st.output_mode === "exact") subs.push(
      seg(st, "exact_side", [["width", "Width"], ["height", "Height"]], { label: "Set the", onChange: () => { persist(); sizeLine(); } }),
      number(st, "exact_px", { label: "Pixels", min: 256, max: 40000, step: 100, unit: "px", onChange: () => { persist(); sizeLine(); } }),
      h("div", { class: "chips" }, EXACT_SIZES.map(([l, v]) => h("button", { class: "chip", onclick: () => { st.exact_px = v; persist(); paintOutput(); } }, l))));
    out.replaceChildren(...subs, sizeNote);
    sizeLine();
  };
  const sizeLine = () => {
    // grid shape is only known once the main picture is read: estimate from the tile count and the picture's shape
    const cols = Math.max(2, Math.round(Math.sqrt(st.num_tiles * (app.aspect || 1)))), rows = Math.max(2, Math.round(st.num_tiles / cols));
    const p = stillPlan(st, cols, rows);
    const mp = (p.width * p.height) / 1e6;
    sizeNote.textContent = `About ${p.width} x ${p.height} px (${mp.toFixed(1)} megapixels)` + (p.dpi ? ` at ${p.dpi} DPI.` : ".") +
      (p.capped ? ` This device limits the image to about ${Math.round(maxStillPixels() / 1e6)} MP, so it will be smaller.` : "");
  };
  const fmtQuality = slider(st, "image_quality", { label: "JPEG / WebP quality", help: "image_quality", min: 50, max: 100, step: 1, onChange: persist });
  const fmtSeg = seg(st, "image_format", [["png", "PNG"], ["jpg", "JPEG"], ["webp", "WebP"]], { label: "Image file type", help: "image_format", hint: "TIFF is not available in the web version.", onChange: () => { persist(); fmtQuality.hidden = st.image_format === "png"; } });
  fmtQuality.hidden = st.image_format === "png";

  const subtilePct = slider(st, "subtile_percent", { label: "How much to split", help: "subtile_percent", min: 5, max: 60, step: 5, fmt: (v) => v + "%", onChange: () => { persist(); refreshAdvice(); } });
  const subtileT = toggle(st, "use_subtiles", { label: "Extra fine detail (small tiles)", help: "subtiles", onChange: () => { persist(); subtilePct.hidden = !st.use_subtiles; refreshAdvice(); } });
  subtilePct.hidden = !st.use_subtiles;

  const preview = async () => {
    if (!app.photos.length || !app.main) { toast("Choose your photos and main picture first."); return; }
    const b = $("#pvBtn"), pr = $("#pvProg"); b.disabled = true; pr.hidden = false;
    try {
      const r = await buildMosaic({ photos: app.photos, main: app.main, settings: st, preview: true, onStage: (n, f) => { pr.value = f; } });
      app.aspect = r.cols * (st.tile_aspect.split(":")[0] / st.tile_aspect.split(":")[1]) / r.rows;
      const url = URL.createObjectURL(r.blob);
      sheet("Draft preview", [h("img", { class: "thumb-wide", src: url, alt: "Draft preview" }), h("p", { class: "hint" }, "A quick draft. The final mosaic has exactly this arrangement, just sharper.")]);
    } catch (e) { toast(e.name === "AbortError" ? "Cancelled." : (e.message || String(e))); }
    finally { b.disabled = false; pr.hidden = true; }
  };

  const root = h("div", { class: "page" },
    card(title("Quality"), presetSeg, detailSeg, group("Exact number of tiles", [detailSlider]), adviceBox),
    card(title("Shape"), select(st, "mosaic_aspect", SHAPES, { label: "Mosaic shape", help: "shape", onChange: persist })),
    card(title("Look"), colourSeg, group("Fine-tune colour", [colourSlider]),
      toggle(st, "detect_faces", { label: "Look for faces", help: "faces", hint: "Uses your browser's face detection where it exists.", onChange: persist }),
      slider(st, "subject_weight", { label: "Focus on the subject", help: "faces", min: 0, max: 1, step: 0.05, fmt: pct, onChange: persist }),
      slider(st, "main_blend", { label: "Main picture showing through", help: "blend", min: 0, max: 0.4, step: 0.01, fmt: pct, onChange: persist }),
      toggle(st, "grayscale", { label: "Black and white", help: "grayscale", onChange: persist })),
    card(title("Output"),
      toggle(st, "also_video", { label: "Also make an animation", help: "also_video", onChange: () => { persist(); } }),
      seg(st, "output_mode", [["screen", "Screen"], ["print", "Print"], ["exact", "Exact pixels"]], { label: "Output size", help: "print_size", onChange: () => { persist(); paintOutput(); } }),
      out, fmtSeg, fmtQuality),
    group("Advanced options", [
      select(st, "tile_aspect", TILE_SHAPES, { label: "Tile shape", help: "tile_shape", onChange: persist }),
      slider(st, "max_uses", { label: "Most times one photo can appear", help: "repeats", min: 0, max: 40, step: 1, off: { at: 0, text: "Auto" }, onChange: persist }),
      slider(st, "min_distance", { label: "Keep repeats apart", help: "spread", min: 0, max: 12, step: 1, onChange: persist }),
      slider(st, "even_usage", { label: "Use all photos evenly", help: "even_usage", min: 0, max: 1, step: 0.05, fmt: pct, onChange: persist }),
      toggle(st, "allow_flip", { label: "Allow mirrored photos", help: "flip", onChange: persist }),
      subtileT, subtilePct,
      slider(st, "gap_px", { label: "Gap between tiles", help: "gap", min: 0, max: 8, step: 1, fmt: (v) => v + " px", onChange: persist }),
      color(st, "gap_color", { label: "Gap colour", help: "gap_color", onChange: persist }),
      number(st, "seed", { label: "Variation number", help: "seed", min: 0, max: 99999, step: 1, onChange: persist }),
    ], { sub: "10 options" }),
    card(title("Try it first"), h("p", { class: "hint" }, "Builds a small, fast draft so you can check the arrangement and colours."),
      h("button", { class: "btn", id: "pvBtn", onclick: preview }, "Preview mosaic"), h("progress", { id: "pvProg", value: 0, max: 1, hidden: true })),
    h("div", { class: "row" }, resetButton(design)));
  mount(design, { title: "Design mosaic", step: "design", content: root, back: "prepare", next: "create" });
  paintOutput(); refreshAdvice();
}

// ---------------------------------------------------------------------------------------- create
export function create() {
  const st = s();
  const res = h("div", {});
  const summary = h("p", { class: "hint" }, `${app.photos.length} photos, about ${st.num_tiles} tiles.`);
  const prog = h("progress", { value: 0, max: 1, hidden: true }), stage = h("p", { class: "hint", role: "status" });
  const go1 = h("button", { class: "btn primary big", style: { flex: 1 } }, app.result ? "Make it again" : "Make my mosaic");
  const cancel = h("button", { class: "btn big", hidden: true }, "Cancel");
  let ctl = null, pageRef = {};
  const showResult = () => {
    const r = app.result; if (!r) return;
    const file = new File([r.blob], `mosaic.${st.image_format}`, { type: r.blob.type });
    const notes = [];
    if (r.counts?.rejected || r.counts?.duplicate) notes.push(`${r.counts.rejected} photos left out and ${r.counts.duplicate} duplicates removed.`);
    if (r.stats.violations) notes.push("Some photos had to repeat close together. Add more photos or lower “Keep repeats apart”.");
    if (r.stats.raised) notes.push("The repeat limit was raised, because there were too few photos for it.");
    if (r.capped) notes.push("The image was made smaller to fit this device.");
    res.replaceChildren(card(title("Your mosaic", `${r.width} x ${r.height} px · ${r.cols} x ${r.rows} tiles · ${(r.blob.size / 1e6).toFixed(1)} MB`),
      h("img", { class: "thumb-wide", src: r.url, alt: "Finished mosaic" }), ...notes.map((n) => h("p", { class: "hint" }, n)),
      h("div", { class: "row" }, h("a", { class: "btn primary", href: r.url, download: file.name }, "Save image"),
        navigator.canShare?.({ files: [file] }) ? h("button", { class: "btn", onclick: () => navigator.share({ files: [file] }).catch(() => {}) }, "Share") : null)));
    if (pageRef.nextButton) pageRef.nextButton.disabled = false;
  };
  go1.onclick = async () => {
    ctl = new AbortController();
    go1.disabled = true; cancel.hidden = false; prog.hidden = false; res.replaceChildren();
    stage.textContent = "Getting ready…"; prog.removeAttribute("value");     // moving "working" bar until real progress arrives
    let wake = null, finished = false; navigator.wakeLock?.request("screen").then((l) => { if (finished) l.release(); else wake = l; }, () => {});   // do not wait for it
    try {
      const r = await buildMosaic({ photos: app.photos, main: app.main, settings: st, signal: ctl.signal, onStage: (n, f, d) => { stage.textContent = d ? `${n} (${d})` : n; if (f > 0) prog.value = f; else prog.removeAttribute("value"); } });
      if (app.result) URL.revokeObjectURL(app.result.url);
      app.result = { ...r, url: URL.createObjectURL(r.blob) };
      app.aspect = (r.cols * (st.tile_aspect.split(":")[0] / st.tile_aspect.split(":")[1])) / r.rows;
      stage.textContent = "Done."; showResult();
    } catch (e) { stage.textContent = e.name === "AbortError" ? "Cancelled." : "Something went wrong: " + (e.message || e); }
    finally { finished = true; wake?.release?.(); go1.disabled = false; cancel.hidden = true; prog.hidden = true; }
  };
  cancel.onclick = () => ctl?.abort();
  const content = h("div", { class: "page" },
    card(title("Ready to build"), summary, prog, stage, h("div", { class: "row" }, go1, cancel)), res);
  const next = st.also_video ? "video" : "home";
  mount(pageRef, { title: "Create", step: "create", content, back: "design", next, nextLabel: st.also_video ? "Make the animation" : "Finish", nextDisabled: !app.result });
  showResult();
}
