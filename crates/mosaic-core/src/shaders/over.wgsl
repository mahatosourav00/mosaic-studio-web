// Main-picture overlay + light sweep (OVER_VS/FS).
struct OU { vp: mat4x4<f32>, p: vec4<f32> };   // p = size.x, size.y, ramp, shine
@group(0) @binding(0) var<uniform> u: OU;
@group(1) @binding(0) var main_tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
    var q = array<vec2<f32>, 4>(vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5));
    let in_vert = q[vi];
    var o: VOut;
    o.pos = u.vp * vec4(in_vert * u.p.xy, 0.05, 1.0);
    o.uv = vec2(in_vert.x + 0.5, 0.5 - in_vert.y);
    return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4<f32> {
    let m = textureSample(main_tex, samp, v.uv);
    let a = m.a * u.p.z;
    let d = v.uv.x * 0.55 + v.uv.y * 0.45;
    let band = exp(-pow((d - u.p.w) / 0.05, 2.0));
    let rgb = mix(m.rgb, vec3(1.0), band * 0.7);
    return vec4(rgb, max(a, band * 0.30));
}
