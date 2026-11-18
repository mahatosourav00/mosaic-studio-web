// Soft drop shadow (mode 0) and accent glow + hairline rim (mode 1) behind the finished mosaic.
struct GU {
    vp: mat4x4<f32>,
    q: vec4<f32>,       // quad.x, quad.y, half.x, half.y
    accent: vec4<f32>,  // rgb, glow
    p: vec4<f32>,       // scale, mode, fade, 0
};
@group(0) @binding(0) var<uniform> u: GU;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) p: vec2<f32> };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
    var q = array<vec2<f32>, 4>(vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5));
    var o: VOut;
    let pp = q[vi] * u.q.xy;
    o.p = pp;
    o.pos = u.vp * vec4(pp, -0.08, 1.0);
    return o;
}
fn sdf(p: vec2<f32>) -> f32 {
    let q = abs(p) - u.q.zw;
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);
}
@fragment fn fs(v: VOut) -> @location(0) vec4<f32> {
    let scale = u.p.x; let fade = u.p.z; let glow = u.accent.w;
    if (u.p.y < 0.5) {
        let d = sdf(v.p + vec2(0.0, 0.018 * scale));
        let a = 0.75 * exp(-max(d, 0.0) / (0.05 * scale));
        return vec4(0.0, 0.0, 0.0, a * fade);
    }
    let d = sdf(v.p);
    let g = exp(-max(d, 0.0) / (0.14 * scale)) * step(0.0, d);
    let rim = exp(-pow((d - 0.004 * scale) / (0.0035 * scale), 2.0));
    let c = u.accent.rgb * 1.15 * g * glow + vec3(1.0, 0.95, 0.88) * rim * 0.60 * glow;
    return vec4(c * fade, 1.0);
}
