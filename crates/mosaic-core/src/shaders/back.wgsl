// Video background: blurred photo glow (mode 0), solid colour (1) or two-colour gradient (2), with vignette,
// two drifting colour lights and dither (BACK_VS/FS).
struct BU {
    bg: vec4<f32>, accent: vec4<f32>, accent2: vec4<f32>,
    p: vec4<f32>,    // amt, shift.x, shift.y, time
    res: vec4<f32>,  // w, h
    bg2: vec4<f32>,  // second colour rgb, mode (0 photo, 1 solid, 2 gradient)
    ex: vec4<f32>,   // vignette, lights, photo amount, 0
};
@group(0) @binding(0) var<uniform> u: BU;
@group(1) @binding(0) var blur_tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
    var q = array<vec2<f32>, 4>(vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5));
    var o: VOut;
    o.pos = vec4(q[vi] * 2.0, 0.5, 1.0);
    o.uv = q[vi] + 0.5;
    return o;
}
fn hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

@fragment fn fs(v: VOut) -> @location(0) vec4<f32> {
    let time = u.p.w;
    let mode = u.bg2.w;
    let vigk = u.ex.x; let lightk = u.ex.y; let amount = u.ex.z;
    let col = textureSample(blur_tex, samp, (v.uv - 0.5) / 1.3 + 0.5 + u.p.yz).rgb;   // sampled outside any branch (needs uniform flow)
    let q = (v.uv - 0.5) * vec2(1.0, 1.1);
    let r = length(q);
    let vig = mix(1.0 - vigk, 1.0, smoothstep(0.9, 0.1, r));
    let c1 = vec2(0.28 + 0.10 * sin(time * 0.31), 0.22 + 0.08 * cos(time * 0.23));
    let c2 = vec2(0.74 + 0.09 * cos(time * 0.27), 0.80 + 0.07 * sin(time * 0.35));
    let b1 = exp(-dot(v.uv - c1, v.uv - c1) * 7.0);
    let b2 = exp(-dot(v.uv - c2, v.uv - c2) * 7.0);
    let lights = (u.accent.rgb * (0.22 * exp(-r * r * 4.0) + 0.20 * b1) + u.accent2.rgb * 0.13 * b2) * lightk;
    var base: vec3<f32>;
    if (mode < 0.5) {
        // blurred photo; the background colour fills the vignette edges and tints the whole backdrop
        base = col * amount * vig + u.bg.rgb * ((1.0 - vig) * 1.4 + 0.35);
    } else if (mode < 1.5) {
        base = u.bg.rgb * mix(0.55, 1.0, vig);
    } else {
        // colour 1 at the top, colour 2 at the bottom, leaning slightly sideways
        let t = smoothstep(0.0, 1.0, clamp(v.uv.y * 0.85 + (v.uv.x - 0.5) * 0.15 + 0.075, 0.0, 1.0));
        base = mix(u.bg2.rgb, u.bg.rgb, t) * mix(0.55, 1.0, vig);
    }
    let back = base + lights;
    var o = mix(u.bg.rgb, back, u.p.x);
    o += (hash(v.uv * u.res.xy + fract(time)) - 0.5) * (5.0 / 255.0);
    return vec4(o, 1.0);
}
