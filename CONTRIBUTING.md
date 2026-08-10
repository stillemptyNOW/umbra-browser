# Contributing

Patches welcome. A few things worth knowing before you spend an evening on one.

## Get it running

```bash
npm ci && cd desktop && npm ci && npm start
```

[docs/BUILD.md](docs/BUILD.md) covers the other four targets.

## What Umbra will and will not take

**Will:**

- Privacy defences that are real, with an explanation of what they cost. Every
  defence breaks something; say what.
- Sites that Umbra breaks and default Chromium does not. These are the most
  useful bug reports the project gets.
- Chromium and Electron version bumps, especially security ones.
- Blocklist additions for `shared/blocklist.txt`, with a note on what the domain
  does.
- Making the mobile builds less far behind the desktop one.

**Will not:**

- Anything that phones home. No analytics, no crash reporting, no update ping,
  no "anonymous" usage statistics. This is the one rule with no exceptions.
- A default search engine that profiles users.
- Privacy theatre — a toggle that looks protective but changes nothing
  measurable. If it cannot be tested, it does not ship.
- Bundled cryptocurrency, rewards, referral links or affiliate codes.

## House style

The existing code is the specification, but the short version:

- Two-space indent in JavaScript, four in Kotlin and Swift. No semicolon
  arguments; the files are consistent, match them.
- Comments explain *why*. A comment restating the code is noise; a comment
  explaining why the webRequest listeners are composed by hand in
  `privacy.js` saves the next person an hour.
- No dependency without a reason. Every package added to the desktop build runs
  in the same process as the browser chrome.
- Anything user-facing needs a matching line in [PRIVACY.md](PRIVACY.md) if it
  touches data.

## Testing a privacy change

Claims should be checkable. Useful references:

- [coveryourtracks.eff.org](https://coveryourtracks.eff.org) — fingerprinting
  surface, and whether randomisation is detected
- [browserleaks.com](https://browserleaks.com) — per-API detail: canvas, WebGL,
  audio, WebRTC, DNS
- [d3ward.github.io/toolz/adblock.html](https://d3ward.github.io/toolz/adblock.html)
  — blocking coverage

Run the same test twice on one site (values should match) and then on two
different sites (values should differ). That is the property the whole
fingerprinting design rests on, and it is easy to break by accident.

## Commits and pull requests

Present tense, one concern per commit: "strip Set-Cookie from third-party
responses", not "fixes". In the pull request, say what you changed, what it
breaks, and how you checked. Screenshots for UI work.

CI runs on every push. It is not thorough — parse checks, a packaging smoke
test, and a debug build per platform — so it passing is not evidence your
change works. Say what you actually tested.

## Reporting a security problem

Not here. [SECURITY.md](SECURITY.md).
