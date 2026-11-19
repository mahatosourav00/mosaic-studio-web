// Instanced flying tiles: bezier flight, spin/tilt, depth of field + fog. Port of TILE_VS / TILE_FS.
// NOTE: every uniform struct is a multiple of 16 bytes (WebGL2 requirement).
struct TU {
    vp: mat4x4<f32>,
    eye: vec4<f32>,
    fwd: vec4<f32>,
    bgc: vec4<f32>,
    a: vec4<f32>,   // time, gap, ratio, focus
    b: vec4<f32>,   // dof, landing curve, landing flash, showcase dwell
};
@group(0) @binding(0) var<uniform> u: TU;
@group(1) @binding(0) var tiles: texture_2d_array<f32>;
@group(1) @binding(1) var hero: texture_2d_array<f32>;
@group(1) @binding(2) var samp: sampler;
@group(1) @binding(3) var samp_hero: sampler;   // separate sampler per texture: the WebGL2 backend mixes up shared ones

struct VIn {
    @builtin(vertex_index) vi: u32,
    @location(0) i_end: vec4<f32>,
    @location(1) i_start: vec4<f32>,
    @location(2) i_time: vec4<f32>,
    @location(3) i_off: vec3<f32>,
    @location(4) i_ext: vec3<f32>,
    @location(5) i_mid: vec3<f32>,
};
struct VOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) off: vec3<f32>,
    @location(2) alpha: f32,
    @location(3) light: f32,
    @location(4) blur: f32,
    @location(5) fog: f32,
    @location(6) @interpolate(flat) hero: f32,
    @location(7) @interpolate(flat) layer: f32,
};

@vertex fn vs(v: VIn) -> VOut {
    var q = array<vec2<f32>, 4>(vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5));
    let in_vert = q[v.vi];
    let time = u.a.x; let gap = u.a.y; let ratio = u.a.z; let focus = u.a.w; let dof = u.b.x;
    var o: VOut;
    o.layer = v.i_end.w;
    if (time < v.i_time.x) {
        o.pos = vec4(2.0, 2.0, 2.0, 1.0);
        o.uv = vec2(0.0); o.off = vec3(0.0); o.alpha = 0.0; o.light = 1.0; o.blur = 0.0; o.fog = 0.0; o.hero = -1.0;
        return o;
    }
    let is_hero = v.i_ext.z >= 0.5;
    o.hero = select(-1.0, v.i_ext.z - 1.0, is_hero);
    let p = clamp((time - v.i_time.x) / v.i_time.y, 0.0, 1.0);
    let pp = p + u.b.w * sin(6.2831853 * p) / 6.2831853;         // showcase photos dwell in the middle
    var en = 1.0 - pow(1.0 - p, 3.0);                            // 0: glide in and settle
    let em = i32(u.b.y + 0.5);
    if (em == 1) { en = p * p * (3.0 - 2.0 * p); }               // smooth: gentle start and end
    else if (em == 2) { let q = p - 1.0; en = 1.0 + 3.2 * q * q * q + 2.2 * q * q; }   // overshoot and settle back
    else if (em == 3) { en = 1.0 - pow(1.0 - p, 5.0); }          // snap: fast then sudden stop
    else if (em == 4) { en = p; }                                // steady
    let e = select(en, pp * pp * (3.0 - 2.0 * pp), is_hero);
    let E = vec3(v.i_end.xy, 0.0);
    let pos = (1.0 - e) * (1.0 - e) * v.i_start.xyz + 2.0 * (1.0 - e) * e * v.i_mid + e * e * E;
    let ang = v.i_start.w * (1.0 - e);
    let tilt = v.i_time.w * (1.0 - e);
    let sc = mix(v.i_ext.x, 1.0, smoothstep(v.i_ext.y, 1.0, p));
    let side = max(v.i_end.z - gap * select(0.5, 1.0, v.i_end.z >= 0.99), 0.02);
    var l = vec3(in_vert * vec2(ratio, 1.0) * side * sc, 0.0);
    let ct = cos(tilt); let st = sin(tilt);
    l = vec3(ct * l.x + st * l.z, l.y, -st * l.x + ct * l.z);
    let ca = cos(ang); let sa = sin(ang);
    l = vec3(ca * l.x - sa * l.y, sa * l.x + ca * l.y, l.z);
    let wp = pos + l;
    o.pos = u.vp * vec4(wp, 1.0);
    var vx = in_vert.x + 0.5;
    if (v.i_time.z > 0.5) { vx = 1.0 - vx; }
    o.uv = vec2(vx, 0.5 - in_vert.y);
    o.off = v.i_off;
    o.alpha = smoothstep(0.0, 0.2, p);
    let ts = time - (v.i_time.x + v.i_time.y);
    o.light = 1.0 + select(0.0, 0.35 * u.b.z * exp(-ts * 6.0), ts > 0.0);
    let depth = dot(wp - u.eye.xyz, u.fwd.xyz);
    let offd = abs(depth - focus) / focus;
    o.blur = select(clamp((offd - 0.10) * 2.0, 0.0, 1.0) * 2.6 * dof, 0.0, is_hero);
    o.fog = select(clamp((depth - focus) / (focus * 0.9), 0.0, 1.0) * 0.55 * dof, 0.0, is_hero);
    return o;
}

@fragment fn fs(v: VOut) -> @location(0) vec4<f32> {
    if (v.alpha < 0.02) { discard; }
    var c: vec3<f32>;
    if (v.hero > -0.5) {
        c = textureSampleLevel(hero, samp_hero, v.uv, i32(v.hero + 0.5), 0.0).rgb;       // sharp hi-res showcase photo
    } else {
        c = textureSampleLevel(tiles, samp, v.uv, i32(v.layer + 0.5) & 255, v.blur + 0.5).rgb;
    }
    c = clamp((c + v.off) * v.light, vec3(0.0), vec3(1.0));
    return vec4(mix(c, u.bgc.rgb, v.fog), v.alpha);
}
