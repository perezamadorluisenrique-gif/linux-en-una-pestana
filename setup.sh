#!/usr/bin/env bash
# Prepara el entorno (idempotente): riscv-tests compilados e imagen de Linux de mini-rv32ima.
# Requisitos ya presentes en la sesión: node >= 22.18, clang, ld.lld, git, unzip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

node --version
[ -f build/riscv-tests/rv32ui-p-add ] && [ -f build/riscv-tests/rv32mi-p-zicntr ] || bash tests/riscv-tests/build.sh

# Imagen de Linux 6.1.14 nommu (kernel + initramfs con busybox) precompilada por cnlohr.
# Se baja con git (la red de la sesión llega a github por git, no por raw.githubusercontent).
IMG=build/linux/Image
IMG_SHA=5f596134705d5aa8e7c8c406695a560d08faaff4a86bc715659e53cbebba6c7e
if [ ! -f "$IMG" ] || [ "$(sha256sum "$IMG" | cut -d' ' -f1)" != "$IMG_SHA" ]; then
  mkdir -p build/linux
  R=build/src/mini-rv32ima-images
  if [ ! -d "$R/.git" ]; then
    git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/cnlohr/mini-rv32ima-images "$R"
  fi
  git -C "$R" checkout -q 7da8c6e486b7d510426b5c2283cd338abcf04eb7 -- images/linux-6.1.14-rv32nommu-cnl-1.zip 2>/dev/null \
    || git -C "$R" checkout -q HEAD -- images/linux-6.1.14-rv32nommu-cnl-1.zip
  unzip -o -q "$R/images/linux-6.1.14-rv32nommu-cnl-1.zip" Image -d build/linux
  echo "$IMG_SHA  $IMG" | sha256sum -c -
fi
if [ -f web/package.json ] && [ ! -d web/node_modules ]; then (cd web && npm ci --silent); fi
[ -f web/build.mjs ] && node web/build.mjs
echo "entorno listo"
