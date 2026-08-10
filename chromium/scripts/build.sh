#!/usr/bin/env bash
# Configure and build the Umbra Chromium fork.
#
#   ./scripts/build.sh linux|windows|macos|android
#
# Expects scripts/fetch.sh and scripts/apply.py to have run first.
set -euo pipefail

PLATFORM="${1:-linux}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
SRC="$ROOT/src"
OUT="out/Umbra"

case "$PLATFORM" in
  linux|windows|macos|android) ;;
  *) echo "unknown platform: $PLATFORM (linux|windows|macos|android)" >&2; exit 2 ;;
esac

[ -d "$SRC" ] || { echo "no checkout at $SRC — run scripts/fetch.sh first" >&2; exit 1; }

export PATH="$ROOT/depot_tools:$PATH"
export DEPOT_TOOLS_METRICS=0
export DEPOT_TOOLS_WIN_TOOLCHAIN=0

# The args files import //umbra/common.gni, so they have to live inside the
# source tree. Copying rather than symlinking keeps Windows happy.
mkdir -p "$SRC/umbra"
cp "$ROOT/args/"*.gni "$SRC/umbra/"

cd "$SRC"
mkdir -p "$OUT"
cp "umbra/$PLATFORM.gni" "$OUT/args.gn"

echo "==> gn gen $OUT"
gn gen "$OUT"

echo "==> args in effect"
gn args "$OUT" --list --short --overrides-only

echo "==> autoninja (this is the part that takes hours)"
autoninja -C "$OUT" chrome chromedriver

echo
echo "==> built into $SRC/$OUT"
