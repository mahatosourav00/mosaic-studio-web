/* tslint:disable */
/* eslint-disable */

export class Gpu {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    adapter_name(): string;
    backend(): string;
    /**
     * Create the renderer on a canvas. `force_webgl` skips WebGPU (used to test the fallback).
     */
    static create(canvas: HTMLCanvasElement, force_webgl: boolean): Promise<Gpu>;
    /**
     * Draw the demo frame (a spinning triangle) at time `t` seconds.
     */
    draw_demo(t: number): void;
    max_texture_size(): number;
    resize(w: number, h: number): void;
}

export class Renderer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    adapter_name(): string;
    backend(): string;
    /**
     * `force_webgl` skips WebGPU (testing the fallback). `samples` is the wanted MSAA (4 is lowered to 1 if unsupported).
     */
    static create(canvas: HTMLCanvasElement, force_webgl: boolean, want_samples: number): Promise<Renderer>;
    /**
     * Draw the frame at time `t` seconds to the canvas.
     */
    draw(t: number): void;
    /**
     * Seconds of video.
     */
    duration(): number;
    max_array_layers(): number;
    max_texture_size(): number;
    resize(w: number, h: number): void;
    samples(): number;
    /**
     * Hi-res showcase pictures, in showcase order.
     */
    set_heroes(rgba: Uint8Array | number[], w: number, h: number, n: number): void;
    /**
     * Main picture (overlay) and its small blurred backdrop source. `blend` = overlay opacity 0..1.
     */
    set_main(main_rgba: Uint8Array | number[], mw: number, mh: number, back_rgb: Uint8Array | number[], bw: number, bh: number, blend: number): void;
    /**
     * Plan the animation. `cells` = cell part of solve_mosaic output; `tile_rgb4` = T x 48 bytes.
     * `o` = [style, duration, video_aspect, hero_tiles, hero_size, flight_scale, pulses, pulse_depth, frame_margin, seed,
     *        tint(0/1), dof, glow, particles, backdrop(0/1), gap_ratio, bg_r, bg_g, bg_b]  (bg in 0..1).
     * Returns the tile ids of the showcase photos, in showcase order (supply their hi-res pictures to `set_heroes`).
     */
    set_scene(cells: Float32Array | number[], cols: number, rows: number, tile_ratio: number, tile_rgb4: Uint8Array | number[], o: Float64Array | number[]): Uint32Array;
    /**
     * Tile pictures: n tiles of w x h RGBA, tile id = position. Split into pages of 256 layers.
     */
    set_tiles(rgba: Uint8Array | number[], w: number, h: number, n: number): void;
}

/**
 * grid size for a mosaic of about `n` cells whose cols*ratio/rows should match `aspect`.
 */
export function grid_dims(aspect_over_ratio: number, n: number): Uint32Array;

/**
 * 64-bit perceptual hash as [high, low].
 */
export function prep_hash(rgba: Uint8Array | number[], w: number, h: number): Uint32Array;

/**
 * Sharpness score (variance of the Laplacian). Higher = sharper.
 */
export function prep_sharpness(rgba: Uint8Array | number[], w: number, h: number): number;

/**
 * Best crop [x, y, w, h] for the tile ratio; `faces` = [x, y, w, h] fractions, repeated (may be empty).
 */
export function prep_smart_crop(rgba: Uint8Array | number[], w: number, h: number, ratio: number, faces: Float32Array | number[]): Uint32Array;

/**
 * Uniform border to remove: [top, bottom, left, right] pixels.
 */
export function prep_trim_borders(rgba: Uint8Array | number[], w: number, h: number): Uint32Array;

/**
 * Paint the finished mosaic. `cells` is the cell part of `solve_mosaic`'s output (without the 6 stats numbers);
 * `tiles` is T tiles of tile_w x tile_h RGBA. Returns RGBA pixels of size cols*round(cell_h*ratio) x rows*cell_h.
 */
export function render_still(cells: Float32Array | number[], tiles: Uint8Array | number[], tile_w: number, tile_h: number, cols: number, rows: number, ratio: number, cell_h: number, gap: number, gap_rgb: Uint8Array | number[], tint: boolean): Uint8Array;

/**
 * Solve a mosaic.
 *
 * * `ana_rgb`   – main picture, cropped to the mosaic ratio and resized to (cols*24, rows*24), RGB8
 * * `subject`   – optional per-pixel subject map (0..1) at the same resolution (empty = none)
 * * `tile_rgb4` – T tiles, each 4x4 sRGB pixels (48 bytes), tile order = tile id
 * * `opts`      – numbers: [num_tiles, use_subtiles, subtile_percent, subtile_grid, subtile_detail,
 *                 subject_weight, max_uses, min_distance, allow_flip, even_usage, tint, seed]
 * * `on_progress` – optional JS callback(fraction)
 *
 * Returns a Float32Array: 6 stats numbers, then 9 floats per cell
 * `[x, y, size, tile, flip, shiftL, shifta, shiftb, w]`.
 * Stats: [violations, max_uses_raised, swaps, min_used, max_used, unused_tiles].
 */
export function solve_mosaic(ana_rgb: Uint8Array | number[], cols: number, rows: number, subject: Float32Array | number[], tile_rgb4: Uint8Array | number[], opts: Float64Array | number[], on_progress?: Function | null): Float32Array;

export function start(): void;

/**
 * Centre of a subject map as fractions [x, y].
 */
export function subject_centroid(map: Float32Array | number[], w: number, h: number): Float32Array;

/**
 * Subject map (RGB input; faces as [cx, cy, w, h] fractions) resized to ow x oh.
 */
export function subject_map(rgb: Uint8Array | number[], w: number, h: number, faces: Float32Array | number[], ow: number, oh: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_gpu_free: (a: number, b: number) => void;
    readonly __wbg_renderer_free: (a: number, b: number) => void;
    readonly gpu_adapter_name: (a: number) => [number, number];
    readonly gpu_backend: (a: number) => [number, number];
    readonly gpu_create: (a: any, b: number) => any;
    readonly gpu_draw_demo: (a: number, b: number) => [number, number];
    readonly gpu_max_texture_size: (a: number) => number;
    readonly gpu_resize: (a: number, b: number, c: number) => void;
    readonly grid_dims: (a: number, b: number) => [number, number];
    readonly prep_hash: (a: number, b: number, c: number, d: number) => [number, number];
    readonly prep_sharpness: (a: number, b: number, c: number, d: number) => number;
    readonly prep_smart_crop: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly prep_trim_borders: (a: number, b: number, c: number, d: number) => [number, number];
    readonly render_still: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly renderer_adapter_name: (a: number) => [number, number];
    readonly renderer_backend: (a: number) => [number, number];
    readonly renderer_create: (a: any, b: number, c: number) => any;
    readonly renderer_draw: (a: number, b: number) => [number, number];
    readonly renderer_duration: (a: number) => number;
    readonly renderer_max_array_layers: (a: number) => number;
    readonly renderer_max_texture_size: (a: number) => number;
    readonly renderer_resize: (a: number, b: number, c: number) => void;
    readonly renderer_samples: (a: number) => number;
    readonly renderer_set_heroes: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly renderer_set_main: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly renderer_set_scene: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly renderer_set_tiles: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly solve_mosaic: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number, number];
    readonly start: () => void;
    readonly subject_centroid: (a: number, b: number, c: number, d: number) => [number, number];
    readonly subject_map: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly wasm_bindgen_7c42ed654ab60030___convert__closures_____invoke___js_sys_f0d9a7d81b4e9708___Function_fn_wasm_bindgen_7c42ed654ab60030___JsValue_____wasm_bindgen_7c42ed654ab60030___sys__Undefined___js_sys_f0d9a7d81b4e9708___Function_fn_wasm_bindgen_7c42ed654ab60030___JsValue_____wasm_bindgen_7c42ed654ab60030___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_7c42ed654ab60030___convert__closures_____invoke___wasm_bindgen_7c42ed654ab60030___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_7c42ed654ab60030___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_7c42ed654ab60030___convert__closures_____invoke___wasm_bindgen_7c42ed654ab60030___sys__JsNullable_wgpu_3918400f5c0af37f___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_d941ad8722425d2e___result__Result_____wasm_bindgen_7c42ed654ab60030___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_7c42ed654ab60030___convert__closures_____invoke___wasm_bindgen_7c42ed654ab60030___sys__JsNullable_wgpu_3918400f5c0af37f___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_d941ad8722425d2e___result__Result_____wasm_bindgen_7c42ed654ab60030___JsError___true__32: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_7c42ed654ab60030___convert__closures_____invoke___wasm_bindgen_7c42ed654ab60030___sys__JsNullable_wgpu_3918400f5c0af37f___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_d941ad8722425d2e___result__Result_____wasm_bindgen_7c42ed654ab60030___JsError___true__33: (a: number, b: number, c: any) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
