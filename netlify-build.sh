#!/usr/bin/env bash
# Netlify build: compile the Rust core to WebAssembly and assemble ./site (mirrors .github/workflows/pages.yml).
set -euo pipefail
# Netlify's image ships a rustup shim with no default toolchain, so install/select stable explicitly.
if ! command -v rustup >/dev/null; then
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
rustup default stable
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown -p mosaic-core
curl -sL https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.130/wasm-bindgen-0.2.130-x86_64-unknown-linux-musl.tar.gz | tar xz
./wasm-bindgen-0.2.130-x86_64-unknown-linux-musl/wasm-bindgen --target web --out-dir pkg --out-name mosaic_core target/wasm32-unknown-unknown/release/mosaic_core.wasm
sed -i "s/^const VERSION = .*/const VERSION = \"${COMMIT_REF:0:8}\";/" sw.js
rm -rf site && mkdir site
cp -r index.html manifest.webmanifest sw.js css js icons vendor pkg site/
rm -f site/pkg/.gitignore
