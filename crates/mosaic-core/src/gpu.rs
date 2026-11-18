//! wgpu bootstrap: WebGPU first, WebGL2 fallback. Milestone 0 renders a demo to prove both backends;
//! the real tile / overlay / backdrop / glow / particle passes are ported from `render_gl.py` next.

use wasm_bindgen::prelude::*;

const DEMO_WGSL: &str = r#"
struct U { t: f32, aspect: f32, _p0: f32, _p1: f32 };  // WebGL2 needs 16-byte-multiple uniform structs
@group(0) @binding(0) var<uniform> u: U;
struct V { @builtin(position) p: vec4<f32>, @location(0) c: vec3<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    var pts = array<vec2<f32>, 3>(vec2(0.0, 0.7), vec2(-0.6, -0.5), vec2(0.6, -0.5));
    var cols = array<vec3<f32>, 3>(vec3(0.55, 0.49, 1.0), vec3(0.31, 0.76, 0.97), vec3(1.0, 0.85, 0.5));
    let a = u.t;
    let p = pts[i];
    let r = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
    var o: V;
    o.p = vec4(r.x / u.aspect, r.y, 0.0, 1.0);
    o.c = cols[i];
    return o;
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> { return vec4(v.c, 1.0); }
"#;

#[wasm_bindgen]
pub struct Gpu {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    ubuf: wgpu::Buffer,
    bind: wgpu::BindGroup,
    backend: String,
    adapter_name: String,
    max_tex: u32,
}

#[wasm_bindgen]
impl Gpu {
    /// Create the renderer on a canvas. `force_webgl` skips WebGPU (used to test the fallback).
    pub async fn create(canvas: web_sys::HtmlCanvasElement, force_webgl: bool) -> Result<Gpu, JsError> {
        let backends = if force_webgl { wgpu::Backends::GL } else { wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL };
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = backends;
        let instance = wgpu::Instance::new(desc);
        let (w, h) = (canvas.width().max(1), canvas.height().max(1));
        let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsError::new(&format!("surface: {e}")))?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
            ..Default::default()
        }).await.map_err(|e| JsError::new(&format!("no GPU adapter: {e}")))?;
        let info = adapter.get_info();
        let limits = if info.backend == wgpu::Backend::Gl {
            wgpu::Limits::downlevel_webgl2_defaults().using_resolution(adapter.limits())
        } else {
            adapter.limits()
        };
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("mosaic"), required_limits: limits.clone(), ..Default::default()
        }).await.map_err(|e| JsError::new(&format!("device: {e}")))?;
        let mut config = surface.get_default_config(&adapter, w, h)
            .ok_or_else(|| JsError::new("surface not supported by adapter"))?;
        config.present_mode = wgpu::PresentMode::Fifo;
        let format = config.format;
        surface.configure(&device, &config);

        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("demo"), source: wgpu::ShaderSource::Wgsl(DEMO_WGSL.into()),
        });
        let ubuf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("u"), size: 16, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0, visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            }],
        });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None, layout: &bgl,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: ubuf.as_entire_binding() }],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None, bind_group_layouts: &[Some(&bgl)], immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("demo"), layout: Some(&layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            fragment: Some(wgpu::FragmentState {
                module: &module, entry_point: Some("fs"), compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(), depth_stencil: None,
            multisample: wgpu::MultisampleState::default(), multiview_mask: None, cache: None,
        });
        Ok(Gpu {
            surface, device, queue, config, pipeline, ubuf, bind,
            backend: format!("{:?}", info.backend), adapter_name: info.name.clone(),
            max_tex: limits.max_texture_dimension_2d,
        })
    }

    pub fn backend(&self) -> String { self.backend.clone() }
    pub fn adapter_name(&self) -> String { self.adapter_name.clone() }
    pub fn max_texture_size(&self) -> u32 { self.max_tex }

    pub fn resize(&mut self, w: u32, h: u32) {
        self.config.width = w.max(1);
        self.config.height = h.max(1);
        self.surface.configure(&self.device, &self.config);
    }

    /// Draw the demo frame (a spinning triangle) at time `t` seconds.
    pub fn draw_demo(&mut self, t: f32) -> Result<(), JsError> {
        let aspect = self.config.width as f32 / self.config.height as f32;
        self.queue.write_buffer(&self.ubuf, 0, bytemuck::cast_slice(&[t, aspect, 0.0f32, 0.0f32]));
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => { self.surface.configure(&self.device, &self.config); return Ok(()); }
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, depth_slice: None, resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.04, g: 0.04, b: 0.055, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit(Some(enc.finish()));
        self.queue.present(frame);
        Ok(())
    }
}
