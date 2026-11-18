# Mosaic Studio Web

Installable, offline-capable web version of Mosaic Studio: plain HTML/CSS/JS front end, compute in Rust
(`wgpu` for graphics, CPU solver) compiled to WebAssembly. Built for phones as well as desktops.

**Status.** Full mobile-first flow: Pictures -> Prepare -> Design -> Create -> Video, with the desktop app's options and "?" guides.
Photo preparation (border trim, blur/size filter, smart crop, duplicate removal) and the subject map run in Rust/WASM; the solver,
still renderer and the animation (4 styles, wgpu on WebGPU with a WebGL2 fallback) too. Output: PNG/JPEG/WebP (DPI embedded for
print), MP4 (WebCodecs) or WebM.

**Not in the web version yet:** plugins and the plugin library, "video from a saved mosaic", TIFF, H.265, GIF, "fix sideways photos",
a Web Worker for the heavy steps, real-device and offline testing.

## Develop
Needs Rust (stable, `wasm32-unknown-unknown`) and `wasm-bindgen-cli` 0.2.130.

```powershell
./build.ps1                      # cargo build -> wasm-bindgen -> ./pkg
python -m http.server 8765       # then open http://localhost:8765
cargo test -p mosaic-core --lib  # solver tests (native)
```

On Windows without Visual Studio Build Tools, `build.ps1` uses the GNU host toolchain with `rust-lld`
(`rustup toolchain install stable-x86_64-pc-windows-gnu -t wasm32-unknown-unknown`).

## Test photos
`test-photos/` (git-ignored) holds public-domain NASA images used for manual testing.

## Notes learned so far
- wgpu's GL (WebGL2) backend treats a 2D texture array whose layer count is a multiple of 6 as a cube map: `upload()` pads such arrays by one layer.
- WebGL2 fallback requires uniform structs whose size is a multiple of 16 bytes; pad them in WGSL.
- Texture arrays are limited to 256 layers on both backends; tiles will be paged.
- GPU code is gated to `target_arch = "wasm32"` so the solver tests run natively.

MIT licensed. The desktop app lives in the `mosaic-video` repository.
