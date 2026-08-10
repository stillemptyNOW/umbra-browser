# Umbra on a real Chromium fork

Everything in `desktop/` runs on Chromium already — Electron *is* Chromium plus
Node. That is what ships, and it is what the release binaries contain.

This directory is the other track: building Chromium itself, de-Googled and
branded as Umbra, for people who want the engine forked rather than embedded.

## Be honest with yourself about the cost

| | |
|---|---|
| Source checkout | ~40 GB, plus ~60–80 GB of build output |
| Build time, 16-core desktop | 4–8 hours from cold |
| Build time, 4-core laptop | overnight, and then some |
| Per platform | all of the above, again |
| macOS and iOS targets | require macOS hardware; no cross-compiling |

GitHub's hosted runners cap a job at 6 hours and give 4 cores. A cold Chromium
build does not fit. `.github/workflows/chromium.yml` exists and is correct, but
it is `workflow_dispatch` only and expects a self-hosted runner or a large
runner with a warm `sccache`. **The published releases are the Electron builds,
not this.** Nothing here is pretending otherwise.

## What the fork changes

Three things, in increasing order of intrusiveness:

1. **GN args** (`args/`) — compile-time switches. Empty Google API keys, no
   Safe Browsing, no crash reporting, no field trials, no NaCl, no remoting.
   These do most of the de-Googling and cost nothing to maintain.
2. **Branding** (`scripts/apply.py`) — product name, bundle identifiers, the
   Umbra mark in place of the Chromium logo, DuckDuckGo as the sole prepopulated
   search engine.
3. **Source substitutions** (`scripts/apply.py`, `substitutions.txt`) — the
   handful of hard-coded Google endpoints that survive the GN args, rewritten to
   an unreachable domain so a missed code path fails closed instead of phoning
   home.

Substitutions are expressed as explicit find/replace pairs against named files
rather than as context diffs. Context diffs rot against every Chromium bump and
fail in ways that are tedious to debug; a substitution that no longer matches
reports itself immediately and by name.

## Building

```bash
# 1. depot_tools and a Chromium checkout at the pinned tag
./scripts/fetch.sh

# 2. branding, substitutions, icons
python3 scripts/apply.py --src src

# 3. configure and build
./scripts/build.sh linux    # or: windows | macos | android
```

Output lands in `chromium/src/out/Umbra/`.

## Keeping up with upstream

Chromium ships a stable release roughly every four weeks, each carrying
security fixes that matter. A fork that is not rebased is a liability, not a
feature. `CHROMIUM_TAG` in `scripts/fetch.sh` is the pin; bump it, re-run
`apply.py`, and fix whatever reports itself as unmatched.
