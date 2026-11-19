//! Animation planning: per-tile flight parameters + camera path. Port of `mosaicvid/animation.py`.
//! Pure Rust (no wgpu), so it is unit-testable natively. A *style* turns a solved mosaic into a `Plan`;
//! the renderer only needs the Plan.
//!
//! Plan.inst columns (N x 21, same as the Python version):
//!  0-3 end x,y,size,tile | 4-7 start x,y,z,spin | 8-11 t0,duration,flip,tilt | 12-14 rgb offset
//!  15-17 start-scale mult, shrink start, ease mix (>=1 marks a showcase tile; value-1 = its hi-res layer)
//!  18-20 bezier control point

use crate::rng::Rng;
use crate::still::lab_to_rgb_f;
use crate::solver::rgb_to_lab;
use std::f64::consts::{PI, TAU};

pub const FOV_DEG: f64 = 35.0;
pub const N_COLS: usize = 21;
type V3 = [f64; 3];

fn tan_half(fov_deg: f64) -> f64 { (fov_deg.to_radians() / 2.0).tan() }
fn sub(a: V3, b: V3) -> V3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
fn add(a: V3, b: V3) -> V3 { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
fn mul(a: V3, k: f64) -> V3 { [a[0] * k, a[1] * k, a[2] * k] }
fn dot(a: V3, b: V3) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
fn cross(a: V3, b: V3) -> V3 { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
fn norm(a: V3) -> f64 { dot(a, a).sqrt() }
fn unit(a: V3) -> V3 { let n = norm(a).max(1e-12); mul(a, 1.0 / n) }
fn smooth(a: f64, b: f64, x: f64) -> f64 { let u = ((x - a) / (b - a)).clamp(0.0, 1.0); u * u * (3.0 - 2.0 * u) }

/// Camera basis (forward, right, up) for an eye looking at a target with a banking roll.
pub fn basis(eye: V3, target: V3, roll: f64) -> (V3, V3, V3) {
    let f = unit(sub(target, eye));
    let up = [roll.sin(), roll.cos(), 0.0];
    let r = unit(cross(f, up));
    let u = cross(r, f);
    (f, r, u)
}

pub fn full_distance(cols: f64, rows: f64, aspect: f64, margin: f64) -> f64 {
    let t = tan_half(FOV_DEG);
    (rows * margin / (2.0 * t)).max(cols * margin / (aspect * 2.0 * t))
}

// ------------------------------------------------------------------ PCHIP (matches scipy's PchipInterpolator)
#[derive(Clone)]
pub struct Pchip { x: Vec<f64>, y: Vec<f64>, d: Vec<f64> }

impl Pchip {
    pub fn new(x: &[f64], y: &[f64]) -> Pchip {
        let n = x.len();
        let h: Vec<f64> = (0..n - 1).map(|i| x[i + 1] - x[i]).collect();
        let del: Vec<f64> = (0..n - 1).map(|i| (y[i + 1] - y[i]) / h[i]).collect();
        let mut d = vec![0.0; n];
        for i in 1..n - 1 {
            if del[i - 1] * del[i] > 0.0 {
                let (w1, w2) = (2.0 * h[i] + h[i - 1], h[i] + 2.0 * h[i - 1]);
                d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
            }
        }
        let edge = |h0: f64, h1: f64, d0: f64, d1: f64| -> f64 {
            let mut v = ((2.0 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
            if v.signum() != d0.signum() { v = 0.0; }
            else if d0.signum() != d1.signum() && v.abs() > 3.0 * d0.abs() { v = 3.0 * d0; }
            v
        };
        if n == 2 { d[0] = del[0]; d[1] = del[0]; }
        else {
            d[0] = edge(h[0], h[1], del[0], del[1]);
            d[n - 1] = edge(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
        }
        Pchip { x: x.to_vec(), y: y.to_vec(), d }
    }

    pub fn eval(&self, t: f64) -> f64 {
        let n = self.x.len();
        let t = t.clamp(self.x[0], self.x[n - 1]);
        let mut i = match self.x.iter().position(|&v| v > t) { Some(p) => p.saturating_sub(1), None => n - 2 };
        if i > n - 2 { i = n - 2; }
        let h = self.x[i + 1] - self.x[i];
        let s = (t - self.x[i]) / h;
        let (s2, s3) = (s * s, s * s * s);
        (2.0 * s3 - 3.0 * s2 + 1.0) * self.y[i] + (s3 - 2.0 * s2 + s) * h * self.d[i]
            + (-2.0 * s3 + 3.0 * s2) * self.y[i + 1] + (s3 - s2) * h * self.d[i + 1]
    }
}

// ------------------------------------------------------------------ camera
#[derive(Clone)]
pub struct Cam {
    orbit: bool,
    kt: Vec<f64>,
    spl: Vec<Pchip>,
    ph: [f64; 6],
    d: f64,
    drift: f64,
    arc: f64,
    fov_boost: f64,
    world_w: f64,
    const_fov: bool,
    motion: f64,
}

impl Cam {
    /// (target x, target y, distance, yaw, pitch, roll)
    pub fn state(&self, t: f64) -> [f64; 6] {
        let d = self.d;
        let tt = t.clamp(0.0, d);
        let last = *self.kt.last().unwrap();
        let mut v = [0.0; 6];
        for k in 0..6 { v[k] = self.spl[k].eval(tt.min(last)); }
        let [mut x, mut y, mut dist, mut yaw, pitch, mut roll] = v;
        let ph = &self.ph;
        if self.orbit {
            let k = self.motion * (1.0 - smooth(0.66 * d, 0.86 * d, tt));
            x += k * (0.30 * (TAU * tt / 7.3 + ph[0]).sin() + 0.15 * (TAU * tt / 3.1 + ph[1]).sin());
            y += k * (0.30 * (TAU * tt / 6.1 + ph[2]).sin() + 0.15 * (TAU * tt / 2.7 + ph[3]).sin());
            roll += k * 0.006 * (TAU * tt / 5.3 + ph[4]).sin();
            yaw += k * 0.015 * (TAU * tt / 8.9 + ph[5]).sin();
        } else {
            let k = self.motion * self.drift * (1.0 - smooth(0.55 * d, 0.84 * d, tt));
            x += k * (0.30 * (TAU * tt / 6.3 + ph[0]).sin() + 0.15 * (TAU * tt / 2.9 + ph[1]).sin());
            y += k * (0.30 * (TAU * tt / 5.7 + ph[2]).sin() + 0.15 * (TAU * tt / 2.5 + ph[3]).sin());
            roll += k * 0.006 * (TAU * tt / 5.3 + ph[4]).sin();
            yaw += k * 0.02 * (TAU * tt / 8.9 + ph[5]).sin();
            let u = smooth(0.66 * d, d, tt);                  // living finale
            dist *= 1.0 - 0.05 * u;
            yaw += self.arc * 0.05 * (PI * u).sin();
            x += self.arc * 0.012 * self.world_w * (PI * u).sin();
        }
        [x, y, dist, yaw, pitch, roll]
    }

    pub fn camera(&self, t: f64) -> (V3, V3, f64) {
        let [x, y, dist, yaw, pitch, roll] = self.state(t);
        let target = [x, y, 0.0];
        let eye = add(target, mul([yaw.sin() * pitch.cos(), pitch.sin(), yaw.cos() * pitch.cos()], dist));
        (eye, target, roll)
    }

    pub fn fov(&self, t: f64) -> f64 {
        if self.const_fov { FOV_DEG } else { FOV_DEG + self.fov_boost * (1.0 - smooth(0.0, 0.45 * self.d, t.clamp(0.0, self.d))) }
    }
}

fn splines(kt: &[f64], rows: &[Vec<f64>]) -> Vec<Pchip> { rows.iter().map(|r| Pchip::new(kt, r)).collect() }

fn orbit_camera(world_w: f64, rows: f64, cen: [f64; 2], d_full: f64, dur: f64, seed: u64) -> Cam {
    let mut rng = Rng::new(seed + 101);
    let (lim_x, lim_y) = (world_w * 0.42, rows * 0.42);
    let clip = |x: f64, y: f64| (x.clamp(-lim_x, lim_x), y.clamp(-lim_y, lim_y));
    let (cx, cy) = (cen[0], cen[1]);
    let pts = [clip(cx, cy), clip(cx + 0.05 * world_w, cy - 0.03 * rows), clip(cx + 0.16 * world_w, cy - 0.22 * rows),
               clip(cx - 0.16 * world_w, cy + 0.18 * rows), clip(cx * 0.5 + 0.06 * world_w, cy * 0.5),
               clip(cx * 0.2, cy * 0.2), (0.0, 0.0), (0.0, 0.0)];
    let kt: Vec<f64> = [0.0, 0.12, 0.25, 0.40, 0.55, 0.70, 0.84, 0.93].iter().map(|k| k * dur).collect();
    let sc = |v: [f64; 8]| v.iter().map(|k| k * d_full).collect::<Vec<f64>>();
    let rows_k = vec![
        pts.iter().map(|p| p.0).collect(), pts.iter().map(|p| p.1).collect(),
        sc([0.32, 0.36, 0.42, 0.50, 0.62, 0.82, 1.0, 0.985]),
        vec![0.55, 0.30, -0.10, -0.48, -0.26, 0.14, 0.0, 0.012],
        vec![-0.18, -0.05, 0.12, 0.24, 0.10, -0.05, 0.0, -0.005],
        vec![-0.10, 0.05, 0.08, -0.07, -0.03, 0.02, 0.0, 0.0],
    ];
    let mut ph = [0.0; 6];
    for p in ph.iter_mut() { *p = rng.uniform(0.0, 6.28); }
    Cam { orbit: true, spl: splines(&kt, &rows_k), kt, ph, d: dur, drift: 1.0, arc: 0.0, fov_boost: 0.0, world_w, const_fov: true, motion: 1.0 }
}

#[allow(clippy::too_many_arguments)]
fn path_camera(world_w: f64, rows: f64, dur: f64, seed: u64, kt: &[f64], tx: Vec<f64>, ty: Vec<f64>, dist: Vec<f64>,
               yaw: Vec<f64>, pitch: Vec<f64>, roll: Vec<f64>, fov_boost: f64, drift: f64, arc: f64) -> Cam {
    let mut rng = Rng::new(seed + 202);
    let mut ph = [0.0; 6];
    for p in ph.iter_mut() { *p = rng.uniform(0.0, 6.28); }
    let (lim_x, lim_y) = (world_w * 0.44, rows * 0.44);
    let kt: Vec<f64> = kt.iter().map(|k| k * dur).collect();
    let rows_k = vec![tx.iter().map(|v| v.clamp(-lim_x, lim_x)).collect(), ty.iter().map(|v| v.clamp(-lim_y, lim_y)).collect(),
                      dist, yaw, pitch, roll];
    Cam { orbit: false, spl: splines(&kt, &rows_k), kt, ph, d: dur, drift, arc, fov_boost, world_w, const_fov: false, motion: 1.0 }
}

// ------------------------------------------------------------------ inputs / outputs
pub struct VideoParams {
    pub style: u8,           // 0 swarm, 1 vortex, 2 wave, 3 zoom
    pub duration: f64,
    pub aspect: f64,         // video width / height
    pub tile_ratio: f64,
    pub hero_tiles: usize,
    pub hero_size: f64,
    pub flight_scale: f64,
    pub pulses: f64,
    pub pulse_depth: f64,
    pub frame_margin: f64,
    pub seed: u64,
    pub tint: bool,
    pub flight_speed: f64,   // 1.0 = as designed; scales how long each tile flies
    pub arrival_spread: f64, // 1.0 = as designed; scales how long tiles keep arriving
    pub camera_motion: f64,  // 1.0 = as designed; scales camera drift and wobble
    pub spin: f64,           // 1.0 = as designed; scales tile spin and tilt
    pub reveal_time: f64,    // fraction of the video when the final picture starts to appear (0.78 = as designed)
    pub entry: u8,           // where tiles fly in from: 0 as designed by the style, 1 all around, 2 top, 3 bottom, 4 sides, 5 centre burst, 6 front
    pub order: u8,           // build order: 0 as designed, 1 random, 2 centre-out, 3 edges-in, 4 left to right, 5 top to bottom, 6 dark to bright, 7 bright to dark
    pub arc: f64,            // 1.0 = as designed; 0 = straight flights, higher = bigger curves
    /// Custom camera: 7 numbers per keyframe [time 0..1, distance (1 = whole mosaic), pan x, pan y (fractions of the mosaic),
    /// turn, tilt, roll (degrees)]. Empty = the style's own camera. The camera always finishes on the full picture.
    pub cam_keys: Vec<f64>,
}

pub struct MosaicIn<'a> {
    pub cols: usize,
    pub rows: usize,
    pub ratio: f64,
    pub cells: &'a [f32],        // 9 floats per cell [x,y,size,tile,flip,sL,sa,sb,w]
    pub tile_rgb4: &'a [u8],     // T tiles x 16 px x RGB (used for the tint approximation)
    pub n_tiles: usize,
}

impl MosaicIn<'_> {
    fn world_w(&self) -> f64 { self.cols as f64 * self.ratio }
}

pub struct Plan {
    pub inst: Vec<f32>,
    pub cam: Cam,
    pub d_full: f64,
    pub ramp: (f64, f64),
    pub shine: (f64, f64),
    pub n: usize,
}

struct World { x: Vec<f64>, y: Vec<f64>, size: Vec<f64>, tile: Vec<usize>, flip: Vec<f32>, w: Vec<f64> }

fn world(m: &MosaicIn) -> World {
    let n = m.cells.len() / 9;
    let mut w = World { x: vec![], y: vec![], size: vec![], tile: vec![], flip: vec![], w: vec![] };
    for c in m.cells.chunks_exact(9) {
        let (cx, cy, sz) = (c[0] as f64 + c[2] as f64 / 2.0, c[1] as f64 + c[2] as f64 / 2.0, c[2] as f64);
        w.x.push((cx - m.cols as f64 / 2.0) * m.ratio);
        w.y.push(m.rows as f64 / 2.0 - cy);
        w.size.push(sz); w.tile.push(c[3] as usize); w.flip.push(c[4]); w.w.push(c[8] as f64);
    }
    debug_assert_eq!(w.x.len(), n);
    w
}

fn subject_centroid(w: &World) -> [f64; 2] {
    let ws: Vec<f64> = w.w.iter().map(|v| v * v).collect();
    let s: f64 = ws.iter().sum();
    if s < 1e-6 { return [0.0, 0.0]; }
    [ws.iter().zip(&w.x).map(|(a, b)| a * b).sum::<f64>() / s, ws.iter().zip(&w.y).map(|(a, b)| a * b).sum::<f64>() / s]
}

/// Additive RGB offset approximating each cell's Lab tint shift.
fn rgb_offsets(m: &MosaicIn, w: &World) -> Vec<[f32; 3]> {
    let mean: Vec<[f32; 3]> = (0..m.n_tiles).map(|t| {
        let px = &m.tile_rgb4[t * 48..(t + 1) * 48];
        let mut a = [0f32; 3];
        for p in px.chunks_exact(3) { for k in 0..3 { a[k] += p[k] as f32 / 16.0; } }
        [a[0], a[1], a[2]]
    }).collect();
    (0..w.tile.len()).map(|i| {
        let t = w.tile[i].min(m.n_tiles.saturating_sub(1));
        let base = rgb_to_lab(mean[t][0] as u8, mean[t][1] as u8, mean[t][2] as u8);
        let c = &m.cells[i * 9..i * 9 + 9];
        let a = lab_to_rgb_f(base[0], base[1], base[2]);
        let b = lab_to_rgb_f((base[0] + c[5]).clamp(0.0, 100.0), base[1] + c[6], base[2] + c[7]);
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    }).collect()
}

fn interp(x: f64, xp: &[f64], fp: &[f64]) -> f64 {
    if x <= xp[0] { return fp[0]; }
    let n = xp.len();
    if x >= xp[n - 1] { return fp[n - 1]; }
    let i = xp.partition_point(|&v| v <= x) - 1;
    let u = (x - xp[i]) / (xp[i + 1] - xp[i]).max(1e-12);
    fp[i] + u * (fp[i + 1] - fp[i])
}

fn rank_of(key: &[f64]) -> Vec<f64> {
    let n = key.len();
    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| key[a].partial_cmp(&key[b]).unwrap_or(std::cmp::Ordering::Equal));
    let mut r = vec![0.0; n];
    for (pos, &i) in idx.iter().enumerate() { r[i] = pos as f64 / (n.max(2) - 1) as f64; }
    r
}

/// Arrival times from the rank order, paced by `pulses` bursts.
fn arrival_times(key: &[f64], t_a: f64, t_b: f64, pulses: f64, depth: f64, phase: f64) -> Vec<f64> {
    let tt: Vec<f64> = (0..2000).map(|i| t_a + (t_b - t_a) * i as f64 / 1999.0).collect();
    let rho: Vec<f64> = tt.iter().map(|&t| if pulses > 0.0 { (1.0 + depth * (TAU * pulses * (t - t_a) / (t_b - t_a) + phase).sin()).max(0.12) } else { 1.0 }).collect();
    let mut cdf = vec![0.0; rho.len()];
    let mut acc = 0.0;
    for (i, r) in rho.iter().enumerate() { acc += r; cdf[i] = acc; }
    let (c0, c1) = (cdf[0], cdf[cdf.len() - 1]);
    for c in cdf.iter_mut() { *c = (*c - c0) / (c1 - c0); }
    rank_of(key).iter().map(|&r| interp(r, &cdf, &tt)).collect()
}

struct Arrays { s: Vec<V3>, c: Vec<V3>, e: Vec<V3>, spin: Vec<f64>, tilt: Vec<f64>, kmul: Vec<f64>, shrink: Vec<f64>,
                ease: Vec<f64>, t0: Vec<f64>, dur: Vec<f64> }

struct HeroKw { edge_bias: bool, size_scale: f64, min_gap: f64, q_hi: f64 }

fn place_heroes(p: &VideoParams, rng: &mut Rng, cam: &Cam, tan_fn: &dyn Fn(f64) -> f64, n_tiles: usize, flight: f64,
                w: &World, a: &mut Arrays, kw: &HeroKw) {
    let n = a.t0.len();
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&i, &j| a.t0[i].partial_cmp(&a.t0[j]).unwrap_or(std::cmp::Ordering::Equal));
    let mut used = std::collections::HashSet::new();
    let mut chosen_t: Vec<f64> = vec![];
    let n_h = p.hero_tiles.min(n_tiles);
    let mut n_sel = 0usize;
    for qi in 0..n_h {
        let q = if n_h > 1 { 0.03 + (kw.q_hi - 0.03) * qi as f64 / (n_h - 1) as f64 } else { 0.03 };
        let i0 = (q * (n as f64 - 1.0)) as usize;
        let mut found = None;
        for j in i0..(i0 + 400).min(n) {
            let ci = order[j];
            if w.size[ci] >= 1.0 && !used.contains(&w.tile[ci]) && a.kmul[ci] > 0.0
                && chosen_t.iter().all(|tc| (a.t0[ci] - tc).abs() >= kw.min_gap) { found = Some(ci); break; }
        }
        let Some(ci) = found else { continue };
        used.insert(w.tile[ci]);
        chosen_t.push(a.t0[ci]);
        a.dur[ci] = flight * 1.65;
        let th = a.t0[ci] + 0.5 * a.dur[ci];
        let (eye, target, roll) = cam.camera(th);
        let (f, r, u) = basis(eye, target, roll);
        let dist = norm(sub(target, eye));
        let dh = 0.48 * dist;
        let tn = tan_fn(th);
        let (visw, vish) = (2.0 * dh * tn * p.aspect, 2.0 * dh * tn);
        let hp = if kw.edge_bias {
            let lat = rng.uniform(0.26, 0.38) * if n_sel % 2 == 0 { 1.0 } else { -1.0 };
            add(add(add(eye, mul(f, dh)), mul(r, lat * visw)), mul(u, rng.uniform(-0.30, 0.30) * vish))
        } else {
            add(add(add(eye, mul(f, dh)), mul(r, rng.uniform(-0.18, 0.18) * visw)), mul(u, rng.uniform(-0.2, 0.2) * vish))
        };
        let side = rng.sign();
        a.s[ci] = sub(add(add(hp, mul(r, side * visw * 1.1)), mul(u, rng.uniform(-0.6, 0.6) * vish)), mul(f, dh * 0.25));
        a.c[ci] = sub(mul(hp, 2.0), mul(add(a.s[ci], a.e[ci]), 0.5));
        a.kmul[ci] = p.hero_size * kw.size_scale * visw / (w.size[ci] * p.tile_ratio);
        a.shrink[ci] = 0.66;
        a.ease[ci] = 1.0 + n_sel as f64;
        n_sel += 1;
        a.spin[ci] = rng.uniform(0.2, 0.7) * rng.sign();
        a.tilt[ci] = rng.uniform(0.2, 0.6) * rng.sign();
    }
}

fn build_plan(m: &MosaicIn, p: &VideoParams, w: &World, a: &Arrays, cam: Cam, d_full: f64) -> Plan {
    let n = a.t0.len();
    let off = if p.tint { rgb_offsets(m, w) } else { vec![[0.0; 3]; n] };
    let mut inst = vec![0f32; n * N_COLS];
    for i in 0..n {
        let r = &mut inst[i * N_COLS..(i + 1) * N_COLS];
        r[0] = w.x[i] as f32; r[1] = w.y[i] as f32; r[2] = w.size[i] as f32; r[3] = w.tile[i] as f32;
        r[4] = a.s[i][0] as f32; r[5] = a.s[i][1] as f32; r[6] = a.s[i][2] as f32; r[7] = (a.spin[i] * p.spin) as f32;
        r[8] = a.t0[i] as f32; r[9] = a.dur[i] as f32; r[10] = w.flip[i]; r[11] = (a.tilt[i] * p.spin) as f32;
        r[12..15].copy_from_slice(&off[i]);
        r[15] = a.kmul[i] as f32; r[16] = a.shrink[i] as f32; r[17] = a.ease[i] as f32;
        r[18] = a.c[i][0] as f32; r[19] = a.c[i][1] as f32; r[20] = a.c[i][2] as f32;
    }
    let d = p.duration;
    Plan { inst, cam, d_full, ramp: (p.reveal_time * d, (p.reveal_time + 0.14) * d), shine: ((p.reveal_time + 0.06) * d, (p.reveal_time + 0.19) * d), n }
}

fn new_arrays(w: &World) -> Arrays {
    let n = w.x.len();
    Arrays { s: vec![[0.0; 3]; n], c: vec![[0.0; 3]; n], e: (0..n).map(|i| [w.x[i], w.y[i], 0.0]).collect(),
             spin: vec![0.0; n], tilt: vec![0.0; n], kmul: vec![1.0; n], shrink: vec![0.30; n], ease: vec![0.0; n],
             t0: vec![0.0; n], dur: vec![0.0; n] }
}

fn d_full_for(m: &MosaicIn, p: &VideoParams) -> f64 {
    full_distance(m.world_w(), m.rows as f64, p.aspect, 1.0 / p.frame_margin.max(0.3))
}

// ------------------------------------------------------------------ styles
fn swarm(m: &MosaicIn, p: &VideoParams, ov: Option<Cam>) -> Plan {
    let w = world(m);
    let n = w.x.len();
    let mut rng = Rng::new(p.seed);
    let dur = p.duration;
    let d_full = d_full_for(m, p);
    let cen = subject_centroid(&w);
    let cam = ov.unwrap_or_else(|| orbit_camera(m.world_w(), m.rows as f64, cen, d_full, dur, p.seed));
    let (t_a, t_b) = spread_window(p, 0.03, 0.60);
    let ts: Vec<f64> = (0..80).map(|i| t_a + (t_b - t_a) * i as f64 / 79.0).collect();
    let st: Vec<[f64; 6]> = ts.iter().map(|&t| cam.state(t)).collect();
    let tn = tan_half(FOV_DEG);
    let mut key = vec![0.0; n];
    for i in 0..n {
        let mut best = (f64::INFINITY, 0usize);
        for (j, s) in st.iter().enumerate() {
            let d = (w.x[i] - s[0]).hypot(w.y[i] - s[1]) / (2.0 * s[2] * tn);
            if d < best.0 { best = (d, j); }
        }
        key[i] = ts[best.1] + rng.normal(0.0, 0.06 * dur) + if w.size[i] < 1.0 { 0.04 * dur } else { 0.0 };
    }
    let flight = 0.17 * dur * p.flight_speed;
    let mut a = new_arrays(&w);
    a.t0 = arrival_times(&key, t_a, t_b, p.pulses, p.pulse_depth, -PI / 2.0);
    for i in 0..n {
        a.dur[i] = flight * rng.uniform(0.85, 1.15);
        let mut d = [rng.normal(0.0, 1.0), rng.normal(0.0, 1.0), rng.normal(0.0, 1.0)];
        d[2] = d[2].abs() * 0.8 + 0.15;
        let d = unit(d);
        let r = d_full * rng.uniform(0.30, 0.9);
        a.s[i] = add(a.e[i], mul(d, r));
        let off = unit([rng.normal(0.0, 1.0), rng.normal(0.0, 1.0), rng.normal(0.0, 1.0)]);
        let l = norm(sub(a.s[i], a.e[i])) * rng.uniform(0.08, 0.30);
        a.c[i] = add(mul(add(a.s[i], a.e[i]), 0.5), mul(off, 2.0 * l));
        a.spin[i] = rng.uniform(1.5, 5.0) * rng.sign();
        a.tilt[i] = rng.uniform(0.8, 2.2) * rng.sign();
        a.kmul[i] = p.flight_scale * rng.uniform(0.75, 1.35);
    }
    let tan_c = |_t: f64| tn;
    place_heroes(p, &mut rng, &cam, &tan_c, m.n_tiles, flight, &w, &mut a,
                 &HeroKw { edge_bias: false, size_scale: 1.0, min_gap: 0.0, q_hi: 0.88 });
    build_plan(m, p, &w, &a, cam, d_full)
}

struct Simple { spin_amp: f64, tilt_amp: f64, kmul_rng: (f64, f64), flight_frac: f64, window: (f64, f64), pulse_phase: f64,
                opening: Option<(f64, f64, f64)> }

fn simple_plan(m: &MosaicIn, p: &VideoParams, w: &World, mut a: Arrays, key: &[f64], cam: Cam, d_full: f64, sp: Simple) -> Plan {
    let mut rng = Rng::new(p.seed + 7);
    let n = w.x.len();
    let dur = p.duration;
    let (t_a, t_b) = spread_window(p, sp.window.0, sp.window.1);
    a.t0 = arrival_times(key, t_a, t_b, p.pulses, p.pulse_depth, sp.pulse_phase);
    for i in 0..n { a.dur[i] = sp.flight_frac * p.flight_speed * dur * rng.uniform(0.85, 1.15); }
    if let Some((frac, secs, scale)) = sp.opening {
        let n_o = (frac * n as f64) as usize;
        let mut idx: Vec<usize> = (0..n).collect();
        idx.sort_by(|&i, &j| key[i].partial_cmp(&key[j]).unwrap_or(std::cmp::Ordering::Equal));
        let early = &idx[..n_o];
        let mut times: Vec<f64> = (0..n_o).map(|_| rng.uniform(-0.7, secs)).collect();
        times.sort_by(|x, y| x.partial_cmp(y).unwrap());
        for (k, &i) in early.iter().enumerate() {
            a.t0[i] = times[k];
            a.dur[i] *= 0.7;
            let old_mid = mul(add(a.s[i], a.e[i]), 0.5);
            a.s[i] = add(a.e[i], mul(sub(a.s[i], a.e[i]), scale));
            let new_mid = mul(add(a.s[i], a.e[i]), 0.5);
            a.c[i] = add(a.c[i], sub(new_mid, old_mid));
        }
    }
    for i in 0..n {
        a.spin[i] = rng.uniform(0.3, 1.0) * sp.spin_amp * rng.sign();
        a.tilt[i] = rng.uniform(0.3, 1.0) * sp.tilt_amp * rng.sign();
        a.kmul[i] = p.flight_scale * rng.uniform(sp.kmul_rng.0, sp.kmul_rng.1);
    }
    let cam2 = cam.clone();
    let tan_fn = move |t: f64| tan_half(cam2.fov(t));
    place_heroes(p, &mut rng, &cam, &tan_fn, m.n_tiles, sp.flight_frac * p.flight_speed * dur, w, &mut a,
                 &HeroKw { edge_bias: true, size_scale: 0.85, min_gap: 0.04 * dur, q_hi: 0.62 });
    build_plan(m, p, w, &a, cam, d_full)
}

fn vortex(m: &MosaicIn, p: &VideoParams, ov: Option<Cam>) -> Plan {
    let w = world(m);
    let n = w.x.len();
    let mut rng = Rng::new(p.seed);
    let d_full = d_full_for(m, p);
    let cen = subject_centroid(&w);
    let (ww, rows, dur) = (m.world_w(), m.rows as f64, p.duration);
    let r: Vec<f64> = (0..n).map(|i| (w.x[i] - cen[0]).hypot(w.y[i] - cen[1])).collect();
    let rmax = r.iter().cloned().fold(1e-6, f64::max);
    let rn: Vec<f64> = r.iter().map(|v| v / rmax).collect();
    let mut a = new_arrays(&w);
    for i in 0..n {
        let phi = 2.6 + 1.6 * rn[i];
        let (c, s) = (phi.cos(), phi.sin());
        let rel = [w.x[i] - cen[0], w.y[i] - cen[1]];
        let scale = 1.8 + 1.5 * rn[i];
        a.s[i] = [cen[0] + (c * rel[0] - s * rel[1]) * scale, cen[1] + (s * rel[0] + c * rel[1]) * scale, d_full * rng.uniform(0.05, 0.45)];
        let (c2, s2) = ((phi * 0.5).cos(), (phi * 0.5).sin());
        a.c[i] = [cen[0] + (c2 * rel[0] - s2 * rel[1]) * (1.0 + scale) * 0.7, cen[1] + (s2 * rel[0] + c2 * rel[1]) * (1.0 + scale) * 0.7,
                  d_full * rng.uniform(0.2, 0.5)];
    }
    // camera: helix around the subject
    let th0 = Rng::new(p.seed + 202).uniform(0.0, 6.28);
    let mm = ww.min(rows);
    let kt = [0.0, 0.08, 0.20, 0.30, 0.38, 0.48, 0.60, 0.72, 0.90];
    let ang: Vec<f64> = [0.0, 0.20, 0.60, 1.00, 1.40, 1.70, 1.90, 2.0, 2.0].iter().map(|k| th0 - TAU * k).collect();
    let rad: Vec<f64> = [0.02, 0.10, 0.24, 0.26, 0.22, 0.14, 0.06, 0.0, 0.0].iter().map(|k| k * mm).collect();
    let wb = [0.0, 0.0, 0.0, 0.05, 0.20, 0.55, 0.90, 1.0, 1.0];
    let tx: Vec<f64> = (0..9).map(|i| (1.0 - wb[i]) * (cen[0] + rad[i] * ang[i].cos())).collect();
    let ty: Vec<f64> = (0..9).map(|i| (1.0 - wb[i]) * (cen[1] + rad[i] * ang[i].sin())).collect();
    let cam = ov.unwrap_or_else(|| path_camera(ww, rows, dur, p.seed, &kt, tx, ty,
        [0.26, 0.30, 0.32, 0.34, 0.36, 0.50, 0.88, 1.0, 0.985].iter().map(|k| k * d_full).collect(),
        vec![1.00, 0.75, 0.40, 0.0, -0.40, -0.50, -0.15, -0.02, 0.0], vec![-0.22, -0.05, 0.20, 0.12, -0.12, -0.05, 0.04, 0.0, 0.0],
        vec![0.20, 0.16, 0.12, 0.06, 0.0, -0.04, 0.02, 0.0, 0.0], 9.0, 1.0, 1.0));
    let (t_a, t_b) = (0.0, 0.62 * dur);
    let ts: Vec<f64> = (0..80).map(|i| t_a + (t_b - t_a) * i as f64 / 79.0).collect();
    let st: Vec<[f64; 6]> = ts.iter().map(|&t| cam.state(t)).collect();
    let vis: Vec<f64> = ts.iter().zip(&st).map(|(&t, s)| 2.0 * s[2] * tan_half(cam.fov(t))).collect();
    let mut key = vec![0.0; n];
    for i in 0..n {
        let mut best = (f64::INFINITY, 0usize);
        for (j, s) in st.iter().enumerate() {
            let d = (w.x[i] - s[0]).hypot(w.y[i] - s[1]) / vis[j];
            if d < best.0 { best = (d, j); }
        }
        key[i] = ts[best.1] + rng.normal(0.0, 0.07 * dur) + 0.05 * dur * rn[i];
    }
    simple_plan(m, p, &w, a, &key, cam, d_full, Simple { spin_amp: 4.0, tilt_amp: 1.4, kmul_rng: (0.55, 0.95), flight_frac: 0.14,
        window: (0.0, 0.62), pulse_phase: 0.4, opening: Some((0.08, 1.2, 0.35)) })
}

fn wave(m: &MosaicIn, p: &VideoParams, ov: Option<Cam>) -> Plan {
    let w = world(m);
    let n = w.x.len();
    let mut rng = Rng::new(p.seed);
    let d_full = d_full_for(m, p);
    let (cols, rows, dur) = (m.world_w(), m.rows as f64, p.duration);
    let (xmin, xmax) = (w.x.iter().cloned().fold(f64::INFINITY, f64::min), w.x.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
    let (ymin, ymax) = (w.y.iter().cloned().fold(f64::INFINITY, f64::min), w.y.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
    let mut a = new_arrays(&w);
    let mut key = vec![0.0; n];
    for i in 0..n {
        let xn = (w.x[i] - xmin) / (xmax - xmin).max(1e-6);
        let yn = (w.y[i] - ymin) / (ymax - ymin).max(1e-6);
        key[i] = xn + 0.18 * (2.4 * PI * yn).sin() + rng.normal(0.0, 0.03);
        a.s[i] = add(a.e[i], [rng.normal(-0.25, 0.1) * cols, -rng.uniform(0.55, 0.9) * rows, d_full * rng.uniform(0.15, 0.55)]);
        a.c[i] = mul(add(a.s[i], a.e[i]), 0.5);
        a.c[i][2] += d_full * rng.uniform(0.2, 0.5);
        a.c[i][0] += rng.normal(0.0, 0.05) * cols;
    }
    let kt = [0.0, 0.12, 0.24, 0.36, 0.48, 0.58, 0.70, 0.82, 0.90];
    let wb = [0.0, 0.0, 0.0, 0.0, 0.0, 0.25, 0.70, 1.0, 1.0];
    let tx: Vec<f64> = (0..9).map(|i| { let f = ((kt[i] - 0.02) / 0.58f64).clamp(0.0, 1.0); (-0.5 + f) * cols * 0.9 * (1.0 - wb[i]) }).collect();
    let cam = ov.unwrap_or_else(|| path_camera(cols, rows, dur, p.seed, &kt, tx,
        [-0.04, -0.04, -0.03, -0.02, -0.01, 0.0, 0.0, 0.0, 0.0].iter().map(|k| k * rows).collect(),
        [0.42, 0.42, 0.42, 0.42, 0.44, 0.62, 0.92, 1.0, 0.985].iter().map(|k| k * d_full).collect(),
        vec![0.30, 0.30, 0.30, 0.30, 0.26, 0.12, 0.03, 0.0, 0.0], vec![-0.12, -0.12, -0.12, -0.10, -0.08, -0.03, 0.0, 0.0, 0.0],
        vec![0.0; 9], 3.0, 0.25, 0.4));
    simple_plan(m, p, &w, a, &key, cam, d_full, Simple { spin_amp: 2.2, tilt_amp: 1.6, kmul_rng: (0.55, 0.95), flight_frac: 0.16,
        window: (0.02, 0.60), pulse_phase: -PI / 2.0, opening: Some((0.12, 1.2, 0.12)) })
}

fn zoom(m: &MosaicIn, p: &VideoParams, ov: Option<Cam>) -> Plan {
    let w = world(m);
    let n = w.x.len();
    let mut rng = Rng::new(p.seed);
    let d_full = d_full_for(m, p);
    let cen = subject_centroid(&w);
    let (ww, rows, dur) = (m.world_w(), m.rows as f64, p.duration);
    let r: Vec<f64> = (0..n).map(|i| (w.x[i] - cen[0]).hypot(w.y[i] - cen[1])).collect();
    let rmax = r.iter().cloned().fold(1e-6, f64::max);
    let mut a = new_arrays(&w);
    let mut key = vec![0.0; n];
    for i in 0..n {
        key[i] = r[i] / rmax + rng.normal(0.0, 0.06);
        a.s[i] = add(a.e[i], [rng.normal(0.0, 0.05) * ww, rng.normal(0.0, 0.05) * rows, d_full * rng.uniform(0.08, 0.24)]);
        a.c[i] = add(mul(add(a.s[i], a.e[i]), 0.5), [rng.normal(0.0, 0.06) * ww, rng.normal(0.0, 0.06) * rows, d_full * rng.uniform(0.0, 0.15)]);
    }
    let wb = [0.0, 0.0, 0.0, 0.10, 0.30, 0.60, 0.90, 1.0, 1.0];
    let cam = ov.unwrap_or_else(|| path_camera(ww, rows, dur, p.seed, &[0.0, 0.10, 0.22, 0.34, 0.44, 0.54, 0.64, 0.76, 0.90],
        wb.iter().map(|b| (1.0 - b) * cen[0]).collect(), wb.iter().map(|b| (1.0 - b) * cen[1]).collect(),
        [0.17, 0.19, 0.23, 0.30, 0.46, 0.72, 0.94, 1.0, 0.985].iter().map(|k| k * d_full).collect(),
        vec![0.0; 9], vec![0.0; 9], vec![0.0; 9], -9.0, 0.0, 0.0));
    simple_plan(m, p, &w, a, &key, cam, d_full, Simple { spin_amp: 1.4, tilt_amp: 1.0, kmul_rng: (0.6, 1.0), flight_frac: 0.14,
        window: (0.0, 0.62), pulse_phase: 0.4, opening: Some((0.10, 1.2, 0.35)) })
}

/// Arrival window in seconds: the designed window (fractions of the video) stretched or squeezed, never past 0.75 of the video.
fn spread_window(p: &VideoParams, a: f64, b: f64) -> (f64, f64) {
    let t_a = a * p.duration;
    (t_a, (t_a + (b - a) * p.duration * p.arrival_spread).min(0.75 * p.duration).max(t_a + 0.05 * p.duration))
}

/// The user's own camera path, built from their keyframes. Always lands on the full picture at the end.
fn user_camera(m: &MosaicIn, p: &VideoParams) -> Option<Cam> {
    let mut k: Vec<[f64; 7]> = p.cam_keys.chunks_exact(7).filter(|c| c.iter().all(|v| v.is_finite()))
        .map(|c| [c[0].clamp(0.0, 0.85), c[1].clamp(0.1, 3.0), c[2].clamp(-0.5, 0.5), c[3].clamp(-0.5, 0.5), c[4].clamp(-180.0, 180.0), c[5].clamp(-80.0, 80.0), c[6].clamp(-45.0, 45.0)]).collect();
    if k.is_empty() { return None; }
    k.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
    k[0][0] = 0.0;
    let mut kept: Vec<[f64; 7]> = vec![k[0]];
    for c in &k[1..] { if c[0] >= kept.last().unwrap()[0] + 0.03 && c[0] <= 0.85 { kept.push(*c); } }
    let (ww, rows, d_full) = (m.world_w(), m.rows as f64, d_full_for(m, p));
    let mut kt: Vec<f64> = kept.iter().map(|c| c[0]).collect();
    let mut tx: Vec<f64> = kept.iter().map(|c| c[2] * ww).collect();
    let mut ty: Vec<f64> = kept.iter().map(|c| c[3] * rows).collect();
    let mut dist: Vec<f64> = kept.iter().map(|c| c[1] * d_full).collect();
    let mut yaw: Vec<f64> = kept.iter().map(|c| c[4].to_radians()).collect();
    let mut pitch: Vec<f64> = kept.iter().map(|c| c[5].to_radians()).collect();
    let mut roll: Vec<f64> = kept.iter().map(|c| c[6].to_radians()).collect();
    for (t, d) in [(0.92, 1.0), (1.0, 0.985)] {
        kt.push(t); tx.push(0.0); ty.push(0.0); dist.push(d * d_full); yaw.push(0.0); pitch.push(0.0); roll.push(0.0);
    }
    Some(path_camera(ww, rows, p.duration, p.seed, &kt, tx, ty, dist, yaw, pitch, roll, 0.0, 1.0, 0.25))
}

pub fn make_plan(m: &MosaicIn, p: &VideoParams) -> Plan {
    let ov = user_camera(m, p);
    let mut plan = match p.style { 1 => vortex(m, p, ov), 2 => wave(m, p, ov), 3 => zoom(m, p, ov), _ => swarm(m, p, ov) };
    plan.cam.motion = p.camera_motion;
    restyle(&mut plan, m, p);
    plan
}

/// User-chosen entry direction, build order and flight curve, applied on top of the style's own design.
/// Showcase tiles are left alone (their flight is tied to the camera). With the defaults this changes nothing.
fn restyle(plan: &mut Plan, m: &MosaicIn, p: &VideoParams) {
    if p.entry == 0 && p.order == 0 && (p.arc - 1.0).abs() < 1e-9 { return; }
    let (ww, rows, df) = (m.world_w(), m.rows as f64, plan.d_full);
    let mut rng = Rng::new(p.seed + 31);
    let n = plan.n;
    let hero = |inst: &[f32], i: usize| inst[i * N_COLS + 17] >= 1.0;
    // entry direction and flight curve
    for i in 0..n {
        if hero(&plan.inst, i) { continue; }
        let r = &mut plan.inst[i * N_COLS..(i + 1) * N_COLS];
        let e = [r[0] as f64, r[1] as f64, 0.0];
        let mut s = [r[4] as f64, r[5] as f64, r[6] as f64];
        let mut c = [r[18] as f64, r[19] as f64, r[20] as f64];
        if p.entry != 0 {
            s = match p.entry {
                1 => { let mut d = [rng.normal(0.0, 1.0), rng.normal(0.0, 1.0), rng.normal(0.0, 1.0)]; d[2] = d[2].abs() * 0.8 + 0.15; add(e, mul(unit(d), df * rng.uniform(0.30, 0.9))) }
                2 => [e[0] + rng.normal(0.0, 0.08) * ww, e[1] + rng.uniform(0.6, 1.0) * rows, df * rng.uniform(0.05, 0.4)],
                3 => [e[0] + rng.normal(0.0, 0.08) * ww, e[1] - rng.uniform(0.6, 1.0) * rows, df * rng.uniform(0.05, 0.4)],
                4 => [e[0] + rng.sign() * rng.uniform(0.6, 1.0) * ww, e[1] + rng.normal(0.0, 0.08) * rows, df * rng.uniform(0.05, 0.4)],
                5 => [rng.normal(0.0, 0.03) * ww, rng.normal(0.0, 0.03) * rows, df * rng.uniform(0.2, 0.5)],
                _ => [e[0] + rng.normal(0.0, 0.1) * ww, e[1] + rng.normal(0.0, 0.1) * rows, df * rng.uniform(0.8, 1.3)],
            };
            let off = unit([rng.normal(0.0, 1.0), rng.normal(0.0, 1.0), rng.normal(0.0, 1.0)]);
            let l = norm(sub(s, e)) * rng.uniform(0.08, 0.30);
            c = add(mul(add(s, e), 0.5), mul(off, 2.0 * l));
        }
        let mid = mul(add(s, e), 0.5);
        c = add(mid, mul(sub(c, mid), p.arc));
        for k in 0..3 { r[4 + k] = s[k] as f32; r[18 + k] = c[k] as f32; }
    }
    // build order: hand the same arrival times to the tiles in a different sequence
    if p.order != 0 {
        let idx: Vec<usize> = (0..n).filter(|&i| !hero(&plan.inst, i)).collect();
        let mut slots: Vec<f32> = idx.iter().map(|&i| plan.inst[i * N_COLS + 8]).collect();
        slots.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let luma = |t: usize| -> f64 {
            if m.n_tiles == 0 { return 0.0; }
            let t = t.min(m.n_tiles - 1);
            m.tile_rgb4[t * 48..(t + 1) * 48].chunks_exact(3).map(|q| 0.299 * q[0] as f64 + 0.587 * q[1] as f64 + 0.114 * q[2] as f64).sum::<f64>() / 16.0
        };
        let mut keyed: Vec<(f64, usize)> = idx.iter().map(|&i| {
            let r = &plan.inst[i * N_COLS..(i + 1) * N_COLS];
            let (x, y) = (r[0] as f64, r[1] as f64);
            let k = match p.order {
                1 => rng.uniform(0.0, 1.0),
                2 => (x / ww.max(1e-6)).hypot(y / rows.max(1e-6)),
                3 => -(x / ww.max(1e-6)).hypot(y / rows.max(1e-6)),
                4 => x,
                5 => -y,
                6 => luma(r[3] as usize),
                _ => -luma(r[3] as usize),
            };
            (k + rng.uniform(0.0, 1e-4), i)
        }).collect();
        keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        for (slot, &(_, i)) in slots.iter().zip(&keyed) { plan.inst[i * N_COLS + 8] = *slot; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(cols: usize, rows: usize, t: usize) -> (Vec<f32>, Vec<u8>) {
        let mut cells = vec![];
        for y in 0..rows { for x in 0..cols {
            cells.extend_from_slice(&[x as f32, y as f32, 1.0, ((x + y * cols) % t) as f32, 0.0, 1.0, -1.0, 0.5, 0.3]);
        } }
        (cells, (0..t * 48).map(|i| (i * 7 % 256) as u8).collect())
    }

    fn params(style: u8) -> VideoParams {
        VideoParams { style, duration: 12.0, aspect: 9.0 / 16.0, tile_ratio: 1.0, hero_tiles: 6, hero_size: 0.38,
            flight_scale: 1.7, pulses: 4.0, pulse_depth: 0.55, frame_margin: 0.8, seed: 7, tint: true,
            flight_speed: 1.0, arrival_spread: 1.0, camera_motion: 1.0, spin: 1.0, reveal_time: 0.78, entry: 0, order: 0, arc: 1.0, cam_keys: vec![] }
    }

    #[test]
    fn custom_camera_makes_valid_plans() {
        let (cells, rgb4) = fixture(20, 28, 90);
        let m = MosaicIn { cols: 20, rows: 28, ratio: 1.0, cells: &cells, tile_rgb4: &rgb4, n_tiles: 90 };
        let sets: [Vec<f64>; 4] = [
            vec![0.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0],
            vec![0.0, 1.8, 0.0, 0.0, 40.0, 30.0, 5.0, 0.4, 0.6, 0.2, -0.1, -30.0, 10.0, -5.0],
            vec![0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 1.0, 9.0, 9.0, 999.0, 99.0, 99.0],
            vec![f64::NAN; 7],
        ];
        for style in 0..4 {
            for keys in &sets {
                let mut p = params(style);
                p.cam_keys = keys.clone();
                let pl = make_plan(&m, &p);
                assert!(pl.inst.iter().all(|v| v.is_finite()), "style {style}");
                let (eye, tg, _) = pl.cam.camera(12.0);
                assert!((norm(sub(eye, tg)) - pl.d_full).abs() < pl.d_full * 0.1, "camera ends on the full frame");
            }
        }
    }

    #[test]
    fn entry_order_and_arc_choices_make_valid_plans() {
        let (cells, rgb4) = fixture(20, 28, 90);
        let m = MosaicIn { cols: 20, rows: 28, ratio: 1.0, cells: &cells, tile_rgb4: &rgb4, n_tiles: 90 };
        for style in 0..4 {
            let base = make_plan(&m, &params(style));
            for entry in 0..7u8 { for order in 0..8u8 { for arc in [0.0, 1.0, 2.0] {
                let mut p = params(style);
                p.entry = entry; p.order = order; p.arc = arc;
                let pl = make_plan(&m, &p);
                assert!(pl.inst.iter().all(|v| v.is_finite()), "style {style} entry {entry} order {order} arc {arc}");
                // showcase tiles and the overall set of arrival times are untouched by the order
                let mut a: Vec<f32> = base.inst.chunks_exact(N_COLS).map(|r| r[8]).collect();
                let mut b: Vec<f32> = pl.inst.chunks_exact(N_COLS).map(|r| r[8]).collect();
                a.sort_by(|x, y| x.partial_cmp(y).unwrap()); b.sort_by(|x, y| x.partial_cmp(y).unwrap());
                assert_eq!(a, b);
            } } }
        }
    }

    #[test]
    fn pchip_hits_knots_and_is_monotone() {
        let x = [0.0, 1.0, 2.0, 4.0, 5.0];
        let y = [0.0, 1.0, 1.5, 4.0, 4.2];
        let p = Pchip::new(&x, &y);
        for i in 0..5 { assert!((p.eval(x[i]) - y[i]).abs() < 1e-9); }
        let mut last = -1.0;
        for k in 0..=100 { let v = p.eval(k as f64 * 0.05); assert!(v >= last - 1e-9); last = v; }
    }

    #[test]
    fn all_styles_make_valid_plans() {
        let (cells, rgb4) = fixture(20, 28, 90);
        let m = MosaicIn { cols: 20, rows: 28, ratio: 1.0, cells: &cells, tile_rgb4: &rgb4, n_tiles: 90 };
        for style in 0..4 {
            let pl = make_plan(&m, &params(style));
            assert_eq!(pl.inst.len(), 560 * N_COLS);
            assert!(pl.inst.iter().all(|v| v.is_finite()), "style {style} has NaN/inf");
            // every tile lands within the video, with a positive flight time
            for r in pl.inst.chunks_exact(N_COLS) { assert!(r[9] > 0.0 && r[8] + r[9] <= 12.0 * 1.01 + 1.0, "style {style}: {} + {}", r[8], r[9]); }
            let heroes = pl.inst.chunks_exact(N_COLS).filter(|r| r[17] >= 1.0).count();
            assert!(heroes > 0 && heroes <= 6, "style {style}: {heroes} showcase tiles");
            let (eye, tg, _) = pl.cam.camera(12.0);
            assert!((norm(sub(eye, tg)) - pl.d_full).abs() < pl.d_full * 0.1, "camera ends on the full frame");
        }
    }
}
