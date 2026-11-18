//! Still-image compositor (CPU): paints every cell's tile, applying the Lab tint shift.
//! Port of `render_still` / `tinted_tile` in `mosaicvid/solver.py`. Native-testable (no wgpu).

use crate::solver::rgb_to_lab;

fn linear_to_srgb(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.0031308 { 12.92 * c } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
}

/// Lab (D65, L 0..100) -> sRGB u8.
pub fn lab_to_rgb(l: f32, a: f32, b: f32) -> [u8; 3] {
    let c = lab_to_rgb_f(l, a, b);
    [(c[0] * 255.0 + 0.5) as u8, (c[1] * 255.0 + 0.5) as u8, (c[2] * 255.0 + 0.5) as u8]
}

/// Lab -> sRGB in 0..1 (clipped).
pub fn lab_to_rgb_f(l: f32, a: f32, b: f32) -> [f32; 3] {
    let fy = (l + 16.0) / 116.0;
    let (fx, fz) = (fy + a / 500.0, fy - b / 200.0);
    let inv = |t: f32| if t * t * t > 0.008856 { t * t * t } else { (t - 16.0 / 116.0) / 7.787 };
    let (x, y, z) = (inv(fx) * 0.950456, inv(fy), inv(fz) * 1.088754);
    let r = 3.240479 * x - 1.537150 * y - 0.498535 * z;
    let g = -0.969256 * x + 1.875991 * y + 0.041556 * z;
    let bl = 0.055648 * x - 0.204043 * y + 1.057311 * z;
    [linear_to_srgb(r), linear_to_srgb(g), linear_to_srgb(bl)]
}

pub struct StillParams {
    pub tile_w: usize,
    pub tile_h: usize,
    pub cols: usize,
    pub rows: usize,
    pub ratio: f32,   // tile width / height
    pub cell_h: usize, // pixels per base-cell height
    pub gap: usize,
    pub gap_rgb: [u8; 3],
    pub tint: bool,
}

pub fn still_size(p: &StillParams) -> (usize, usize) {
    let pw = ((p.cell_h as f32 * p.ratio).round() as usize).max(1);
    (p.cols * pw, p.rows * p.cell_h)
}

/// `cells`: 9 floats per cell `[x,y,size,tile,flip,shiftL,shifta,shiftb,w]`; `tiles`: T x (tile_h x tile_w x 4) RGBA.
/// Returns RGBA, size from `still_size`.
pub fn render_still(cells: &[f32], tiles: &[u8], p: &StillParams) -> Vec<u8> {
    let (w, h) = still_size(p);
    let pw = w / p.cols;
    let ph = p.cell_h;
    let mut out = vec![0u8; w * h * 4];
    for px in out.chunks_exact_mut(4) { px[0] = p.gap_rgb[0]; px[1] = p.gap_rgb[1]; px[2] = p.gap_rgb[2]; px[3] = 255; }
    let tile_len = p.tile_w * p.tile_h * 4;
    for c in cells.chunks_exact(9) {
        let (x, y, size) = (c[0], c[1], c[2]);
        let tile = c[3] as usize;
        let flip = c[4] > 0.5;
        let g = if size >= 1.0 { p.gap } else { p.gap / 2 };
        let x0 = (x * pw as f32).round() as isize + g as isize;
        let y0 = (y * ph as f32).round() as isize + g as isize;
        let x1 = ((x + size) * pw as f32).round() as isize - g as isize;
        let y1 = ((y + size) * ph as f32).round() as isize - g as isize;
        if x1 <= x0 || y1 <= y0 || (tile + 1) * tile_len > tiles.len() { continue; }
        let (dw, dh) = ((x1 - x0) as usize, (y1 - y0) as usize);
        let src = &tiles[tile * tile_len..(tile + 1) * tile_len];
        let shift = [c[5], c[6], c[7]];
        let do_tint = p.tint && (shift[0] != 0.0 || shift[1] != 0.0 || shift[2] != 0.0);
        for dy in 0..dh {
            let sy0 = dy * p.tile_h / dh;
            let sy1 = (((dy + 1) * p.tile_h + dh - 1) / dh).clamp(sy0 + 1, p.tile_h);
            for dx in 0..dw {
                let fx = if flip { dw - 1 - dx } else { dx };
                let sx0 = fx * p.tile_w / dw;
                let sx1 = (((fx + 1) * p.tile_w + dw - 1) / dw).clamp(sx0 + 1, p.tile_w);
                let (mut r, mut gc, mut b, mut n) = (0u32, 0u32, 0u32, 0u32);
                for sy in sy0..sy1 { for sx in sx0..sx1 {
                    let i = (sy * p.tile_w + sx) * 4;
                    r += src[i] as u32; gc += src[i + 1] as u32; b += src[i + 2] as u32; n += 1;
                } }
                let mut rgb = [(r / n) as u8, (gc / n) as u8, (b / n) as u8];
                if do_tint {
                    let lab = rgb_to_lab(rgb[0], rgb[1], rgb[2]);
                    rgb = lab_to_rgb((lab[0] + shift[0]).clamp(0.0, 100.0), lab[1] + shift[1], lab[2] + shift[2]);
                }
                let o = ((y0 as usize + dy) * w + x0 as usize + dx) * 4;
                out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2];
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lab_round_trip() {
        for &(r, g, b) in &[(0u8, 0u8, 0u8), (255, 255, 255), (200, 30, 90), (12, 140, 220)] {
            let l = rgb_to_lab(r, g, b);
            let back = lab_to_rgb(l[0], l[1], l[2]);
            assert!((back[0] as i32 - r as i32).abs() <= 2 && (back[1] as i32 - g as i32).abs() <= 2
                    && (back[2] as i32 - b as i32).abs() <= 2, "{:?} -> {:?}", (r, g, b), back);
        }
    }

    #[test]
    fn paints_tile_and_gap() {
        let p = StillParams { tile_w: 2, tile_h: 2, cols: 1, rows: 1, ratio: 1.0, cell_h: 8, gap: 1, gap_rgb: [9, 9, 9], tint: false };
        let tiles: Vec<u8> = (0..4).flat_map(|_| [200u8, 10, 10, 255]).collect();
        let img = render_still(&[0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &tiles, &p);
        assert_eq!(&img[0..3], &[9, 9, 9]);                // gap corner
        let mid = (4 * 8 + 4) * 4;
        assert_eq!(&img[mid..mid + 3], &[200, 10, 10]);    // tile centre
    }
}
