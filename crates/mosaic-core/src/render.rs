//! wgpu renderer for the assembly animation: backdrop -> shadow/glow -> tiles -> main overlay -> particles.
//! Port of `mosaicvid/render_gl.py` (the GLSL became WGSL in `shaders/`). WebGPU first, WebGL2 fallback.
//! All uniform structs are padded to 16-byte multiples (WebGL2 requirement). Tile textures live in pages of
//! at most 256 layers (the array-layer limit on both backends); instances are sorted by page.

use crate::animation::{self, MosaicIn, Plan, VideoParams};
use crate::rng::Rng;
use wasm_bindgen::prelude::*;

const PAGE: usize = 256;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const INST_STRIDE: u64 = (animation::N_COLS * 4) as u64;

type M4 = [[f32; 4]; 4];

fn mat_mul(a: &M4, b: &M4) -> M4 {
    let mut o = [[0f32; 4]; 4];
    for i in 0..4 { for j in 0..4 { for k in 0..4 { o[i][j] += a[i][k] * b[k][j]; } } }
    o
}
/// Row-major matrix -> the 16 floats WGSL expects (column-major memory).
fn flat(m: &M4) -> [f32; 16] {
    let mut f = [0f32; 16];
    for c in 0..4 { for r in 0..4 { f[c * 4 + r] = m[r][c]; } }
    f
}
fn perspective(fov_deg: f64, aspect: f64, near: f64, far: f64) -> M4 {
    let f = 1.0 / (fov_deg.to_radians() / 2.0).tan();
    let mut m = [[0f32; 4]; 4];
    m[0][0] = (f / aspect) as f32; m[1][1] = f as f32;
    m[2][2] = (far / (near - far)) as f32;           // wgpu clip space: depth 0..1
    m[2][3] = (near * far / (near - far)) as f32;
    m[3][2] = -1.0;
    m
}
fn look_at(eye: [f64; 3], target: [f64; 3], roll: f64) -> (M4, [f64; 3], [f64; 3], [f64; 3]) {
    let (f, r, u) = animation::basis(eye, target, roll);
    let dotv = |a: [f64; 3]| a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
    let m = [[r[0] as f32, r[1] as f32, r[2] as f32, -dotv(r) as f32],
             [u[0] as f32, u[1] as f32, u[2] as f32, -dotv(u) as f32],
             [-f[0] as f32, -f[1] as f32, -f[2] as f32, dotv(f) as f32],
             [0.0, 0.0, 0.0, 1.0]];
    (m, f, r, u)
}
fn smooth(a: f64, b: f64, x: f64) -> f64 { let u = ((x - a) / (b - a)).clamp(0.0, 1.0); u * u * (3.0 - 2.0 * u) }

// ---------------------------------------------------------------- colour helpers (accent from the main picture)
fn rgb_to_hsv(r: f32, g: f32, b: f32) -> [f32; 3] {
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let d = mx - mn;
    let h = if d < 1e-6 { 0.0 } else if mx == r { 60.0 * (((g - b) / d) % 6.0) } else if mx == g { 60.0 * ((b - r) / d + 2.0) } else { 60.0 * ((r - g) / d + 4.0) };
    [(h + 360.0) % 360.0, if mx < 1e-6 { 0.0 } else { d / mx }, mx]
}
fn hsv_to_rgb(h: f32, s: f32, v: f32) -> [f32; 3] {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;
    let (r, g, b) = match (h / 60.0) as i32 % 6 { 0 => (c, x, 0.0), 1 => (x, c, 0.0), 2 => (0.0, c, x), 3 => (0.0, x, c), 4 => (x, 0.0, c), _ => (c, 0.0, x) };
    [r + m, g + m, b + m]
}
fn accent_of(rgb: &[u8]) -> ([f32; 3], [f32; 3]) {
    let hsv: Vec<[f32; 3]> = rgb.chunks_exact(3).map(|p| rgb_to_hsv(p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0)).collect();
    let sel: Vec<&[f32; 3]> = hsv.iter().filter(|h| h[1] > 70.0 / 255.0 && h[2] > 90.0 / 255.0).collect();
    let pool: Vec<&[f32; 3]> = if sel.len() > 20 { sel } else { hsv.iter().collect() };
    let n = pool.len().max(1) as f32;
    let mut h = [0f32; 3];
    for p in &pool { for k in 0..3 { h[k] += p[k] / n; } }
    h[1] = h[1].clamp(90.0 / 255.0, 200.0 / 255.0);
    h[2] = h[2].max(190.0 / 255.0);
    (hsv_to_rgb(h[0], h[1], h[2]), hsv_to_rgb((h[0] + 150.0) % 360.0, h[1], h[2]))
}

/// Blur (sigma ~4 px, separable) then lift dark photos to a rich mid-dark tone, as in the Python renderer.
fn backdrop_rgba(rgb: &[u8], w: usize, h: usize) -> Vec<u8> {
    let sigma = 4.0f32;
    let rad = 12i32;
    let k: Vec<f32> = (-rad..=rad).map(|i| (-(i * i) as f32 / (2.0 * sigma * sigma)).exp()).collect();
    let ks: f32 = k.iter().sum();
    let src: Vec<f32> = rgb.iter().map(|&v| v as f32 / 255.0).collect();
    let pass = |inp: &[f32], horiz: bool| -> Vec<f32> {
        let mut o = vec![0f32; inp.len()];
        for y in 0..h as i32 { for x in 0..w as i32 { for c in 0..3 {
            let mut a = 0f32;
            for (ki, kv) in k.iter().enumerate() {
                let d = ki as i32 - rad;
                let (xx, yy) = if horiz { ((x + d).clamp(0, w as i32 - 1), y) } else { (x, (y + d).clamp(0, h as i32 - 1)) };
                a += inp[((yy as usize) * w + xx as usize) * 3 + c] * kv;
            }
            o[((y as usize) * w + x as usize) * 3 + c] = a / ks;
        } } }
        o
    };
    let b = pass(&pass(&src, true), false);
    let gray: Vec<f32> = b.chunks_exact(3).map(|p| 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]).collect();
    let lum = gray.iter().sum::<f32>() / gray.len().max(1) as f32;
    let gain = (0.42 / lum.max(1e-3)).clamp(0.5, 3.5);
    let mut out = Vec::with_capacity(w * h * 4);
    for (i, p) in b.chunks_exact(3).enumerate() {
        for c in 0..3 { out.push(((gray[i] + (p[c] - gray[i]) * 1.6).clamp(0.0, 1.0) * gain).clamp(0.0, 0.75) * 255.0); }
        out.push(255.0);
    }
    out.iter().map(|&v| v as u8).collect()
}

/// Box-filter mip chain: level 0 is `data` (layers laid out one after another). Returns (w, h, bytes) per level.
fn mip_chain(data: &[u8], w: usize, h: usize, layers: usize) -> Vec<(usize, usize, Vec<u8>)> {
    let mut levels = vec![(w, h, data.to_vec())];
    while levels.last().map(|l| l.0 > 1 || l.1 > 1).unwrap_or(false) {
        let (pw, ph, prev) = levels.last().unwrap();
        let (nw, nh) = ((*pw / 2).max(1), (*ph / 2).max(1));
        let mut out = vec![0u8; nw * nh * 4 * layers];
        for l in 0..layers {
            for y in 0..nh { for x in 0..nw {
                let mut acc = [0u32; 4];
                for dy in 0..2 { for dx in 0..2 {
                    let (sx, sy) = ((x * 2 + dx).min(pw - 1), (y * 2 + dy).min(ph - 1));
                    let i = ((l * ph + sy) * pw + sx) * 4;
                    for c in 0..4 { acc[c] += prev[i + c] as u32; }
                } }
                let o = ((l * nh + y) * nw + x) * 4;
                for c in 0..4 { out[o + c] = ((acc[c] + 2) / 4) as u8; }
            } }
        }
        levels.push((nw, nh, out));
    }
    levels
}

fn upload(device: &wgpu::Device, queue: &wgpu::Queue, label: &str, data: &[u8], w: usize, h: usize, layers: usize, mips: bool) -> wgpu::Texture {
    // wgpu's GL backend mistakes a 2D array whose layer count is a multiple of 6 for a cube map: never allocate one
    let alloc_layers = if layers > 1 && layers % 6 == 0 { layers + 1 } else { layers };
    let mut levels = mip_chain(data, w, h, layers);
    if !mips { levels.truncate(1); }
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label), size: wgpu::Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: alloc_layers as u32 },
        mip_level_count: levels.len() as u32, sample_count: 1, dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm, usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    for (i, (lw, lh, bytes)) in levels.iter().enumerate() {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: i as u32, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            bytes,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some((*lw * 4) as u32), rows_per_image: Some(*lh as u32) },
            wgpu::Extent3d { width: *lw as u32, height: *lh as u32, depth_or_array_layers: layers as u32 });
    }
    tex
}

struct Opts {
    dur: f64, dof: f32, glow: f32, n_particles: usize, backdrop: bool, gap: f32, bg: [f32; 3],
}

struct Scene {
    plan: Plan,
    opts: Opts,
    world_w: f32,
    rows: f32,
    tile_ratio: f32,
    inst: wgpu::Buffer,
    ranges: Vec<(u32, u32, u32)>,   // (page, first instance, count)
}

#[wasm_bindgen]
pub struct Renderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    samples: u32,
    msaa: Option<wgpu::TextureView>,
    depth: wgpu::TextureView,
    backend: String,
    adapter_name: String,
    max_tex: u32,
    max_layers: u32,
    mips: bool,
    // pipelines + layouts
    p_tile: wgpu::RenderPipeline, p_over: wgpu::RenderPipeline, p_back: wgpu::RenderPipeline,
    p_glow: wgpu::RenderPipeline, p_shadow: wgpu::RenderPipeline, p_part: wgpu::RenderPipeline,
    bgl_tiles: wgpu::BindGroupLayout, bgl_tex1: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    sampler_hero: wgpu::Sampler,
    // uniforms
    u_tile: wgpu::Buffer, g_tile: wgpu::BindGroup,
    u_over: wgpu::Buffer, g_over: wgpu::BindGroup,
    u_back: wgpu::Buffer, g_back: wgpu::BindGroup,
    u_glow: [wgpu::Buffer; 2], g_glow: [wgpu::BindGroup; 2],
    u_part: wgpu::Buffer, g_part: wgpu::BindGroup,
    // textures
    pages: Vec<wgpu::Texture>,
    hero: wgpu::Texture,
    page_groups: Vec<wgpu::BindGroup>,
    main_group: Option<wgpu::BindGroup>,
    back_group: Option<wgpu::BindGroup>,
    particles: Option<(wgpu::Buffer, u32)>,
    accent: [f32; 3], accent2: [f32; 3],
    scene: Option<Scene>,
}

fn ubo(device: &wgpu::Device, size: u64, label: &str) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
}

fn target_views(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration, samples: u32) -> (Option<wgpu::TextureView>, wgpu::TextureView) {
    let size = wgpu::Extent3d { width: config.width, height: config.height, depth_or_array_layers: 1 };
    let mk = |format, usage| device.create_texture(&wgpu::TextureDescriptor {
        label: None, size, mip_level_count: 1, sample_count: samples, dimension: wgpu::TextureDimension::D2, format, usage, view_formats: &[] });
    let msaa = if samples > 1 { Some(mk(config.format, wgpu::TextureUsages::RENDER_ATTACHMENT).create_view(&Default::default())) } else { None };
    (msaa, mk(DEPTH, wgpu::TextureUsages::RENDER_ATTACHMENT).create_view(&Default::default()))
}

#[wasm_bindgen]
impl Renderer {
    /// `force_webgl` skips WebGPU (testing the fallback). `samples` is the wanted MSAA (4 is lowered to 1 if unsupported).
    pub async fn create(canvas: web_sys::HtmlCanvasElement, force_webgl: bool, want_samples: u32) -> Result<Renderer, JsError> {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = if force_webgl { wgpu::Backends::GL } else { wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL };
        let instance = wgpu::Instance::new(desc);
        let (w, h) = (canvas.width().max(1), canvas.height().max(1));
        let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas)).map_err(|e| JsError::new(&format!("surface: {e}")))?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance, compatible_surface: Some(&surface),
            force_fallback_adapter: false, ..Default::default() }).await.map_err(|e| JsError::new(&format!("no GPU adapter: {e}")))?;
        let info = adapter.get_info();
        let limits = if info.backend == wgpu::Backend::Gl { wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits()) } else { adapter.limits() };
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor { label: Some("mosaic"), required_limits: limits.clone(), ..Default::default() })
            .await.map_err(|e| JsError::new(&format!("device: {e}")))?;
        let mut config = surface.get_default_config(&adapter, w, h).ok_or_else(|| JsError::new("surface not supported by adapter"))?;
        config.present_mode = wgpu::PresentMode::Fifo;
        // the shaders work in plain (non-sRGB) values, like the desktop renderer: avoid a second gamma step
        if config.format.is_srgb() {
            let caps = surface.get_capabilities(&adapter);
            if let Some(f) = caps.formats.iter().find(|f| !f.is_srgb()) { config.format = *f; }
        }
        surface.configure(&device, &config);
        let fmt = config.format;
        let samples = if want_samples >= 4 && adapter.get_texture_format_features(fmt).flags.sample_count_supported(4)
            && adapter.get_texture_format_features(DEPTH).flags.sample_count_supported(4) { 4 } else { 1 };
        let (msaa, depth) = target_views(&device, &config, samples);

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, mipmap_filter: wgpu::MipmapFilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge, address_mode_v: wgpu::AddressMode::ClampToEdge, ..Default::default() });

        let sampler_hero = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, mipmap_filter: wgpu::MipmapFilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge, address_mode_v: wgpu::AddressMode::ClampToEdge, ..Default::default() });
        let bgl_u = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("u"), entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0, visibility: wgpu::ShaderStages::VERTEX_FRAGMENT, count: None,
            ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None } }] });
        let tex_entry = |binding, dim| wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, count: None,
            ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: dim, multisampled: false } };
        let samp_entry = |binding| wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, count: None,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering) };
        let bgl_tiles = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("tiles"),
            entries: &[tex_entry(0, wgpu::TextureViewDimension::D2Array), tex_entry(1, wgpu::TextureViewDimension::D2Array), samp_entry(2), samp_entry(3)] });
        let bgl_tex1 = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("tex1"),
            entries: &[tex_entry(0, wgpu::TextureViewDimension::D2), samp_entry(1)] });

        let shader = |label: &str, src: &str| device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(label), source: wgpu::ShaderSource::Wgsl(src.into()) });
        let m_tile = shader("tile", include_str!("shaders/tile.wgsl"));
        let m_over = shader("over", include_str!("shaders/over.wgsl"));
        let m_back = shader("back", include_str!("shaders/back.wgsl"));
        let m_glow = shader("glow", include_str!("shaders/glow.wgsl"));
        let m_part = shader("part", include_str!("shaders/part.wgsl"));

        let alpha = wgpu::BlendState { color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::SrcAlpha, dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha, operation: wgpu::BlendOperation::Add },
                                       alpha: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha, operation: wgpu::BlendOperation::Add } };
        let additive = wgpu::BlendState { color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::One, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
                                          alpha: wgpu::BlendComponent::OVER };
        let spark = wgpu::BlendState { color: wgpu::BlendComponent { src_factor: wgpu::BlendFactor::SrcAlpha, dst_factor: wgpu::BlendFactor::One, operation: wgpu::BlendOperation::Add },
                                       alpha: wgpu::BlendComponent::OVER };

        let inst_attrs = [
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 0 },
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 16, shader_location: 1 },
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 32, shader_location: 2 },
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 48, shader_location: 3 },
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 60, shader_location: 4 },
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 72, shader_location: 5 },
        ];
        let part_attrs = [
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 0 },
            wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 16, shader_location: 1 },
        ];
        let inst_layout = wgpu::VertexBufferLayout { array_stride: INST_STRIDE, step_mode: wgpu::VertexStepMode::Instance, attributes: &inst_attrs };
        let part_layout = wgpu::VertexBufferLayout { array_stride: 32, step_mode: wgpu::VertexStepMode::Instance, attributes: &part_attrs };

        let mk_pipe = |label: &str, module: &wgpu::ShaderModule, bgls: &[&wgpu::BindGroupLayout], bufs: &[Option<wgpu::VertexBufferLayout>],
                       blend: Option<wgpu::BlendState>, write: bool, cmp: wgpu::CompareFunction| {
            let layouts: Vec<Option<&wgpu::BindGroupLayout>> = bgls.iter().map(|b| Some(*b)).collect();
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some(label), bind_group_layouts: &layouts, immediate_size: 0 });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label), layout: Some(&layout),
                vertex: wgpu::VertexState { module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: bufs },
                fragment: Some(wgpu::FragmentState { module, entry_point: Some("fs"), compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState { format: fmt, blend, write_mask: wgpu::ColorWrites::ALL })] }),
                primitive: wgpu::PrimitiveState { topology: wgpu::PrimitiveTopology::TriangleStrip, ..Default::default() },
                depth_stencil: Some(wgpu::DepthStencilState { format: DEPTH, depth_write_enabled: Some(write), depth_compare: Some(cmp),
                    stencil: Default::default(), bias: Default::default() }),
                multisample: wgpu::MultisampleState { count: samples, mask: !0, alpha_to_coverage_enabled: false },
                multiview_mask: None, cache: None })
        };
        use wgpu::CompareFunction::{Always, LessEqual};
        let p_tile = mk_pipe("tile", &m_tile, &[&bgl_u, &bgl_tiles], &[Some(inst_layout)], Some(alpha), true, LessEqual);
        let p_over = mk_pipe("over", &m_over, &[&bgl_u, &bgl_tex1], &[], Some(alpha), false, Always);
        let p_back = mk_pipe("back", &m_back, &[&bgl_u, &bgl_tex1], &[], None, false, Always);
        let p_glow = mk_pipe("glow", &m_glow, &[&bgl_u], &[], Some(additive), false, Always);
        let p_shadow = mk_pipe("shadow", &m_glow, &[&bgl_u], &[], Some(alpha), false, Always);
        let p_part = mk_pipe("part", &m_part, &[&bgl_u], &[Some(part_layout)], Some(spark), false, Always);

        let mkg = |buf: &wgpu::Buffer| device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &bgl_u,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() }] });
        let (u_tile, u_over, u_back, u_part) = (ubo(&device, 144, "u_tile"), ubo(&device, 80, "u_over"), ubo(&device, 80, "u_back"), ubo(&device, 144, "u_part"));
        let u_glow = [ubo(&device, 112, "u_glow0"), ubo(&device, 112, "u_glow1")];
        let (g_tile, g_over, g_back, g_part) = (mkg(&u_tile), mkg(&u_over), mkg(&u_back), mkg(&u_part));
        let g_glow = [mkg(&u_glow[0]), mkg(&u_glow[1])];

        let hero = upload(&device, &queue, "hero", &[0u8; 4], 1, 1, 1, true);
        Ok(Renderer {
            surface, device, queue, config, samples, msaa, depth, backend: format!("{:?}", info.backend), adapter_name: info.name.clone(),
            max_tex: limits.max_texture_dimension_2d, max_layers: limits.max_texture_array_layers, mips: true,
            p_tile, p_over, p_back, p_glow, p_shadow, p_part, bgl_tiles, bgl_tex1, sampler, sampler_hero,
            u_tile, g_tile, u_over, g_over, u_back, g_back, u_glow, g_glow, u_part, g_part,
            pages: vec![], hero, page_groups: vec![], main_group: None, back_group: None, particles: None,
            accent: [0.6, 0.5, 1.0], accent2: [0.3, 0.76, 0.97], scene: None,
        })
    }

    pub fn backend(&self) -> String { self.backend.clone() }
    pub fn adapter_name(&self) -> String { self.adapter_name.clone() }
    pub fn max_texture_size(&self) -> u32 { self.max_tex }
    pub fn max_array_layers(&self) -> u32 { self.max_layers }
    pub fn samples(&self) -> u32 { self.samples }

    pub fn resize(&mut self, w: u32, h: u32) {
        self.config.width = w.max(1);
        self.config.height = h.max(1);
        self.surface.configure(&self.device, &self.config);
        let (m, d) = target_views(&self.device, &self.config, self.samples);
        self.msaa = m; self.depth = d;
    }

    /// Plan the animation. `cells` = cell part of solve_mosaic output; `tile_rgb4` = T x 48 bytes.
    /// `o` = [style, duration, video_aspect, hero_tiles, hero_size, flight_scale, pulses, pulse_depth, frame_margin, seed,
    ///        tint(0/1), dof, glow, particles, backdrop(0/1), gap_ratio, bg_r, bg_g, bg_b]  (bg in 0..1).
    /// Returns the tile ids of the showcase photos, in showcase order (supply their hi-res pictures to `set_heroes`).
    pub fn set_scene(&mut self, cells: &[f32], cols: u32, rows: u32, tile_ratio: f32, tile_rgb4: &[u8], o: &[f64]) -> Result<Vec<u32>, JsError> {
        if o.len() < 19 { return Err(JsError::new("scene options need 19 numbers")); }
        let n_tiles = tile_rgb4.len() / 48;
        let vp = VideoParams { style: o[0] as u8, duration: o[1], aspect: o[2], tile_ratio: tile_ratio as f64, hero_tiles: o[3] as usize,
            hero_size: o[4], flight_scale: o[5], pulses: o[6], pulse_depth: o[7], frame_margin: o[8], seed: o[9] as u64, tint: o[10] > 0.5 };
        let m = MosaicIn { cols: cols as usize, rows: rows as usize, ratio: tile_ratio as f64, cells, tile_rgb4, n_tiles };
        let plan = animation::make_plan(&m, &vp);
        let n = plan.n;
        // sort instances by tile page
        let mut idx: Vec<usize> = (0..n).collect();
        idx.sort_by_key(|&i| plan.inst[i * animation::N_COLS + 3] as usize / PAGE);
        let mut bytes: Vec<f32> = Vec::with_capacity(n * animation::N_COLS);
        for &i in &idx { bytes.extend_from_slice(&plan.inst[i * animation::N_COLS..(i + 1) * animation::N_COLS]); }
        let mut ranges: Vec<(u32, u32, u32)> = vec![];
        for (k, &i) in idx.iter().enumerate() {
            let pg = (plan.inst[i * animation::N_COLS + 3] as usize / PAGE) as u32;
            match ranges.last_mut() { Some(r) if r.0 == pg => r.2 += 1, _ => ranges.push((pg, k as u32, 1)) }
        }
        let inst = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("inst"), size: (bytes.len() * 4).max(4) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        self.queue.write_buffer(&inst, 0, bytemuck::cast_slice(&bytes));
        let mut heroes: Vec<(f32, u32)> = plan.inst.chunks_exact(animation::N_COLS).filter(|r| r[17] >= 1.0).map(|r| (r[17], r[3] as u32)).collect();
        heroes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let world_w = cols as f32 * tile_ratio;
        // particles (dust), static attributes; motion is analytic in the shader
        let n_p = o[13] as usize;
        self.particles = None;
        if n_p > 0 {
            let mut rng = Rng::new(vp.seed + 5);
            let (bx, by) = (world_w as f64 * 0.78, rows as f64 * 0.72);
            let mut d: Vec<f32> = Vec::with_capacity(n_p * 8);
            for _ in 0..n_p {
                d.extend_from_slice(&[rng.uniform(-bx, bx) as f32, rng.uniform(-by, by) as f32, (rng.uniform(-0.12, 0.25) * plan.d_full) as f32,
                    (rng.uniform(0.0022, 0.0085) * plan.d_full) as f32, (rng.uniform(0.04, 0.16) * (rows as f64 / 60.0)) as f32,
                    rng.uniform(0.0, 6.28) as f32, rng.uniform(0.2, 1.2) as f32, rng.uniform(0.35, 1.0) as f32]);
            }
            let buf = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("particles"), size: (d.len() * 4) as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
            self.queue.write_buffer(&buf, 0, bytemuck::cast_slice(&d));
            self.particles = Some((buf, n_p as u32));
        }
        self.scene = Some(Scene { plan, world_w, rows: rows as f32, tile_ratio, inst, ranges,
            opts: Opts { dur: o[1], dof: o[11] as f32, glow: o[12] as f32, n_particles: n_p, backdrop: o[14] > 0.5, gap: o[15] as f32,
                         bg: [o[16] as f32, o[17] as f32, o[18] as f32] } });
        Ok(heroes.into_iter().map(|h| h.1).collect())
    }

    fn rebuild_page_groups(&mut self) {
        let hv = self.hero.create_view(&wgpu::TextureViewDescriptor { dimension: Some(wgpu::TextureViewDimension::D2Array), ..Default::default() });
        self.page_groups = self.pages.iter().map(|p| {
            let tv = p.create_view(&wgpu::TextureViewDescriptor { dimension: Some(wgpu::TextureViewDimension::D2Array), ..Default::default() });
            self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("tiles"), layout: &self.bgl_tiles, entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&tv) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&hv) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(&self.sampler_hero) }] })
        }).collect();
    }

    /// Tile pictures: n tiles of w x h RGBA, tile id = position. Split into pages of 256 layers.
    pub fn set_tiles(&mut self, rgba: &[u8], w: u32, h: u32, n: u32) {
        let (w, h, n) = (w as usize, h as usize, n as usize);
        let per = w * h * 4;
        self.pages = (0..n.div_ceil(PAGE)).map(|p| {
            let (a, b) = (p * PAGE, ((p + 1) * PAGE).min(n));
            upload(&self.device, &self.queue, "tiles", &rgba[a * per..b * per], w, h, b - a, self.mips)
        }).collect();
        self.rebuild_page_groups();
    }

    /// Hi-res showcase pictures, in showcase order.
    pub fn set_heroes(&mut self, rgba: &[u8], w: u32, h: u32, n: u32) {
        let n = n.max(1) as usize;
        self.hero = upload(&self.device, &self.queue, "hero", rgba, w as usize, h as usize, n, self.mips);
        self.rebuild_page_groups();
    }

    /// Main picture (overlay) and its small blurred backdrop source. `blend` = overlay opacity 0..1.
    pub fn set_main(&mut self, main_rgba: &[u8], mw: u32, mh: u32, back_rgb: &[u8], bw: u32, bh: u32, blend: f32) {
        let mut m = main_rgba.to_vec();
        let a = (blend.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        for px in m.chunks_exact_mut(4) { px[3] = a; }
        let tex = upload(&self.device, &self.queue, "main", &m, mw as usize, mh as usize, 1, self.mips);
        let mv = tex.create_view(&Default::default());
        self.main_group = Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("main"), layout: &self.bgl_tex1, entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&mv) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) }] }));
        let bk = backdrop_rgba(back_rgb, bw as usize, bh as usize);
        let bt = upload(&self.device, &self.queue, "back", &bk, bw as usize, bh as usize, 1, self.mips);
        let bv = bt.create_view(&Default::default());
        self.back_group = Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("back"), layout: &self.bgl_tex1, entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&bv) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) }] }));
        let (a1, a2) = accent_of(back_rgb);
        self.accent = a1; self.accent2 = a2;
    }

    /// Seconds of video.
    pub fn duration(&self) -> f64 { self.scene.as_ref().map(|s| s.opts.dur).unwrap_or(0.0) }

    /// Draw the frame at time `t` seconds to the canvas.
    pub fn draw(&mut self, t: f64) -> Result<(), JsError> {
        let Some(sc) = &self.scene else { return Err(JsError::new("no scene")) };
        let d = sc.opts.dur;
        let aspect = self.config.width as f64 / self.config.height as f64;
        let (eye, target, roll) = sc.plan.cam.camera(t);
        let fov = sc.plan.cam.fov(t);
        let (view, fwd, right, up) = look_at(eye, target, roll);
        let vp = flat(&mat_mul(&perspective(fov, aspect, 0.5, sc.plan.d_full * 6.0), &view));
        let focus = ((target[0] - eye[0]).powi(2) + (target[1] - eye[1]).powi(2) + (target[2] - eye[2]).powi(2)).sqrt() as f32;
        let (ww, rows) = (sc.world_w, sc.rows);
        let bg = sc.opts.bg;
        let f4 = |a: [f64; 3], w: f32| [a[0] as f32, a[1] as f32, a[2] as f32, w];
        let q = &self.queue;
        let w = |b: &wgpu::Buffer, data: &[f32]| q.write_buffer(b, 0, bytemuck::cast_slice(data));

        // tiles
        let mut u = vp.to_vec();
        u.extend_from_slice(&f4(eye, 0.0)); u.extend_from_slice(&f4(fwd, 0.0)); u.extend_from_slice(&[bg[0], bg[1], bg[2], 1.0]);
        u.extend_from_slice(&[t as f32, sc.opts.gap, sc.tile_ratio, focus]); u.extend_from_slice(&[sc.opts.dof, 0.0, 0.0, 0.0]);
        w(&self.u_tile, &u);
        // overlay + shine
        let ramp = smooth(sc.plan.ramp.0, sc.plan.ramp.1, t) as f32;
        let (s0, s1) = sc.plan.shine;
        let shining = t >= s0 && t <= s1;
        let shine = if shining { (-0.2 + 1.4 * (t - s0) / (s1 - s0)) as f32 } else { -5.0 };
        let mut u = vp.to_vec(); u.extend_from_slice(&[ww, rows, ramp, shine]); w(&self.u_over, &u);
        // backdrop
        let amt = (0.15 + 0.85 * smooth(0.45 * d, 0.90 * d, t)) as f32;
        let mut u = vec![bg[0], bg[1], bg[2], 1.0, self.accent[0], self.accent[1], self.accent[2], 1.0, self.accent2[0], self.accent2[1], self.accent2[2], 1.0];
        u.extend_from_slice(&[amt, target[0] as f32 / ww * 0.03, target[1] as f32 / rows * 0.03, t as f32]);
        u.extend_from_slice(&[self.config.width as f32, self.config.height as f32, 0.0, 0.0]);
        w(&self.u_back, &u);
        // glow: [0] shadow, [1] glow + rim
        let pad = 0.55 * ww.max(rows);
        let fade = smooth(0.66 * d, 0.88 * d, t) as f32;
        for mode in 0..2 {
            let mut u = vp.to_vec();
            u.extend_from_slice(&[ww + pad, rows + pad, ww / 2.0, rows / 2.0, self.accent[0], self.accent[1], self.accent[2], sc.opts.glow, ww, mode as f32, fade, 0.0]);
            w(&self.u_glow[mode], &u);
        }
        // particles
        let pc = [0.55 * self.accent[0] + 0.45 * 1.0, 0.55 * self.accent[1] + 0.45 * 0.93, 0.55 * self.accent[2] + 0.45 * 0.82, 1.0];
        let mut u = vp.to_vec();
        u.extend_from_slice(&f4(right, 0.0)); u.extend_from_slice(&f4(up, 0.0));
        u.extend_from_slice(&[t as f32, ww * 0.78, rows * 0.72, shine]);
        u.extend_from_slice(&[ww, rows, (0.25 + 0.75 * smooth(0.45 * d, 0.90 * d, t)) as f32, 0.0]);
        u.extend_from_slice(&pc);
        w(&self.u_part, &u);

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => { self.surface.configure(&self.device, &self.config); return Ok(()); }
        };
        let fview = frame.texture.create_view(&Default::default());
        let (view_c, resolve) = match &self.msaa { Some(m) => (m, Some(&fview)), None => (&fview, None) };
        let mut enc = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("frame"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: view_c, depth_slice: None, resolve_target: resolve,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: bg[0] as f64, g: bg[1] as f64, b: bg[2] as f64, a: 1.0 }),
                                            store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment { view: &self.depth,
                    depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }), stencil_ops: None }),
                timestamp_writes: None, occlusion_query_set: None, multiview_mask: None });
            if sc.opts.backdrop { if let Some(bg_group) = &self.back_group {
                pass.set_pipeline(&self.p_back); pass.set_bind_group(0, &self.g_back, &[]); pass.set_bind_group(1, bg_group, &[]); pass.draw(0..4, 0..1);
            } }
            if sc.opts.glow > 0.0 && fade > 0.0 {
                pass.set_pipeline(&self.p_shadow); pass.set_bind_group(0, &self.g_glow[0], &[]); pass.draw(0..4, 0..1);
                pass.set_pipeline(&self.p_glow); pass.set_bind_group(0, &self.g_glow[1], &[]); pass.draw(0..4, 0..1);
            }
            if !self.page_groups.is_empty() {
                pass.set_pipeline(&self.p_tile);
                pass.set_bind_group(0, &self.g_tile, &[]);
                pass.set_vertex_buffer(0, sc.inst.slice(..));
                for (page, first, count) in &sc.ranges {
                    if let Some(g) = self.page_groups.get(*page as usize) { pass.set_bind_group(1, g, &[]); pass.draw(0..4, *first..*first + *count); }
                }
            }
            if ramp > 0.0 || shining { if let Some(mg) = &self.main_group {
                pass.set_pipeline(&self.p_over); pass.set_bind_group(0, &self.g_over, &[]); pass.set_bind_group(1, mg, &[]); pass.draw(0..4, 0..1);
            } }
            if let Some((buf, n)) = &self.particles {
                pass.set_pipeline(&self.p_part); pass.set_bind_group(0, &self.g_part, &[]); pass.set_vertex_buffer(0, buf.slice(..)); pass.draw(0..4, 0..*n);
            }
        }
        self.queue.submit(Some(enc.finish()));
        self.queue.present(frame);
        let _ = sc.opts.n_particles;
        Ok(())
    }
}
