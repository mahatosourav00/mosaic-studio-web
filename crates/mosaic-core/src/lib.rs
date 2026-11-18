//! Mosaic Studio Web core: solver (CPU) and wgpu renderer, exposed to JS through wasm-bindgen.

pub mod rng;
pub mod solver;
pub mod still;
pub mod prep;
pub mod animation;
#[cfg(target_arch = "wasm32")]
mod gpu;
#[cfg(target_arch = "wasm32")]
mod render;

use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
pub use gpu::Gpu;
#[cfg(target_arch = "wasm32")]
pub use render::Renderer;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Solve a mosaic.
///
/// * `ana_rgb`   – main picture, cropped to the mosaic ratio and resized to (cols*24, rows*24), RGB8
/// * `subject`   – optional per-pixel subject map (0..1) at the same resolution (empty = none)
/// * `tile_rgb4` – T tiles, each 4x4 sRGB pixels (48 bytes), tile order = tile id
/// * `opts`      – numbers: [num_tiles, use_subtiles, subtile_percent, subtile_grid, subtile_detail,
///                 subject_weight, max_uses, min_distance, allow_flip, even_usage, tint, seed]
/// * `on_progress` – optional JS callback(fraction)
///
/// Returns a Float32Array: 6 stats numbers, then 9 floats per cell
/// `[x, y, size, tile, flip, shiftL, shifta, shiftb, w]`.
/// Stats: [violations, max_uses_raised, swaps, min_used, max_used, unused_tiles].
#[wasm_bindgen]
pub fn solve_mosaic(ana_rgb: &[u8], cols: u32, rows: u32, subject: &[f32], tile_rgb4: &[u8], opts: &[f64],
                    on_progress: Option<js_sys::Function>) -> Result<Vec<f32>, JsError> {
    if opts.len() < 12 { return Err(JsError::new("opts needs 12 numbers")); }
    let (cols, rows) = (cols as usize, rows as usize);
    let t = tile_rgb4.len() / 48;
    if t == 0 { return Err(JsError::new("No usable tile photos")); }
    if ana_rgb.len() != cols * rows * solver::ANALYSIS_PX * solver::ANALYSIS_PX * 3 {
        return Err(JsError::new("analysis image has the wrong size"));
    }
    let p = solver::Params {
        num_tiles: opts[0] as usize, use_subtiles: opts[1] > 0.5, subtile_percent: opts[2] as f32,
        subtile_grid: opts[3] as usize, subtile_detail: opts[4] > 0.5, subject_weight: opts[5] as f32,
        max_uses: opts[6] as usize, min_distance: opts[7] as f32, allow_flip: opts[8] > 0.5,
        even_usage: opts[9] as f32, tint: opts[10] as f32, seed: opts[11] as u64,
    };
    let subj = if subject.is_empty() { None } else { Some(subject) };
    let (cells, st) = solver::solve(ana_rgb, cols, rows, subj, tile_rgb4, t, &p, |f| {
        if let Some(cb) = &on_progress { let _ = cb.call1(&JsValue::NULL, &JsValue::from_f64(f as f64)); }
    });
    let mut out = Vec::with_capacity(6 + cells.len() * 9);
    out.extend_from_slice(&[st.violations as f32, st.max_uses_raised as u8 as f32, st.swaps as f32,
                            st.min_used as f32, st.max_used as f32, st.unused_tiles as f32]);
    for c in &cells {
        out.extend_from_slice(&[c.x, c.y, c.size, c.tile as f32, c.flip as u8 as f32,
                                c.shift[0], c.shift[1], c.shift[2], c.w]);
    }
    Ok(out)
}

/// grid size for a mosaic of about `n` cells whose cols*ratio/rows should match `aspect`.
#[wasm_bindgen]
pub fn grid_dims(aspect_over_ratio: f32, n: u32) -> Vec<u32> {
    let (c, r) = solver::grid_dims(aspect_over_ratio, 1.0, n as usize);
    vec![c as u32, r as u32]
}

/// Paint the finished mosaic. `cells` is the cell part of `solve_mosaic`'s output (without the 6 stats numbers);
/// `tiles` is T tiles of tile_w x tile_h RGBA. Returns RGBA pixels of size cols*round(cell_h*ratio) x rows*cell_h.
#[wasm_bindgen]
pub fn render_still(cells: &[f32], tiles: &[u8], tile_w: u32, tile_h: u32, cols: u32, rows: u32, ratio: f32,
                    cell_h: u32, gap: u32, gap_rgb: &[u8], tint: bool) -> Vec<u8> {
    let g = if gap_rgb.len() >= 3 { [gap_rgb[0], gap_rgb[1], gap_rgb[2]] } else { [0, 0, 0] };
    let p = still::StillParams { tile_w: tile_w as usize, tile_h: tile_h as usize, cols: cols as usize,
        rows: rows as usize, ratio, cell_h: cell_h as usize, gap: gap as usize, gap_rgb: g, tint };
    still::render_still(cells, tiles, &p)
}

// ---- photo preparation (all images RGBA, row-major) ----
/// Sharpness score (variance of the Laplacian). Higher = sharper.
#[wasm_bindgen]
pub fn prep_sharpness(rgba: &[u8], w: u32, h: u32) -> f32 { prep::sharpness(rgba, w as usize, h as usize) }

/// Uniform border to remove: [top, bottom, left, right] pixels.
#[wasm_bindgen]
pub fn prep_trim_borders(rgba: &[u8], w: u32, h: u32) -> Vec<u32> {
    prep::trim_borders(rgba, w as usize, h as usize, 0.3).iter().map(|&v| v as u32).collect()
}

/// Best crop [x, y, w, h] for the tile ratio; `faces` = [x, y, w, h] fractions, repeated (may be empty).
#[wasm_bindgen]
pub fn prep_smart_crop(rgba: &[u8], w: u32, h: u32, ratio: f32, faces: &[f32]) -> Vec<u32> {
    prep::smart_crop(rgba, w as usize, h as usize, ratio, faces).iter().map(|&v| v as u32).collect()
}

/// 64-bit perceptual hash as [high, low].
#[wasm_bindgen]
pub fn prep_hash(rgba: &[u8], w: u32, h: u32) -> Vec<u32> { prep::dhash(rgba, w as usize, h as usize).to_vec() }

/// Subject map (RGB input; faces as [cx, cy, w, h] fractions) resized to ow x oh.
#[wasm_bindgen]
pub fn subject_map(rgb: &[u8], w: u32, h: u32, faces: &[f32], ow: u32, oh: u32) -> Vec<f32> {
    prep::subject_map(rgb, w as usize, h as usize, faces, ow as usize, oh as usize)
}

/// Centre of a subject map as fractions [x, y].
#[wasm_bindgen]
pub fn subject_centroid(map: &[f32], w: u32, h: u32) -> Vec<f32> { prep::subject_centroid(map, w as usize, h as usize).to_vec() }
