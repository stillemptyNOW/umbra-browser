# Third-party notices

Umbra's own source is MIT ([LICENSE](LICENSE)). It is a small amount of code
sitting on a very large amount of other people's, listed here.

## Engine and runtime

| Component | Licence | Used for |
|---|---|---|
| [Chromium](https://chromium.googlesource.com/chromium/src) | BSD-3-Clause | The rendering engine, on every platform |
| [Electron](https://github.com/electron/electron) | MIT | The desktop application shell |
| [Node.js](https://nodejs.org) | MIT | Main-process runtime |
| [WebKit](https://webkit.org) | LGPL-2.1 / BSD | The iOS engine, as Apple requires |
| [AndroidX / Jetpack](https://developer.android.com/jetpack) | Apache-2.0 | Android UI and WebView compatibility |
| [Material Components for Android](https://github.com/material-components/material-components-android) | Apache-2.0 | Android theming |

## Content blocking

| Component | Licence | Used for |
|---|---|---|
| [@ghostery/adblocker](https://github.com/ghostery/adblocker) | MPL-2.0 | The desktop filter engine |
| [EasyList](https://easylist.to) | GPL-3.0 / CC BY-SA 3.0 | Ad filter rules |
| [EasyPrivacy](https://easylist.to) | GPL-3.0 / CC BY-SA 3.0 | Tracker filter rules |
| [uBlock Origin filters](https://github.com/uBlockOrigin/uAssets) | GPL-3.0 | Additional filter rules |
| [tldts](https://github.com/remusao/tldts) | MIT | Public suffix parsing, for first/third party decisions |

Filter lists are fetched at runtime and cached locally; they are not
redistributed in this repository.

## Colour palettes

Umbra's own palette is sampled from its mark. The rest of the themes are
well-known open-source palettes, used with thanks:

| Palette | Author | Licence |
|---|---|---|
| [Catppuccin](https://github.com/catppuccin/catppuccin) (Mocha, Latte) | Catppuccin Org | MIT |
| [Nord](https://www.nordtheme.com) | Arctic Ice Studio | MIT |
| [Rosé Pine](https://rosepinetheme.com) | Rosé Pine | MIT |
| [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme) | enkia | Apache-2.0 |
| [Gruvbox](https://github.com/morhetz/gruvbox) | morhetz | MIT |
| [Solarized](https://ethanschoonover.com/solarized/) | Ethan Schoonover | MIT |

Only the colour values are used. No code, artwork or trademark from these
projects is included, and none of them endorse Umbra.

## Design influence

The fingerprinting approach — randomising per site rather than blocking — is
[Brave's "farbling"](https://brave.com/privacy-updates/3-fingerprint-randomization/).
The idea is theirs; the implementation here is independent. The de-Googling
approach in `chromium/` follows the path
[ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
mapped out, though the substitution list is written from scratch.

## Build tooling

| Component | Licence |
|---|---|
| [electron-builder](https://github.com/electron-userland/electron-builder) | MIT |
| [sharp](https://github.com/lovell/sharp) | Apache-2.0 |
| [png2icons](https://github.com/idesis-gmbh/png2icons) | MIT |
| [XcodeGen](https://github.com/yonaskolb/XcodeGen) | MIT |
| [Gradle](https://gradle.org) | Apache-2.0 |

## Trademarks

"Chromium", "Google", "Android", "Apple", "iOS" and "macOS" are trademarks of
their respective owners. Umbra is not affiliated with, endorsed by, or in any
way connected to any of them.
