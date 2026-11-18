//! Photo preparation and subject map. Port of `mosaicvid/preprocess.py` (border trim, sharpness, smart crop,
//! near-duplicate hash) and `mosaicvid/subject.py`. Pure Rust, native-testable.
//! Images are RGBA u8, row-major.

fn gray_of(rgba: &[u8], w: usize, h: usize) -> Vec<f32> {
    (0..w * h).map(|i| 0.299 * rgba[i * 4] as f32 + 0.587 * rgba[i * 4 + 1] as f32 + 0.114 * rgba[i * 4 + 2] as f32).collect()
}

/// Area-average downscale of a single-channel image so the long side is at most `max_side`.
fn down(g: &[f32], w: usize, h: usize, max_side: usize) -> (Vec<f32>, usize, usize) {
    let m = w.max(h);
    if m <= max_side { return (g.to_vec(), w, h); }
    let s = max_side as f32 / m as f32;
    let (nw, nh) = (((w as f32 * s) as usize).max(1), ((h as f32 * s) as usize).max(1));
    resize_area(g, w, h, nw, nh)
}

fn resize_area(g: &[f32], w: usize, h: usize, nw: usize, nh: usize) -> (Vec<f32>, usize, usize) {
    let mut o = vec![0f32; nw * nh];
    for y in 0..nh {
        let (y0, y1) = (y * h / nh, ((y + 1) * h / nh).max(y * h / nh + 1).min(h));
        for x in 0..nw {
            let (x0, x1) = (x * w / nw, ((x + 1) * w / nw).max(x * w / nw + 1).min(w));
            let mut a = 0f32;
            for yy in y0..y1 { for xx in x0..x1 { a += g[yy * w + xx]; } }
            o[y * nw + x] = a / ((y1 - y0) * (x1 - x0)) as f32;
        }
    }
    (o, nw, nh)
}

fn gaussian(g: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    let r = (sigma * 3.0).ceil().max(1.0) as isize;
    let k: Vec<f32> = (-r..=r).map(|i| (-((i * i) as f32) / (2.0 * sigma * sigma)).exp()).collect();
    let ks: f32 = k.iter().sum();
    let mut tmp = vec![0f32; w * h];
    for y in 0..h { for x in 0..w {
        let mut a = 0f32;
        for (i, kv) in k.iter().enumerate() { a += g[y * w + (x as isize + i as isize - r).clamp(0, w as isize - 1) as usize] * kv; }
        tmp[y * w + x] = a / ks;
    } }
    let mut out = vec![0f32; w * h];
    for y in 0..h { for x in 0..w {
        let mut a = 0f32;
        for (i, kv) in k.iter().enumerate() { a += tmp[(y as isize + i as isize - r).clamp(0, h as isize - 1) as usize * w + x] * kv; }
        out[y * w + x] = a / ks;
    } }
    out
}

fn at(g: &[f32], w: usize, h: usize, x: isize, y: isize) -> f32 { g[y.clamp(0, h as isize - 1) as usize * w + x.clamp(0, w as isize - 1) as usize] }

/// |Sobel x| + |Sobel y|
fn sobel_abs(g: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut o = vec![0f32; w * h];
    for y in 0..h as isize { for x in 0..w as isize {
        let a = |dx: isize, dy: isize| at(g, w, h, x + dx, y + dy);
        let gx = (a(1, -1) + 2.0 * a(1, 0) + a(1, 1)) - (a(-1, -1) + 2.0 * a(-1, 0) + a(-1, 1));
        let gy = (a(-1, 1) + 2.0 * a(0, 1) + a(1, 1)) - (a(-1, -1) + 2.0 * a(0, -1) + a(1, -1));
        o[y as usize * w + x as usize] = gx.abs() + gy.abs();
    } }
    o
}

/// Variance of the Laplacian (higher = sharper). Same measure as the desktop app; computed at <= 512 px.
pub fn sharpness(rgba: &[u8], w: usize, h: usize) -> f32 {
    let (g, w, h) = down(&gray_of(rgba, w, h), w, h, 512);
    if w < 3 || h < 3 { return 0.0; }
    let mut vals = Vec::with_capacity(w * h);
    for y in 0..h as isize { for x in 0..w as isize {
        vals.push((at(&g, w, h, x - 1, y) + at(&g, w, h, x + 1, y) + at(&g, w, h, x, y - 1) + at(&g, w, h, x, y + 1) - 4.0 * at(&g, w, h, x, y)) as f64);
    } }
    let n = vals.len() as f64;
    let m = vals.iter().sum::<f64>() / n;
    (vals.iter().map(|v| (v - m) * (v - m)).sum::<f64>() / n) as f32
}

// ------------------------------------------------------------------ borders
fn trim_side(std: &[f32], mean: &[[f32; 3]], limit: usize) -> usize {
    let (mut std_thr, mut color_tol, jump_min) = (7.0f32, 14.0f32, 18.0f32);
    let r = mean[0];
    let rmin = r[0].min(r[1]).min(r[2]);
    let rmax = r[0].max(r[1]).max(r[2]);
    let pure = rmin >= 250.0 || rmax <= 5.0;
    let mut limit = limit;
    if pure { std_thr = 2.5; color_tol = 5.0; limit = limit.min((std.len() as f32 * 0.12) as usize); }
    let dmax = |a: [f32; 3], b: [f32; 3]| (a[0] - b[0]).abs().max((a[1] - b[1]).abs()).max((a[2] - b[2]).abs());
    let mut k = 0;
    while k < limit && std[k] < std_thr && dmax(mean[k], r) < color_tol { k += 1; }
    if k == 0 || k >= limit { return 0; }
    let exempt = pure && (k as f32) <= std.len() as f32 * 0.06;
    if !exempt && dmax(mean[k], mean[k - 1]) < jump_min { return 0; }
    k
}

/// Pixels of uniform border to remove: [top, bottom, left, right] (0 = keep everything).
pub fn trim_borders(rgba: &[u8], w: usize, h: usize, max_frac: f32) -> [usize; 4] {
    let (mut rs, mut rm) = (vec![0f32; h], vec![[0f32; 3]; h]);
    let (mut cs, mut cm) = (vec![0f32; w], vec![[0f32; 3]; w]);
    for y in 0..h {
        let (mut s, mut s2) = ([0f64; 3], [0f64; 3]);
        for x in 0..w { for c in 0..3 { let v = rgba[(y * w + x) * 4 + c] as f64; s[c] += v; s2[c] += v * v; } }
        let mut mx = 0f32;
        for c in 0..3 { let m = s[c] / w as f64; rm[y][c] = m as f32; mx = mx.max(((s2[c] / w as f64 - m * m).max(0.0)).sqrt() as f32); }
        rs[y] = mx;
    }
    for x in 0..w {
        let (mut s, mut s2) = ([0f64; 3], [0f64; 3]);
        for y in 0..h { for c in 0..3 { let v = rgba[(y * w + x) * 4 + c] as f64; s[c] += v; s2[c] += v * v; } }
        let mut mx = 0f32;
        for c in 0..3 { let m = s[c] / h as f64; cm[x][c] = m as f32; mx = mx.max(((s2[c] / h as f64 - m * m).max(0.0)).sqrt() as f32); }
        cs[x] = mx;
    }
    let (lim_h, lim_w) = ((h as f32 * max_frac) as usize, (w as f32 * max_frac) as usize);
    let rev = |v: &[f32]| v.iter().rev().cloned().collect::<Vec<f32>>();
    let revm = |v: &[[f32; 3]]| v.iter().rev().cloned().collect::<Vec<[f32; 3]>>();
    let top = trim_side(&rs, &rm, lim_h);
    let bot = trim_side(&rev(&rs), &revm(&rm), lim_h);
    let left = trim_side(&cs, &cm, lim_w);
    let right = trim_side(&rev(&cs), &revm(&cm), lim_w);
    let pad = |v: usize| if v > 0 { v + 1 } else { 0 };
    let (t, b, l, r) = (pad(top), pad(bot), pad(left), pad(right));
    if (h.saturating_sub(t + b) as f32) < h as f32 * 0.4 || (w.saturating_sub(l + r) as f32) < w as f32 * 0.4 { return [0; 4]; }
    [t, b, l, r]
}

// ------------------------------------------------------------------ smart crop
fn window(h: usize, w: usize, ratio: f32) -> (usize, usize) {
    if w as f32 / h as f32 > ratio { (h, ((h as f32 * ratio).round() as usize).max(1)) } else { (((w as f32 / ratio).round() as usize).max(1), w) }
}

/// Crop rectangle `[x, y, w, h]` with w/h == ratio keeping the most salient area. `faces`: [x, y, w, h] fractions of the image, repeated.
pub fn smart_crop(rgba: &[u8], w: usize, h: usize, ratio: f32, faces: &[f32]) -> [usize; 4] {
    let (ch, cw) = window(h, w, ratio);
    if (ch, cw) == (h, w) { return [0, 0, w, h]; }
    let scale = 256.0 / w.max(h) as f32;
    let (sw0, sh0) = (((w as f32 * scale) as usize).max(1), ((h as f32 * scale) as usize).max(1));
    let (g, sw, sh) = resize_area(&gray_of(rgba, w, h), w, h, sw0, sh0);
    let mut sal = sobel_abs(&g, sw, sh);
    sal = gaussian(&sal, sw, sh, 3.0);
    for v in sal.iter_mut() { *v += 1e-3; }
    let smax = sal.iter().cloned().fold(0f32, f32::max);
    for f in faces.chunks_exact(4) {
        let (x0, y0) = ((f[0] * sw as f32) as usize, (f[1] * sh as f32) as usize);
        let (x1, y1) = (((f[0] + f[2]) * sw as f32) as usize, ((f[1] + f[3]) * sh as f32) as usize);
        for y in y0.min(sh)..y1.min(sh) { for x in x0.min(sw)..x1.min(sw) { sal[y * sw + x] += smax * 3.0; } }
    }
    let (sch, scw) = window(sh, sw, ratio);
    let (prof, n, side, full, total, horiz) = if cw < w {
        ((0..sw).map(|x| (0..sh).map(|y| sal[y * sw + x]).sum::<f32>()).collect::<Vec<_>>(), sw, scw, cw, w, true)
    } else {
        ((0..sh).map(|y| (0..sw).map(|x| sal[y * sw + x]).sum::<f32>()).collect::<Vec<_>>(), sh, sch, ch, h, false)
    };
    let mut cs = vec![0f32; n + 1];
    for i in 0..n { cs[i + 1] = cs[i] + prof[i]; }
    let centre = (n - side) as f32 / 2.0;
    let mut best = (f32::MIN, 0usize);
    for s in 0..=(n - side) {
        let score = (cs[s + side] - cs[s]) * (1.0 - 0.15 * (s as f32 - centre).abs() / centre.max(1.0));
        if score > best.0 { best = (score, s); }
    }
    let start = ((best.1 as f32 / scale).round() as usize).min(total - full);
    if horiz { [start, 0, cw, h] } else { [0, start, w, ch] }
}

/// 64-bit difference hash (9x8 gray), returned as [high, low]; near-duplicates differ in few bits.
pub fn dhash(rgba: &[u8], w: usize, h: usize) -> [u32; 2] {
    let (g, _, _) = resize_area(&gray_of(rgba, w, h), w, h, 9, 8);
    let mut bits = 0u64;
    for y in 0..8 { for x in 0..8 { bits = (bits << 1) | (g[y * 9 + x] > g[y * 9 + x + 1]) as u64; } }
    [(bits >> 32) as u32, bits as u32]
}

// ------------------------------------------------------------------ subject map
/// Where detail matters most (faces first, then saliency). `faces`: [cx, cy, fw, fh] as fractions of the image,
/// repeated. Returns a map in 0..1 at (ow, oh).
pub fn subject_map(rgb: &[u8], w: usize, h: usize, faces: &[f32], ow: usize, oh: usize) -> Vec<f32> {
    let g0: Vec<f32> = (0..w * h).map(|i| 0.299 * rgb[i * 3] as f32 + 0.587 * rgb[i * 3 + 1] as f32 + 0.114 * rgb[i * 3 + 2] as f32).collect();
    let (g, sw, sh) = down(&g0, w, h, 512);
    let m = sw.max(sh) as f32;
    let blur = gaussian(&g, sw, sh, m / 12.0);
    let contrast: Vec<f32> = g.iter().zip(&blur).map(|(a, b)| (a - b).abs()).collect();
    let edges = sobel_abs(&g, sw, sh);
    let mix: Vec<f32> = contrast.iter().zip(&edges).map(|(c, e)| c + 0.5 * e).collect();
    let mut sal = gaussian(&mix, sw, sh, m / 40.0);
    let mx = sal.iter().cloned().fold(0f32, f32::max) + 1e-3;   // a bigger epsilon keeps a perfectly flat photo from amplifying rounding noise
    for v in sal.iter_mut() { *v /= mx; }
    for y in 0..sh { for x in 0..sw {
        let (dx, dy) = ((x as f32 / sw as f32 - 0.5) / 0.45, (y as f32 / sh as f32 - 0.5) / 0.45);
        let c = (-(dx * dx + dy * dy)).exp();
        let i = y * sw + x;
        sal[i] = 0.7 * sal[i] + 0.3 * sal[i] * c;
    } }
    let smax = sal.iter().cloned().fold(0f32, f32::max) + 1e-3;
    let mut map = vec![0f32; sw * sh];
    for i in 0..sw * sh { map[i] = 0.6 * sal[i] / smax; }
    for f in faces.chunks_exact(4) {
        let (cx, cy, fw, fh) = (f[0] * sw as f32, f[1] * sh as f32, f[2] * sw as f32, f[3] * sh as f32);
        for y in 0..sh { for x in 0..sw {
            let gv = (-(((x as f32 - cx) / (fw * 0.75)).powi(2) + ((y as f32 - cy) / (fh * 0.85)).powi(2))).exp();
            let i = y * sw + x;
            if gv > map[i] { map[i] = gv; }
        } }
    }
    // bilinear resize to the requested size
    let mut out = vec![0f32; ow * oh];
    for y in 0..oh { for x in 0..ow {
        let fx = ((x as f32 + 0.5) * sw as f32 / ow as f32 - 0.5).clamp(0.0, sw as f32 - 1.0);
        let fy = ((y as f32 + 0.5) * sh as f32 / oh as f32 - 0.5).clamp(0.0, sh as f32 - 1.0);
        let (x0, y0) = (fx as usize, fy as usize);
        let (x1, y1) = ((x0 + 1).min(sw - 1), (y0 + 1).min(sh - 1));
        let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
        let v = map[y0 * sw + x0] * (1.0 - tx) * (1.0 - ty) + map[y0 * sw + x1] * tx * (1.0 - ty)
              + map[y1 * sw + x0] * (1.0 - tx) * ty + map[y1 * sw + x1] * tx * ty;
        out[y * ow + x] = v.clamp(0.0, 1.0);
    } }
    out
}

/// Weighted centre of a subject map as fractions (x, y).
pub fn subject_centroid(m: &[f32], w: usize, h: usize) -> [f32; 2] {
    let (mut s, mut sx, mut sy) = (0f64, 0f64, 0f64);
    for y in 0..h { for x in 0..w { let v = (m[y * w + x] as f64).powi(2); s += v; sx += v * x as f64; sy += v * y as f64; } }
    if s < 1e-9 { return [0.5, 0.5]; }
    [(sx / s / w as f64) as f32, (sy / s / h as f64) as f32]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(w: usize, h: usize, f: impl Fn(usize, usize) -> [u8; 3]) -> Vec<u8> {
        let mut v = Vec::with_capacity(w * h * 4);
        for y in 0..h { for x in 0..w { let p = f(x, y); v.extend_from_slice(&[p[0], p[1], p[2], 255]); } }
        v
    }
    fn noise(x: usize, y: usize) -> [u8; 3] { let n = ((x * 73856093) ^ (y * 19349663)) % 200; [(30 + n) as u8, (60 + n / 2) as u8, (90 + n / 3) as u8] }

    #[test]
    fn trims_a_white_frame_but_not_plain_photos() {
        let framed = img(100, 80, |x, y| if x < 8 || x >= 92 || y < 6 || y >= 74 { [255, 255, 255] } else { noise(x, y) });
        let [t, b, l, r] = trim_borders(&framed, 100, 80, 0.3);
        assert!((6..=8).contains(&t) && (6..=8).contains(&b) && (8..=10).contains(&l) && (8..=10).contains(&r), "{t} {b} {l} {r}");
        let plain = img(100, 80, noise);
        assert_eq!(trim_borders(&plain, 100, 80, 0.3), [0; 4]);
    }

    #[test]
    fn blurry_scores_lower_than_sharp() {
        let sharp = img(64, 64, noise);
        let blurry = img(64, 64, |x, y| { let v = (x * 2 + y) as u8; [v, v, v] });
        assert!(sharpness(&sharp, 64, 64) > 20.0 * sharpness(&blurry, 64, 64).max(0.01));
    }

    #[test]
    fn smart_crop_follows_detail_and_keeps_ratio() {
        // detail on the right side only
        let im = img(200, 100, |x, y| if x > 140 { noise(x, y) } else { [90, 90, 90] });
        let [x, y, w, h] = smart_crop(&im, 200, 100, 1.0, &[]);
        assert_eq!((y, w, h), (0, 100, 100));
        assert!(x >= 80, "crop should move right, got x={x}");
        assert_eq!(smart_crop(&im, 200, 100, 2.0, &[]), [0, 0, 200, 100]);
    }

    #[test]
    fn dhash_matches_duplicates_not_strangers() {
        let a = img(64, 48, |x, y| { let v = ((x * 4) ^ (y * 3)) as u8; [v, v, v] });
        let b = img(128, 96, |x, y| { let (x, y) = (x / 2, y / 2); let v = ((x * 4) ^ (y * 3)) as u8; [v, v, v] });
        let c = img(64, 48, |x, y| { let v = (255 - (x * 4) ^ (y * 7)) as u8; [v, 40, v / 2] });
        let d = |p: [u32; 2], q: [u32; 2]| (p[0] ^ q[0]).count_ones() + (p[1] ^ q[1]).count_ones();
        assert!(d(dhash(&a, 64, 48), dhash(&b, 128, 96)) <= 4);
        assert!(d(dhash(&a, 64, 48), dhash(&c, 64, 48)) > 8);
    }

    #[test]
    fn subject_map_peaks_on_faces() {
        // textured photo: a face adds weight where saliency alone is lower; the centroid moves toward it
        let rgb: Vec<u8> = (0..90 * 60).flat_map(|i| { let n = noise(i % 90, i / 90); [n[0], n[1], n[2]] }).collect();
        let with = subject_map(&rgb, 90, 60, &[0.8, 0.3, 0.15, 0.25], 90, 60);
        let without = subject_map(&rgb, 90, 60, &[], 90, 60);
        assert!(with[18 * 90 + 72] > 0.95, "face centre {}", with[18 * 90 + 72]);
        assert!(with[18 * 90 + 72] >= without[18 * 90 + 72]);
        assert!(without.iter().all(|v| (0.0..=1.0).contains(v)));
        let [cx, _] = subject_centroid(&with, 90, 60);
        let [cx0, _] = subject_centroid(&without, 90, 60);
        assert!(cx > cx0, "{cx} vs {cx0}");
    }
}
