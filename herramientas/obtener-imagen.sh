#!/usr/bin/env bash
# Downloads the prebuilt Linux 6.1.14 nommu image (kernel + busybox initramfs, GPL) by cnlohr
# into build/linux/Image and checks its SHA-256. Only needs git and unzip (no compilers):
# this is what the Pages workflow runs. ./setup.sh does the same plus the riscv-tests.
set -euo pipefail
cd "$(dirname "$0")/.."
IMG=build/linux/Image
IMG_SHA=5f596134705d5aa8e7c8c406695a560d08faaff4a86bc715659e53cbebba6c7e
if [ -f "$IMG" ] && [ "$(sha256sum "$IMG" | cut -d' ' -f1)" = "$IMG_SHA" ]; then echo "imagen ya presente"; exit 0; fi
mkdir -p build/linux
R=build/src/mini-rv32ima-images
[ -d "$R/.git" ] || git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/cnlohr/mini-rv32ima-images "$R"
git -C "$R" checkout -q HEAD -- images/linux-6.1.14-rv32nommu-cnl-1.zip
unzip -o -q "$R/images/linux-6.1.14-rv32nommu-cnl-1.zip" Image -d build/linux
echo "$IMG_SHA  $IMG" | sha256sum -c -
