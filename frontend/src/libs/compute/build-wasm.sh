#!/usr/bin/env bash
# 普通编译或 release 编译所有 wasm（interpolation + surfacenets）
# 用法: ./build-wasm.sh [--release]
set -e
RELEASE=""
if [[ "${1:-}" == "--release" ]]; then
  RELEASE="--release"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building wasm_interpolation..."
wasm-pack build --target web $RELEASE --out-dir pkg/wasm_interpolation --out-name wasm_interpolation . --no-default-features --features interpolation

echo "Building wasm_surfacenets..."
wasm-pack build --target web $RELEASE --out-dir pkg/wasm_surfacenets --out-name wasm_surfacenets . --no-default-features --features surfacenets

echo "Done."
