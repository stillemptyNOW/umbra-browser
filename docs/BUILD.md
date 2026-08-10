# Building Umbra

Five targets, four toolchains, wildly different costs. Start with the desktop
build — it is the one that takes minutes rather than hours.

## Everything starts here

```bash
git clone https://github.com/stillemptyNOW/umbra-browser
cd umbra-browser
npm ci
```

The root `npm ci` is not optional for any target. Its `postinstall` runs two
generators:

- `brand/generate-icons.mjs` — rasterises `brand/umbra-mark.png` into the
  `.png`, `.ico`, `.icns`, Android mipmap and iOS asset-catalog forms each
  platform expects.
- `tools/build-mobile-assets.mjs` — fans `shared/blocklist.txt` and
  `shared/farble.js` out to the Android assets directory and the iOS resources
  directory, compiling the blocklist into a WebKit content-rule list on the way.

Skip it and the Android and iOS builds will fail on missing resources.

## Desktop — Windows, macOS, Linux

**Needs:** Node 20 or newer. That is all; Electron's binaries are downloaded.

```bash
cd desktop
npm ci
npm start                 # run from source
npm run dist              # package for the current platform
```

`npm run dist` writes to `desktop/dist/`. Cross-building is limited:

| From | Can build | Cannot |
|---|---|---|
| Windows | `.exe` (nsis, portable) | `.dmg`, and `.deb` without WSL or Docker |
| macOS | `.dmg`, `.zip`, and Linux targets | `.exe` without Wine |
| Linux | `.deb`, `.AppImage`, `.tar.gz`, `.exe` with Wine | `.dmg` — Apple's tooling is macOS-only |

This is why the release workflow uses one runner per platform rather than
cross-compiling.

**Signing.** Unset by default. With a certificate:

```bash
# Windows
export CSC_LINK=/path/to/cert.pfx CSC_KEY_PASSWORD=…

# macOS — also needs notarisation to avoid Gatekeeper
export CSC_LINK=/path/to/cert.p12 CSC_KEY_PASSWORD=…
export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…
```

Without them, `CSC_IDENTITY_AUTO_DISCOVERY=false` keeps electron-builder from
hunting for a keychain identity and failing.

## Android

**Needs:** JDK 17, Android SDK with platform 35, Gradle 8.11+.

There is no Gradle wrapper in this repository. A `gradlew` script without its
`gradle-wrapper.jar` is worse than none, and committing the jar means shipping
a binary nobody reviews. Install Gradle instead.

```bash
cd android
gradle assembleDebug      # app/build/outputs/apk/debug/
gradle assembleRelease    # app/build/outputs/apk/release/
```

Release builds are signed with the debug key unless you provide your own:

```bash
export UMBRA_KEYSTORE=/path/to/umbra.jks
export UMBRA_KEYSTORE_PASSWORD=…
export UMBRA_KEY_ALIAS=umbra
export UMBRA_KEY_PASSWORD=…
gradle assembleRelease
```

An APK signed with the debug key installs and runs, but cannot be upgraded in
place from a differently-signed build. Fine for trying it; not for distribution
you intend to maintain.

## iOS

**Needs:** macOS, Xcode 15+, [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
cd ios
xcodegen generate         # produces Umbra.xcodeproj from project.yml
open Umbra.xcodeproj
```

The `.xcodeproj` is generated rather than committed: it is a merge-conflict
magnet, and `project.yml` says what the build does in thirty readable lines.

**Unsigned `.ipa` for sideloading:**

```bash
xcodebuild archive \
  -project Umbra.xcodeproj -scheme Umbra \
  -configuration Release -sdk iphoneos \
  -archivePath build/Umbra.xcarchive \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO

mkdir -p build/Payload
cp -R build/Umbra.xcarchive/Products/Applications/Umbra.app build/Payload/
(cd build && zip -qry Umbra-ios-unsigned.ipa Payload)
```

That `.ipa` installs through AltStore or Sideloadly, or by re-signing with a
free Apple ID certificate in Xcode — which expires after seven days. Anything
better needs a paid Apple Developer account at $99/year, which also unlocks
TestFlight and the App Store. There is no way around this; it is Apple's
policy, not an oversight in the build.

**On the engine.** App Store guideline 2.5.6 requires third-party browsers to
use WebKit. The EU's Digital Markets Act now permits alternative engines in the
EU, but doing so means a separate binary, an entitlement request, and ongoing
compliance work. Umbra uses WKWebView.

## Chromium fork

See [chromium/README.md](../chromium/README.md), which is honest about the
40 GB checkout and the eight-hour build. Short version:

```bash
cd chromium
./scripts/fetch.sh
python3 scripts/apply.py --src src
./scripts/build.sh linux
```

`apply.py --check` reports what it would change without touching anything, and
`--revert` puts the checkout back. Every substitution must match; when Chromium
moves a string the script stops and names it, rather than quietly producing a
browser that still talks to Google.

## CI

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push, PR | Parses every source file, packages an unpacked desktop build, assembles a debug APK, builds iOS for the simulator, checks the fork scripts |
| `release.yml` | tag `v*` | Builds all five artifacts on their native runners and publishes a release with checksums |
| `chromium.yml` | manual | The fork build. Will not finish on a hosted runner — see its header |

## Troubleshooting

**`npm ci` fails on sharp.** Its prebuilt binaries do not cover every platform;
`npm rebuild sharp --build-from-source` needs libvips.

**Blank tabs, working toolbar.** The `umbra://` handler is registered per
session. If you add a new partition, register it there too — see
`prepareSession` in `desktop/src/main/window.js`.

**Internal pages are blank.** They run under `script-src 'self'`, so an inline
`<script>` will not execute. Put page logic in its own file next to the HTML.

**No ads are blocked.** The filter engine downloads once on first run. Offline
at that moment means no blocking until the next launch; the shield popover says
so explicitly.
