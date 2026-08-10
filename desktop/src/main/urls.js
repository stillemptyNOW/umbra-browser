'use strict';
/** Turning what someone typed into something to load. */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const KNOWN_SCHEMES = /^(https?|umbra|about|file|data|blob|view-source|ftp):/i;

/**
 * Chromium's own internal surfaces. Electron blocks most of these already,
 * but the omnibox should never be the thing that tries: chrome://net-export
 * and devtools:// in particular are far too powerful to reach by typing.
 */
const FORBIDDEN_SCHEMES = /^(chrome|chrome-untrusted|chrome-extension|devtools|chrome-error|chrome-search|chrome-native|edge|browser|resource|javascript|vbscript):/i;
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/;
// Something.tld, optional port and path — no spaces anywhere.
const HOSTLIKE = /^[^\s/?#@]+\.[a-z]{2,63}(:\d{1,5})?([/?#]|$)/i;

/**
 * Resolve omnibox input to a URL. Anything that is not plausibly an address
 * becomes a search, which is the behaviour people expect and also the safe
 * default: a typo should never become a DNS lookup someone can watch.
 */
function resolveInput(input, searchTemplate) {
  const text = String(input || '').trim();
  if (!text) return null;

  // Refused outright rather than searched for: turning `javascript:…` into a
  // web search would quietly leak whatever the user pasted.
  if (FORBIDDEN_SCHEMES.test(text)) return null;

  if (KNOWN_SCHEMES.test(text)) return text;

  // Before the generic scheme check: "localhost:3000" matches the shape of a
  // scheme, and passing it through as one means the omnibox silently fails to
  // open a dev server.
  if (LOCALHOST.test(text) || IPV4.test(text)) return 'http://' + text;

  // An unknown scheme (mailto:, magnet:, custom apps) is passed through so the
  // OS handler can take it.
  if (SCHEME.test(text) && !text.includes(' ')) return text;

  if (HOSTLIKE.test(text) && !text.includes(' ')) return 'https://' + text;

  return searchTemplate.replace('%s', encodeURIComponent(text));
}

/** What the omnibox shows: no scheme noise, no trailing slash on bare hosts. */
function prettyUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'umbra:') return '';
    const shown = u.host + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
    return u.protocol === 'https:' ? shown : u.protocol + '//' + shown;
  } catch {
    return url || '';
  }
}

function isSearchUrl(url, searchTemplate) {
  try {
    return new URL(url).host === new URL(searchTemplate.replace('%s', 'x')).host;
  } catch {
    return false;
  }
}

module.exports = { resolveInput, prettyUrl, isSearchUrl, FORBIDDEN_SCHEMES };
