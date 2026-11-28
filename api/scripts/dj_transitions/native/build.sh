#!/usr/bin/env bash
# Fetches the pinned Signalsmith sources (MIT) into native/.vendor and builds libstretch.
set -euo pipefail
cd "$(dirname "$0")"
STRETCH_REV=88061fd4eda56a2353c5d65c74aa3f4ccf76f9da   # signalsmith-stretch 1.3.2 (main, 2026-10-22)
LINEAR_TAG=0.6.6                                     # the tag its CMakeLists pins
mkdir -p .vendor
if [ ! -d .vendor/signalsmith-stretch ]; then
  git clone -q https://github.com/Signalsmith-Audio/signalsmith-stretch.git .vendor/signalsmith-stretch
fi
git -C .vendor/signalsmith-stretch checkout -q "$STRETCH_REV"
if [ ! -d .vendor/signalsmith-linear ]; then
  git clone -q --depth 1 --branch "$LINEAR_TAG" https://github.com/Signalsmith-Audio/linear.git .vendor/signalsmith-linear
fi
case "$(uname -s)" in
  Darwin) EXT=dylib ;;
  *) EXT=so ;;
esac
${CXX:-clang++} -O3 -std=c++17 -shared -fPIC \
  -I .vendor/signalsmith-stretch/include -I .vendor/signalsmith-linear/include \
  stretch_capi.cpp -o "libstretch.$EXT"
echo "built native/libstretch.$EXT"
