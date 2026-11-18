// Drifting dust / bokeh particles (PART_VS/FS); motion is analytic in the shader.
struct PU {
    vp: mat4x4<f32>,
    right: vec4<f32>, up: vec4<f32>,
    p: vec4<f32>,      // time, bxy.x, bxy.y, shine
    q: vec4<f32>,      // mos.x, mos.y, amt, 0
    color: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: PU;
struct VIn { @builtin(vertex_index) vi: u32, @location(0) p_a: vec4<f32>, @location(1) p_b: vec4<f32> };
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) q: vec2<f32>, @location(1) a: f32 };

@vertex fn vs(v: VIn) -> VOut {
    var qd = array<vec2<f32>, 4>(vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5));
    let in_vert = qd[v.vi];
    let time = u.p.x; let bxy = u.p.yz; let shine = u.p.w;
    let yy = v.p_a.y + v.p_b.x * time + bxy.y;
    let y = yy - 2.0 * bxy.y * floor(yy / (2.0 * bxy.y)) - bxy.y;   // GLSL mod(), not WGSL's truncated %
    let x = v.p_a.x + v.p_b.z * sin(time * 0.35 + v.p_b.y);
    let c = vec3(x, y, v.p_a.z);
    let w = c + (u.right.xyz * in_vert.x + u.up.xyz * in_vert.y) * v.p_a.w;
    var o: VOut;
    o.pos = u.vp * vec4(w, 1.0);
    o.q = in_vert * 2.0;
    let tw = 0.55 + 0.45 * sin(time * 1.3 + v.p_b.y * 5.0);
    let uvm = vec2(x / u.q.x + 0.5, 0.5 - y / u.q.y);
    let band = exp(-pow((uvm.x * 0.55 + uvm.y * 0.45 - shine) / 0.08, 2.0));
    let t = (y + bxy.y) / (2.0 * bxy.y);
    let edge = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);
    o.a = u.q.z * tw * (0.75 + 2.5 * band) * v.p_b.w * edge;
    return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4<f32> {
    let r = length(v.q);
    let disc = smoothstep(1.0, 0.92, r);
    let rim = 0.55 + 0.9 * smoothstep(0.45, 0.95, r);
    let core = pow(smoothstep(1.0, 0.0, r), 3.0);
    let a = 0.5 * core + 0.5 * disc * rim * 0.55;
    return vec4(u.color.rgb, a * v.a);
}
