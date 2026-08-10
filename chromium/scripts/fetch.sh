#!/usr/bin/env bash
# Fetch depot_tools and a Chromium checkout at the pinned tag.
#
# Budget roughly 40 GB and an hour on a fast connection. The checkout is
# deliberately shallow on history but complete on the working tree: Chromium's
# build refuses to run against a partial tree.
set -euo pipefail

# Pin. Bump this, re-run apply.py, and fix whatever no longer matches.
CHROMIUM_TAG="${CHROMIUM_TAG:-140.0.7339.207}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
DEPOT_TOOLS="$ROOT/depot_tools"
SRC="$ROOT/src"

echo "==> Umbra: fetching Chromium $CHROMIUM_TAG"

if [ ! -d "$DEPOT_TOOLS" ]; then
  git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$DEPOT_TOOLS"
fi
export PATH="$DEPOT_TOOLS:$PATH"

# depot_tools ships its own metrics collection. Off.
export DEPOT_TOOLS_METRICS=0
# On Windows, set this to 0 only if you have Google's internal toolchain.
export DEPOT_TOOLS_WIN_TOOLCHAIN=0

mkdir -p "$SRC"
cd "$ROOT"

if [ ! -f .gclient ]; then
  gclient config --name src --unmanaged https://chromium.googlesource.com/chromium/src.git
fi

if [ ! -d "$SRC/.git" ]; then
  git clone --filter=blob:none https://chromium.googlesource.com/chromium/src.git "$SRC"
fi

cd "$SRC"
git fetch --tags --depth 1 origin "refs/tags/$CHROMIUM_TAG"
git checkout "tags/$CHROMIUM_TAG"

cd "$ROOT"
gclient sync --no-history --shallow --with_branch_heads --reset -D

echo "==> checkout ready at $SRC"
echo "    next: python3 scripts/apply.py --src src"
