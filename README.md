<div align="center">

<img src="brand/generated/umbra-256.png" width="128" alt="Umbra">

# Umbra

**Your browsing, in shadow.**

A private, Chromium-based browser for Windows, macOS, Linux, Android and iOS.
No telemetry, no account, no sync server — not disabled by default, absent.

[![ci](https://github.com/stillemptyNOW/umbra-browser/actions/workflows/ci.yml/badge.svg)](https://github.com/stillemptyNOW/umbra-browser/actions/workflows/ci.yml)
[![licence](https://img.shields.io/badge/licence-MIT-7726FA)](LICENSE)

</div>

---

## Download

Grab the latest build from [Releases](https://github.com/stillemptyNOW/umbra-browser/releases).

| Platform | File | Note |
|---|---|---|
| Windows 10/11 | `.exe` installer or portable | SmartScreen will warn — see below |
| macOS 11+ | `.dmg`, Apple silicon and Intel | Gatekeeper will refuse a double-click |
| Linux | `.deb`, `.AppImage`, `.tar.gz` | |
| Android 8+ | `.apk` | Signed with a throwaway key |
| iOS 16+ | `.ipa`, unsigned | Sideload only |

**None of it is signed with a paid certificate**, because this project does not
have one. On Windows, choose "More info" → "Run anyway". On macOS, right-click →
Open, or `xattr -dr com.apple.quarantine /Applications/Umbra.app`. On iOS you
need AltStore, Sideloadly, or your own free certificate in Xcode. Verify what
you downloaded against `SHA256SUMS.txt` in the release.

## What it actually does

Umbra is not a skin over default Chromium. Each of these is implemented, and
each is something you can turn off:

**Blocking**
- EasyList, EasyPrivacy and the uBlock Origin filter sets, run through
  [Ghostery's engine](https://github.com/ghostery/adblocker). Compiled once and
  cached on disk, so start-up is offline after the first run.
- Cosmetic filtering, so a blocked ad leaves no hole behind.
- Known telemetry endpoints cancelled outright, above the filter lists.

**Network**
- HTTPS-only navigation, with a per-host fallback when — and only when — the
  upgrade is what broke the page.
- Tracking parameters (`utm_*`, `fbclid`, `gclid`, and about sixty others)
  stripped from navigations, never from API calls.
- Cross-site referrers trimmed to the bare origin.
- Third-party cookies stripped from requests and dropped from responses.
- DNS over HTTPS, in `secure` mode — a resolver that cannot answer over HTTPS
  gets no query, rather than silently falling back to plaintext.
- `Sec-GPC: 1` on every request.
- WebRTC restricted to the public interface, so it cannot enumerate your LAN.

**Fingerprinting**
- Canvas, WebGL `readPixels` and audio outputs are *farbled*, in Brave's sense:
  perturbed by a seed derived from a per-profile secret and the site's domain.
  A site sees stable values across visits; two sites never agree. Returning
  obviously-fake constants would itself be a fingerprint — this is the whole
  design choice, and [PRIVACY.md](PRIVACY.md) explains it properly.
- High-entropy client hints (CPU architecture, OS build, device model) removed.
- Generic Chrome user agent — announcing Umbra, with its handful of users,
  would be close to a unique identifier.
- `navigator.plugins`, `mediaDevices.enumerateDevices`, battery and network
  information neutralised.
- Screen metrics report the viewport, not the display.
- Timer precision reduced to 100 µs, or 1 ms in strict mode.

**Data**
- Deny-by-default permissions. Camera, microphone, location, notifications,
  USB, HID, serial, Bluetooth, MIDI and idle detection are refused without
  asking, unless you opt the category in.
- Certificate errors are fatal. There is no click-through. HTTPS-only does not fall back to HTTP when TLS fails — that would be SSL stripping.
- History is local, capped, and used only for address bar completion.
- Tabs restore on start-up (off if you turn it off). Private windows are never restored.
- Private windows use an in-memory partition that is wiped on close.

**Extensions** — unpacked Chrome extensions load into every tab, with their
content scripts, background workers and action popups. Request blocking is the
one thing Electron does not wire up, so a content blocker installed here will
not block anything; Umbra does that job itself. `umbra://extensions` says so
before you install rather than after.

**Because it's a browser and not a manifesto** — tabs you can drag, close and
reorder, find in page, zoom, downloads, a real context menu, keyboard
shortcuts that work while focus is in the page, dev tools, and eight themes.

## What it is not

- **Not Tor.** Umbra does not hide your IP address. It reduces what sites can
  correlate; it does not make you anonymous. If your threat model includes a
  state, use Tor Browser.
- **Not a Chromium fork, in the shipped binaries.** The desktop build is
  Chromium via Electron. The engine is genuine Chromium; the browser shell
  around it is Umbra's. A real fork lives in [`chromium/`](chromium/) — GN args,
  branding, de-Googling substitutions and build scripts — but building it takes
  40 GB of source and the better part of a day per platform, so it is not what
  the releases contain. [chromium/README.md](chromium/README.md) is candid
  about the trade.
- **Not equally capable on mobile.** iOS forbids third-party engines, so the
  iOS build is WKWebView with a WebKit content-rule list. Android uses the
  system WebView, which is Chromium, but exposes no filter-list hook — so
  mobile blocking is domain-level, not full filter syntax. Neither can show an
  honest per-page blocked count on iOS, so neither shows one.
- **Not audited.** One contributor, no security review. Read the code.

## Repository layout

```
brand/        the mark, the palette, and the icon pipeline for all five targets
desktop/      the browser: Electron main process, chrome UI, internal pages
android/      Kotlin + WebView client
ios/          SwiftUI + WKWebView client (XcodeGen; no committed .xcodeproj)
shared/       blocklist and fingerprinting script, fanned out to both mobile builds
chromium/     the real-fork track: GN args, substitutions, build scripts
tools/        asset generators
```

The desktop browser is worth a tour if you are reading the code:

| File | What lives there |
|---|---|
| [`desktop/src/main/privacy.js`](desktop/src/main/privacy.js) | Every network-level defence, and the reason they share one webRequest listener |
| [`desktop/src/preload/content.js`](desktop/src/preload/content.js) | The fingerprinting defence, and how it reaches the page's main world |
| [`desktop/src/main/tabs.js`](desktop/src/main/tabs.js) | Real out-of-process Chromium tabs, not iframes |
| [`desktop/src/main/window.js`](desktop/src/main/window.js) | Window layout, and the transparent-overlay trick behind the popovers |

## Building

```bash
git clone https://github.com/stillemptyNOW/umbra-browser
cd umbra-browser

npm ci                  # brand assets + shared mobile assets
cd desktop && npm ci
npm start               # run it
npm run dist            # package for the current platform
```

Android needs JDK 17 and Gradle 8.11; iOS needs macOS, Xcode and XcodeGen.
Full instructions, including the Chromium fork, are in
[docs/BUILD.md](docs/BUILD.md).

## Standing on other people's work

Chromium, Electron, Ghostery's filter engine, EasyList and EasyPrivacy, and the
Catppuccin, Nord, Rosé Pine, Tokyo Night, Gruvbox and Solarized palettes.
[NOTICE.md](NOTICE.md) has the full list with licences.

Umbra's own code is [MIT](LICENSE).
