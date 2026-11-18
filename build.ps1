# Builds the Rust core to WebAssembly and generates the JS glue into ./pkg
# Needs: rustup (stable + wasm32-unknown-unknown target) and wasm-bindgen-cli 0.2.130 on PATH.
# On Windows without Visual Studio Build Tools, use the GNU host toolchain with rust-lld:
#   rustup toolchain install stable-x86_64-pc-windows-gnu -t wasm32-unknown-unknown
param([switch]$Debug)
$ErrorActionPreference = "Stop"
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
Set-Location $PSScriptRoot
$prof = if ($Debug) { "debug" } else { "release" }
$flag = if ($Debug) { @() } else { @("--release") }
$tc = @()
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -like "*Visual Studio*" })) {
  $tc = @("+stable-x86_64-pc-windows-gnu"); $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "rust-lld"
}
$args2 = @($tc) + @("build") + @($flag) + @("--target","wasm32-unknown-unknown","-p","mosaic-core"); Write-Host "cargo $args2"; cargo @args2
if ($LASTEXITCODE) { exit $LASTEXITCODE }
wasm-bindgen --target web --out-dir pkg --out-name mosaic_core "target/wasm32-unknown-unknown/$prof/mosaic_core.wasm"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if (Get-Command wasm-opt -ErrorAction SilentlyContinue) { wasm-opt -O3 -o pkg/mosaic_core_bg.wasm pkg/mosaic_core_bg.wasm }
Get-ChildItem pkg | Select-Object Name, Length
