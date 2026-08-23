# What Umbra does with your data

Nothing. There is no server to send it to.

That is the short version, and it is the honest one — Umbra has no account
system, no sync service, no crash reporter, no update ping and no analytics.
The long version is this document, which describes every defence, what it costs
you, and where it stops working.

## The data Umbra itself collects

None. To be specific about what that means:

- No telemetry endpoint exists in the source. Not disabled by a flag — absent.
- No crash reports. Electron's crash reporter is never started, and the
  Chromium fork builds with `enable_reporting = false`.
- No update check. Umbra does not phone home to see if it is out of date; you
  find out from the releases page like everyone else.

### The one request Umbra makes on its own

Filter lists go stale, and a stale blocklist is a blocklist that does not work.
Umbra ships with the lists already compiled in, so the first launch blocks
immediately and needs no network at all. After that, roughly every three days,
it fetches a refreshed engine from the filter CDN.

That request carries no identifier, no profile, and nothing about what you have
browsed — it is a plain download of the same file everyone else gets. It is
still an outbound request you did not ask for, which is why it is named here
and why **Settings → Content blocking → Keep filter lists up to date** turns it
off. With it off, Umbra blocks using whatever was compiled into the build you
installed, and nothing leaves the machine.
- No unique install identifier is transmitted anywhere. One is generated (see
  *Fingerprinting* below), but it never leaves the machine — its entire job is
  to make sure two websites disagree about you.

What is stored on your machine, in the user data directory:

| File | Contents | Life |
|---|---|---|
| `settings.json` | Your preferences | Until you change them |
| `history.json` | Visited URLs, capped at 4,000 | Off if you turn history off; wiped by "clear data" |
| `filters.engine.bin` | The compiled blocklist | Refreshed from the filter list CDN |
| `fp-secret` | 32 random bytes | Per profile; delete it to get a new identity |

Private windows write none of it. They use an in-memory partition, and on
close the HTTP cache, code caches and auth cache are cleared explicitly —
those outlive the partition otherwise.

**Favicons** are fetched by the main process through the tab's own session and
handed to the interface as `data:` URLs. Letting the interface load an icon URL
directly would send that request from the browser chrome, which lives in the
default session: it would skip the tab's partition, its blocking and its cookie
policy, and in a private window it would leak the visit into the persistent
profile.

## Blocking

The desktop build runs EasyList, EasyPrivacy and the uBlock Origin filter sets
through [Ghostery's engine](https://github.com/ghostery/adblocker). The engine
is compiled at build time and shipped inside the application, so blocking is
live from the first launch, offline, with no fetch first. If a build somehow
ships without it and the fallback fetch also fails, **there is no blocking**,
and the shield says so rather than showing a reassuring zero.

On top of the filter lists, a short list of pure-telemetry hosts is cancelled
outright in `desktop/src/main/privacy.js`.

## Network

**HTTPS-only.** Navigations to `http://` are rewritten to `https://`. If the
secure attempt fails because the host refused the connection, timed out, or
returned an empty response — and Umbra was the reason it went to HTTPS — that
host is exempted for the rest of the session and the plain request is retried.
Certificate errors, TLS protocol errors and connection resets are **not**
treated as "this host has no HTTPS". Falling back to HTTP in those cases is
how SSL stripping works, so Umbra does not do it.

**Certificate errors are fatal.** There is no "proceed anyway". This will
occasionally be inconvenient and it is not going to change.

**Tracking parameters** are stripped from top-level and sub-frame navigations
only — never from XHR or `fetch`, where a parameter named `utm_source` might
genuinely be an API argument.

**Referrers** are trimmed to the origin when the destination is a different
registrable domain.

**Third-party cookies** are removed from outgoing requests and `Set-Cookie` is
dropped from third-party responses. First/third party is decided by comparing
registrable domains via the public suffix list, using the top-level document as
the first party.

**DNS** goes over HTTPS in `secure` mode — no plaintext fallback. Quad9 by
default; Cloudflare, Mullvad and AdGuard are the alternatives. Your network
operator sees that you are talking to a resolver, not what you asked it.

**WebRTC** is limited to the public interface, which stops the classic local-IP
enumeration. Strict mode disables non-proxied UDP entirely.

## Fingerprinting

This is the part where the design choice matters, so here is the reasoning.

The naive defence is to block or blank the APIs that leak entropy. That fails,
because *having no canvas* is itself rare and therefore identifying. Umbra does
what Brave does instead: it returns plausible values that are subtly wrong.

The seed is `HMAC-SHA256(per-profile secret, site's hostname)`. Three
consequences follow:

1. A site sees the same values every visit, so nothing breaks and nothing looks
   suspicious.
2. Two different sites see different values, so they cannot join their records
   of you.
3. Nothing is derived from anything a site can observe, so the perturbation
   cannot be modelled and subtracted.

**The noise is a function of position, not a stream.** This is the detail that
makes the difference between a defence and a delay. A running PRNG gives a
different perturbation on each read, so a script that reads the same canvas a
few hundred times can average the noise away and recover the true pixels
exactly. Umbra derives each pixel's perturbation from `(seed, pixel index)`
through a murmur3 finaliser, so every read of a given pixel returns the same
value forever and there is nothing to average out.

Both readback paths are covered: `HTMLCanvasElement` and `OffscreenCanvas`.
The latter is worker-friendly and popular with fingerprinting scripts for
exactly the reason it is easy to forget.

What gets perturbed or replaced:

| Surface | Standard | Strict |
|---|---|---|
| Canvas + OffscreenCanvas readback | ±1 LSB on ~6% of pixels, from a copy | same |
| WebGL vendor/renderer | generic strings | + trimmed extension list |
| WebGL `readPixels` | ±1 on ~3% of bytes | same |
| AudioContext | noise at ~1e-7 | same |
| `hardwareConcurrency` / `deviceMemory` | 4 / 8 | same |
| `navigator.plugins`, `mediaDevices` | emptied | same |
| Screen metrics | viewport size | rounded to 50 px |
| `devicePixelRatio` | real | 1 |
| `performance.now()` | 100 µs | 1 ms |
| Speech synthesis voices | real | emptied |
| Language | `en-US` | same |
| Time zone | real | UTC (opt-in) |

The injection runs in the page's main world before any page script, via
`webFrame.executeJavaScript` from the preload. Patched functions keep their
name, arity and a native-looking `toString`, but this is not undetectable —
a determined script can spot the wrapper. The goal is to break bulk
correlation, not to beat a targeted adversary.

Strict mode breaks things. Sites that rely on real screen dimensions, precise
timers or the voice list will misbehave. That is the trade you are making.

## Where Umbra stops

**Your IP address is visible.** Umbra is not Tor and does not route traffic
anywhere. Every site you visit learns your address, and so does your ISP.
Combined with the defences above that is a meaningfully smaller footprint —
but if your adversary is a state, use Tor Browser.

**Login is tracking.** Signing in to a site identifies you completely. No
browser can fix that.

**The mobile builds are weaker.** They are honest about it:

| | Desktop | Android | iOS |
|---|---|---|---|
| Filter lists | full EasyList/EasyPrivacy syntax | domain list (~160 entries) | domain list, as WebKit rules |
| Cosmetic filtering | yes | no | no |
| Blocked count | per page and per session | per page and per session | **not available** |
| Fingerprint defence | full | canvas, WebGL, audio, navigator | same as Android |
| DNS over HTTPS | yes, in-browser | system setting | system setting |
| Third-party cookies | blocked | blocked | blocked |

iOS forbids third-party engines and gives apps no request-interception hook —
blocking happens inside WebKit, below JavaScript, with no callback. That is
better for security and it means Umbra genuinely cannot count what it blocked.
It shows no number rather than inventing one.

**Umbra has not been audited.** It is one person's work with no external
security review. The code is short and commented; if you are relying on it for
something that matters, read it.

The parts where a quiet mistake would be invisible in use — tracking-parameter
stripping, the HTTPS upgrade and its fallback, omnibox resolution, and
`umbra://` path containment — are covered by tests in `desktop/test/`, which
run on every push. They caught two real bugs the first time they ran. That is
a floor, not an audit.

## Reporting a problem

Security issues: see [SECURITY.md](SECURITY.md). Everything else: open an issue.
