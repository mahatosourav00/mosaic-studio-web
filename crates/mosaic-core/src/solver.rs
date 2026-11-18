//! Mosaic solver: layout (cells + subtiles) -> tile assignment. Port of `mosaicvid/solver.py`.
//! Pure Rust (no wgpu / wasm types) so it is unit-testable on any target.

use crate::rng::Rng;

pub const ANALYSIS_PX: usize = 24; // analysis pixels per base cell
pub const PATCH: usize = 4; // matching patch is PATCH x PATCH Lab samples
pub const DIM: usize = PATCH * PATCH * 3;

#[derive(Clone, Debug)]
pub struct Cell {
    pub x: f32,
    pub y: f32,
    pub size: f32,
    pub tile: i32,
    pub flip: bool,
    pub shift: [f32; 3],
    pub w: f32,
}

impl Cell {
    pub fn cx(&self) -> f32 { self.x + self.size / 2.0 }
    pub fn cy(&self) -> f32 { self.y + self.size / 2.0 }
}

#[derive(Clone, Debug)]
pub struct Params {
    pub num_tiles: usize,
    pub use_subtiles: bool,
    pub subtile_percent: f32,
    pub subtile_grid: usize,
    pub subtile_detail: bool, // true = "detail", false = "random"
    pub subject_weight: f32,
    pub max_uses: usize, // 0 = auto
    pub min_distance: f32,
    pub allow_flip: bool,
    pub even_usage: f32,
    pub tint: f32,
    pub seed: u64,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            num_tiles: 1500, use_subtiles: false, subtile_percent: 20.0, subtile_grid: 2,
            subtile_detail: true, subject_weight: 0.6, max_uses: 0, min_distance: 6.0,
            allow_flip: true, even_usage: 0.5, tint: 0.5, seed: 42,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub violations: usize,
    pub max_uses_raised: bool,
    pub swaps: usize,
    pub min_used: i32,
    pub max_used: i32,
    pub unused_tiles: usize,
}

// ------------------------------------------------------------------ colour
fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

/// sRGB u8 -> Lab (D65), L in 0..100 (same convention as OpenCV float RGB2LAB).
pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> [f32; 3] {
    let (r, g, b) = (srgb_to_linear(r as f32 / 255.0), srgb_to_linear(g as f32 / 255.0), srgb_to_linear(b as f32 / 255.0));
    let x = (0.412453 * r + 0.357580 * g + 0.180423 * b) / 0.950456;
    let y = 0.212671 * r + 0.715160 * g + 0.072169 * b;
    let z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / 1.088754;
    let f = |t: f32| if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

// ------------------------------------------------------------------ layout
pub fn grid_dims(w: f32, h: f32, n: usize) -> (usize, usize) {
    let cols = ((n as f32 * w / h).sqrt().round() as usize).max(2);
    let rows = ((n as f32 / cols as f32).round() as usize).max(2);
    (cols, rows)
}

/// Lab image of the analysis resolution (cols*24 x rows*24), row-major, 3 floats per pixel.
pub struct Analysis {
    pub w: usize,
    pub h: usize,
    pub lab: Vec<f32>,
}

impl Analysis {
    pub fn from_rgb(rgb: &[u8], w: usize, h: usize) -> Analysis {
        let mut lab = Vec::with_capacity(w * h * 3);
        for p in rgb.chunks_exact(3).take(w * h) {
            lab.extend_from_slice(&rgb_to_lab(p[0], p[1], p[2]));
        }
        Analysis { w, h, lab }
    }

    fn bounds(x0: f32, y0: f32, size: f32) -> (usize, usize, usize, usize) {
        let a = ANALYSIS_PX as f32;
        let xs = (x0 * a).round() as usize;
        let xe = (((x0 + size) * a).round() as usize).max(xs + 1);
        let ys = (y0 * a).round() as usize;
        let ye = (((y0 + size) * a).round() as usize).max(ys + 1);
        (xs, xe, ys, ye)
    }

    /// PATCH x PATCH area-averaged Lab patch of a region (in base-cell units), flattened to DIM floats.
    pub fn patch(&self, x0: f32, y0: f32, size: f32) -> [f32; DIM] {
        let (xs, xe, ys, ye) = Self::bounds(x0, y0, size);
        let (xe, ye) = (xe.min(self.w), ye.min(self.h));
        let (xs, ys) = (xs.min(xe.saturating_sub(1)), ys.min(ye.saturating_sub(1)));
        let (rw, rh) = (xe - xs, ye - ys);
        let mut out = [0f32; DIM];
        for py in 0..PATCH {
            let (by0, by1) = (ys + py * rh / PATCH, ys + ((py + 1) * rh / PATCH).max(py * rh / PATCH + 1));
            for px in 0..PATCH {
                let (bx0, bx1) = (xs + px * rw / PATCH, xs + ((px + 1) * rw / PATCH).max(px * rw / PATCH + 1));
                let mut acc = [0f32; 3];
                let mut n = 0f32;
                for y in by0..by1.min(ye) {
                    for x in bx0..bx1.min(xe) {
                        let i = (y * self.w + x) * 3;
                        acc[0] += self.lab[i]; acc[1] += self.lab[i + 1]; acc[2] += self.lab[i + 2];
                        n += 1.0;
                    }
                }
                let n = n.max(1.0);
                let o = (py * PATCH + px) * 3;
                out[o] = acc[0] / n; out[o + 1] = acc[1] / n; out[o + 2] = acc[2] / n;
            }
        }
        out
    }

    fn luma_std(&self, x: usize, y: usize) -> f32 {
        let a = ANALYSIS_PX;
        let (mut s, mut s2, mut n) = (0f64, 0f64, 0f64);
        for yy in y * a..((y + 1) * a).min(self.h) {
            for xx in x * a..((x + 1) * a).min(self.w) {
                let l = self.lab[(yy * self.w + xx) * 3] as f64;
                s += l; s2 += l * l; n += 1.0;
            }
        }
        if n == 0.0 { return 0.0; }
        let m = s / n;
        ((s2 / n - m * m).max(0.0)).sqrt() as f32
    }
}

/// Mean of a single-channel analysis-resolution map over a region.
pub fn region_mean(m: &[f32], mw: usize, mh: usize, x0: f32, y0: f32, size: f32) -> f32 {
    let (xs, xe, ys, ye) = Analysis::bounds(x0, y0, size);
    let (xe, ye) = (xe.min(mw), ye.min(mh));
    let (xs, ys) = (xs.min(xe.saturating_sub(1)), ys.min(ye.saturating_sub(1)));
    let mut s = 0f32;
    let mut n = 0f32;
    for y in ys..ye { for x in xs..xe { s += m[y * mw + x]; n += 1.0; } }
    if n == 0.0 { 0.0 } else { s / n }
}

pub fn build_cells(cols: usize, rows: usize, ana: &Analysis, p: &Params, rng: &mut Rng,
                   subject: Option<&[f32]>) -> Vec<Cell> {
    let base: Vec<(usize, usize)> = (0..rows).flat_map(|y| (0..cols).map(move |x| (x, y))).collect();
    let mut split = vec![false; base.len()];
    if p.use_subtiles && p.subtile_percent > 0.0 {
        let m = (base.len() as f32 * p.subtile_percent.min(100.0) / 100.0).round() as usize;
        if p.subtile_detail {
            let detail: Vec<f32> = base.iter().map(|&(x, y)| ana.luma_std(x, y)).collect();
            let dmax = detail.iter().cloned().fold(0f32, f32::max) + 1e-6;
            let mut score: Vec<f32> = detail.iter().map(|d| d / dmax).collect();
            if let (Some(sm), true) = (subject, p.subject_weight > 0.0) {
                for (i, &(x, y)) in base.iter().enumerate() {
                    let wb = region_mean(sm, ana.w, ana.h, x as f32, y as f32, 1.0);
                    score[i] = (1.0 - 0.5 * p.subject_weight) * score[i] + 1.5 * p.subject_weight * wb;
                }
            }
            let mut idx: Vec<usize> = (0..base.len()).collect();
            idx.sort_by(|&a, &b| score[b].partial_cmp(&score[a]).unwrap_or(std::cmp::Ordering::Equal));
            for &i in idx.iter().take(m) { split[i] = true; }
        } else {
            let mut idx: Vec<usize> = (0..base.len()).collect();
            rng.shuffle(&mut idx);
            for &i in idx.iter().take(m) { split[i] = true; }
        }
    }
    let k = p.subtile_grid.max(2);
    let mut cells = Vec::with_capacity(base.len());
    for (i, &(x, y)) in base.iter().enumerate() {
        if split[i] {
            for sy in 0..k { for sx in 0..k {
                cells.push(Cell { x: x as f32 + sx as f32 / k as f32, y: y as f32 + sy as f32 / k as f32,
                                  size: 1.0 / k as f32, tile: -1, flip: false, shift: [0.0; 3], w: 0.0 });
            } }
        } else {
            cells.push(Cell { x: x as f32, y: y as f32, size: 1.0, tile: -1, flip: false, shift: [0.0; 3], w: 0.0 });
        }
    }
    cells
}

// ---------------------------------------------------------------- matching
/// Tile features: `rgb4` holds T tiles of PATCH*PATCH sRGB pixels (u8). Returns (T, 2, DIM): normal + h-flipped Lab.
pub fn tile_features(rgb4: &[u8], t: usize) -> Vec<f32> {
    let mut out = vec![0f32; t * 2 * DIM];
    for i in 0..t {
        let px = &rgb4[i * PATCH * PATCH * 3..(i + 1) * PATCH * PATCH * 3];
        for y in 0..PATCH {
            for x in 0..PATCH {
                let s = (y * PATCH + x) * 3;
                let lab = rgb_to_lab(px[s], px[s + 1], px[s + 2]);
                let a = (i * 2) * DIM + (y * PATCH + x) * 3;
                let b = (i * 2 + 1) * DIM + (y * PATCH + (PATCH - 1 - x)) * 3;
                out[a..a + 3].copy_from_slice(&lab);
                out[b..b + 3].copy_from_slice(&lab);
            }
        }
    }
    out
}

fn dist2(a: &[f32], b: &[f32]) -> f32 {
    let mut s = 0f32;
    for i in 0..DIM { let d = a[i] - b[i]; s += d * d; }
    s
}

/// Greedy assignment + swap refinement (see `solver.assign`).
pub fn assign(cells: &mut [Cell], target: &[[f32; DIM]], feats: &[f32], t: usize, p: &Params, rng: &mut Rng,
              mut progress: impl FnMut(f32)) -> Stats {
    let c = cells.len();
    // cost (C,T) = min over flip, plus which flip won
    let mut cost = vec![0f32; c * t];
    let mut best_flip = vec![false; c * t];
    for ci in 0..c {
        for ti in 0..t {
            let d0 = dist2(&target[ci], &feats[(ti * 2) * DIM..(ti * 2 + 1) * DIM]);
            let (d, f) = if p.allow_flip {
                let d1 = dist2(&target[ci], &feats[(ti * 2 + 1) * DIM..(ti * 2 + 2) * DIM]);
                if d1 < d0 { (d1, true) } else { (d0, false) }
            } else { (d0, false) };
            cost[ci * t + ti] = d;
            best_flip[ci * t + ti] = f;
        }
        if ci % 64 == 0 { progress(0.3 * ci as f32 / c as f32); }
    }

    let natural = (c + t - 1) / t;
    let mut max_uses = if p.max_uses > 0 { p.max_uses } else { usize::MAX / 2 };
    let mut raised = false;
    if max_uses.saturating_mul(t) < c { max_uses = natural; raised = true; }
    // median of per-cell min cost
    let mut mins: Vec<f32> = (0..c).map(|ci| cost[ci * t..(ci + 1) * t].iter().cloned().fold(f32::INFINITY, f32::min)).collect();
    mins.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let scale = mins[mins.len() / 2] + 1e-6;
    let pen = p.even_usage * scale;

    let mut uses = vec![0i32; t];
    let mut pos: Vec<Vec<(f32, f32)>> = vec![Vec::new(); t];
    let d2 = p.min_distance * p.min_distance;
    let mut violations = 0usize;

    let ok = |pos: &Vec<Vec<(f32, f32)>>, ti: usize, cx: f32, cy: f32, skip: Option<(f32, f32)>| -> bool {
        if d2 <= 0.0 { return true; }
        for &(px, py) in &pos[ti] {
            if Some((px, py)) == skip { continue; }
            if (px - cx).powi(2) + (py - cy).powi(2) < d2 { return false; }
        }
        true
    };

    let mut order_cells: Vec<usize> = (0..c).collect();
    if p.subject_weight > 0.0 {
        let keys: Vec<f32> = (0..c).map(|i| -(p.subject_weight * cells[i].w + 0.15 * rng.f32())).collect();
        order_cells.sort_by(|&a, &b| keys[a].partial_cmp(&keys[b]).unwrap());
    } else {
        rng.shuffle(&mut order_cells);
    }
    let mut order: Vec<usize> = (0..t).collect();
    for (n, &ci) in order_cells.iter().enumerate() {
        let (cx, cy) = (cells[ci].cx(), cells[ci].cy());
        let adj: Vec<f32> = (0..t).map(|ti| cost[ci * t + ti] + pen * uses[ti] as f32).collect();
        for (i, o) in order.iter_mut().enumerate() { *o = i; }
        order.sort_by(|&a, &b| adj[a].partial_cmp(&adj[b]).unwrap_or(std::cmp::Ordering::Equal));
        let mut chosen: Option<usize> = None;
        for &ti in &order {
            if (uses[ti] as usize) < max_uses && ok(&pos, ti, cx, cy, None) { chosen = Some(ti); break; }
        }
        if chosen.is_none() {
            for &ti in &order {
                if (uses[ti] as usize) < max_uses { chosen = Some(ti); violations += 1; break; }
            }
        }
        let ti = chosen.unwrap_or(order[0]);
        cells[ci].tile = ti as i32;
        cells[ci].flip = best_flip[ci * t + ti];
        uses[ti] += 1;
        pos[ti].push((cx, cy));
        if n % 64 == 0 { progress(0.3 + 0.4 * n as f32 / c as f32); }
    }

    // swap refinement: lowers matching error, keeps usage counts, respects distance
    let iters = (30 * c).min(300_000);
    let mut swaps = 0usize;
    for it in 0..iters {
        let a = rng.below(c);
        let b = rng.below(c);
        if a == b { continue; }
        let (ta, tb) = (cells[a].tile as usize, cells[b].tile as usize);
        if ta == tb { continue; }
        if cost[a * t + tb] + cost[b * t + ta] >= cost[a * t + ta] + cost[b * t + tb] - 1e-6 { continue; }
        let (ca, cb) = ((cells[a].cx(), cells[a].cy()), (cells[b].cx(), cells[b].cy()));
        if !(ok(&pos, tb, ca.0, ca.1, Some(cb)) && ok(&pos, ta, cb.0, cb.1, Some(ca))) { continue; }
        if let Some(i) = pos[ta].iter().position(|&q| q == ca) { pos[ta].swap_remove(i); }
        if let Some(i) = pos[tb].iter().position(|&q| q == cb) { pos[tb].swap_remove(i); }
        pos[ta].push(cb);
        pos[tb].push(ca);
        cells[a].tile = tb as i32;
        cells[b].tile = ta as i32;
        cells[a].flip = best_flip[a * t + tb];
        cells[b].flip = best_flip[b * t + ta];
        swaps += 1;
        if it % 20_000 == 0 { progress(0.7 + 0.3 * it as f32 / iters as f32); }
    }
    progress(1.0);

    Stats {
        violations, max_uses_raised: raised, swaps,
        min_used: *uses.iter().min().unwrap_or(&0), max_used: *uses.iter().max().unwrap_or(&0),
        unused_tiles: uses.iter().filter(|&&u| u == 0).count(),
    }
}

/// Full solve. `ana_rgb` is the main picture already cropped and resized to (cols*24, rows*24).
/// `subject` is an optional analysis-resolution map in 0..1. Returns (cells, stats).
pub fn solve(ana_rgb: &[u8], cols: usize, rows: usize, subject: Option<&[f32]>, tile_rgb4: &[u8], t: usize,
             p: &Params, progress: impl FnMut(f32)) -> (Vec<Cell>, Stats) {
    let mut rng = Rng::new(p.seed);
    let ana = Analysis::from_rgb(ana_rgb, cols * ANALYSIS_PX, rows * ANALYSIS_PX);
    let subj = if p.subject_weight > 0.0 { subject } else { None };
    let mut cells = build_cells(cols, rows, &ana, p, &mut rng, subj);
    if let Some(sm) = subj {
        for c in cells.iter_mut() { c.w = region_mean(sm, ana.w, ana.h, c.x, c.y, c.size); }
    }
    let target: Vec<[f32; DIM]> = cells.iter().map(|c| ana.patch(c.x, c.y, c.size)).collect();
    let feats = tile_features(tile_rgb4, t);
    let stats = assign(&mut cells, &target, &feats, t, p, &mut rng, progress);

    // tint: Lab shift moving each tile's mean toward its cell's mean (stronger on the subject)
    for (c, tg) in cells.iter_mut().zip(target.iter()) {
        let ti = c.tile as usize;
        let mut tm = [0f32; 3];
        let mut sm = [0f32; 3];
        for k in 0..PATCH * PATCH {
            for ch in 0..3 {
                tm[ch] += tg[k * 3 + ch] / (PATCH * PATCH) as f32;
                sm[ch] += feats[(ti * 2) * DIM + k * 3 + ch] / (PATCH * PATCH) as f32;
            }
        }
        let t_eff = p.tint + (1.0 - p.tint) * 0.6 * p.subject_weight * c.w;
        for ch in 0..3 { c.shift[ch] = (tm[ch] - sm[ch]) * t_eff; }
    }
    (cells, stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic(cols: usize, rows: usize, t: usize) -> (Vec<u8>, Vec<u8>) {
        let (w, h) = (cols * ANALYSIS_PX, rows * ANALYSIS_PX);
        let mut main = vec![0u8; w * h * 3];
        for y in 0..h { for x in 0..w {
            let i = (y * w + x) * 3;
            main[i] = (x * 255 / w) as u8; main[i + 1] = (y * 255 / h) as u8; main[i + 2] = 128;
        } }
        let mut rng = Rng::new(1);
        let tiles: Vec<u8> = (0..t * PATCH * PATCH * 3).map(|_| (rng.f32() * 255.0) as u8).collect();
        (main, tiles)
    }

    #[test]
    fn lab_reference_values() {
        let w = rgb_to_lab(255, 255, 255);
        assert!((w[0] - 100.0).abs() < 0.1 && w[1].abs() < 0.2 && w[2].abs() < 0.3, "{:?}", w);
        let r = rgb_to_lab(255, 0, 0); // OpenCV: ~(53.2, 80.1, 67.2)
        assert!((r[0] - 53.2).abs() < 0.5 && (r[1] - 80.1).abs() < 1.0 && (r[2] - 67.2).abs() < 1.0, "{:?}", r);
    }

    #[test]
    fn grid_dims_matches_python() {
        assert_eq!(grid_dims(1.0, 1.0, 1500), (39, 38)); // round(sqrt(1500))=39, round(1500/39)=38
        assert_eq!(grid_dims(9.0, 16.0, 3000).0, 41);
    }

    #[test]
    fn constraints_hold() {
        let (cols, rows, t) = (16, 16, 60);
        let (main, tiles) = synthetic(cols, rows, t);
        let p = Params { max_uses: 6, min_distance: 3.0, ..Params::default() };
        let (cells, stats) = solve(&main, cols, rows, None, &tiles, t, &p, |_| {});
        assert_eq!(cells.len(), cols * rows);
        let mut uses = vec![0usize; t];
        for c in &cells { assert!(c.tile >= 0); uses[c.tile as usize] += 1; }
        assert!(uses.iter().all(|&u| u <= 6));
        assert_eq!(stats.violations, 0);
        for ti in 0..t {
            let ps: Vec<_> = cells.iter().filter(|c| c.tile as usize == ti).collect();
            for i in 0..ps.len() { for j in i + 1..ps.len() {
                let d = (ps[i].cx() - ps[j].cx()).powi(2) + (ps[i].cy() - ps[j].cy()).powi(2);
                assert!(d >= 9.0 - 1e-3, "tile {} too close", ti);
            } }
        }
    }

    #[test]
    fn subtiles_split_requested_share() {
        let (cols, rows, t) = (10, 10, 40);
        let (main, tiles) = synthetic(cols, rows, t);
        let p = Params { use_subtiles: true, subtile_percent: 20.0, min_distance: 0.0, ..Params::default() };
        let (cells, _) = solve(&main, cols, rows, None, &tiles, t, &p, |_| {});
        assert_eq!(cells.len(), 80 + 20 * 4);
    }

    #[test]
    fn deterministic_for_a_seed() {
        let (cols, rows, t) = (8, 8, 30);
        let (main, tiles) = synthetic(cols, rows, t);
        let p = Params::default();
        let a = solve(&main, cols, rows, None, &tiles, t, &p, |_| {}).0;
        let b = solve(&main, cols, rows, None, &tiles, t, &p, |_| {}).0;
        assert!(a.iter().zip(b.iter()).all(|(x, y)| x.tile == y.tile && x.flip == y.flip));
    }
}
