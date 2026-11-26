#!/usr/bin/env bash
# Builds libstretch from the vendored Signalsmith Stretch headers (MIT, see vendor/*/LICENSE.txt).
#   signalsmith-stretch 1.3.2 @ 88061fd4eda56a2353c5d65c74aa3f4ccf76f9da
#   signalsmith-linear 0.6.6  @ 7bb1c8f36794d6980080ce817c91f8da8fe56a66
set -euo pipefail
cd "$(dirname "$0")"
case "$(uname -s)" in
  Darwin) EXT=dylib; CXX_DEFAULT=clang++ ;;
  *) EXT=so; CXX_DEFAULT=g++ ;;
esac
"${CXX:-$CXX_DEFAULT}" -O3 -std=c++17 -shared -fPIC -I vendor stretch_capi.cpp -o "libstretch.$EXT"
echo "built $(pwd)/libstretch.$EXT"
