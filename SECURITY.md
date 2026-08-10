# Security

## Reporting a vulnerability

Use GitHub's [private vulnerability
reporting](https://github.com/stillemptyNOW/umbra-browser/security/advisories/new)
rather than a public issue.

Include what you did, what happened, and what you expected. A proof of concept
helps enormously. There is no bounty — this is an unfunded project — but you
will be credited in the advisory unless you would rather not be.

Expect an acknowledgement within a week. If a fix is going to take longer than
that, you will be told why.

## What counts

In scope:

- Bypasses of the privacy defences described in [PRIVACY.md](PRIVACY.md) —
  a way to defeat the fingerprinting randomisation, to recover a cross-site
  identifier, to make third-party cookies survive, or to get an HTTPS-only
  navigation silently downgraded.
- Anything that lets page content reach the main process, escape the renderer
  sandbox, or read outside the profile directory.
- Weaknesses in the `umbra://` protocol handler, in particular path traversal
  out of `src/pages` or `src/renderer`.
- Anything that exposes browsing data to a site or to another application.

Not in scope, and known:

- **Umbra does not hide your IP address.** It is not Tor. Reporting that a site
  can see your address is not a vulnerability.
- **The fingerprinting defence is detectable.** A script that looks hard can
  tell that `toDataURL` has been wrapped. The goal is to break bulk
  correlation, not to be invisible. A report that goes further — showing the
  perturbation can be *modelled and removed*, recovering the true value or a
  stable cross-site identifier — is very much in scope.
- **Binaries are unsigned.** Known, documented, and a money problem rather than
  a code problem.
- **Vulnerabilities in Chromium itself** belong to the
  [Chromium project](https://g.co/chromium/vrp). If Umbra is pinned to a
  Chromium version with a known exploited flaw, that *is* an Umbra issue —
  report it.

## Keeping current

The security of the desktop build is the security of the Chromium it embeds.
Electron tracks Chromium stable closely, and Umbra bumps Electron promptly for
security releases. If you find Umbra shipping a Chromium with a known exploited
vulnerability, please say so — that is the most useful report this project can
receive.

The `chromium/` fork track pins a Chromium tag in `scripts/fetch.sh`. An
unrebased fork is a liability; that pin is meant to move.
