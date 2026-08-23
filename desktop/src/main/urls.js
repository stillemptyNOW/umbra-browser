'use strict';
/** Turning what someone typed into something to load. */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Chromium internals, script URLs, and OS-handler bait. Refused outright —
 * searching for them would leak the paste, and loading them would be worse.
 */
const FORBIDDEN_SCHEMES = /^(chrome|chrome-untrusted|chrome-extension|devtools|chrome-error|chrome-search|chrome-native|edge|browser|resource|javascript|vbscript|data|intent|android-app|ms-msdt|ms-officecmd|shell|smb):/i;
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/;
const HOSTLIKE = /^[^\s/?#@]+\.[a-z]{2,63}(:\d{1,5})?([/?#]|$)/i;

/** A tab may navigate here on its own (window.open, redirects). No file: or data:. */
const TAB_SCHEMES = /^(https?|umbra|about|blob|view-source):/i;
/** The user typed it. file: is allowed; javascript: and data: are not. */
const USER_SCHEMES = /^(https?|umbra|about|file|blob|view-source):/i;
/** Hand to the OS, never to a tab. */
const EXTERNAL_SCHEMES = /^(mailto|tel|sms|webcal):/i;
const WEB_SCHEMES = /^(https?:|umbra:)/i;

function resolveInput(input, searchTemplate) {
  const text = String(input || '').trim();
  if (!text) return null;

  if (FORBIDDEN_SCHEMES.test(text)) return null;

  if (USER_SCHEMES.test(text)) return text;

  if (LOCALHOST.test(text) || IPV4.test(text)) return 'http://' + text;

  if (EXTERNAL_SCHEMES.test(text) && !text.includes(' ')) return text;

  // Unknown schemes are searched, not passed to the OS. A page (or a paste)
  // must not be able to launch whatever happens to be registered for `slack:`.
  if (SCHEME.test(text) && !text.includes(' ')) {
    return searchTemplate.replace('%s', encodeURIComponent(text));
  }

  if (HOSTLIKE.test(text) && !text.includes(' ')) return 'https://' + text;

  return searchTemplate.replace('%s', encodeURIComponent(text));
}

function isTabUrl(url) {
  return typeof url === 'string' && TAB_SCHEMES.test(url);
}

function isUserUrl(url) {
  return typeof url === 'string' && USER_SCHEMES.test(url);
}

function isExternalUrl(url) {
  return typeof url === 'string' && EXTERNAL_SCHEMES.test(url);
}

function isWebUrl(url) {
  return typeof url === 'string' && WEB_SCHEMES.test(url);
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

module.exports = {
  resolveInput,
  prettyUrl,
  isSearchUrl,
  isTabUrl,
  isUserUrl,
  isExternalUrl,
  isWebUrl,
  FORBIDDEN_SCHEMES,
  TAB_SCHEMES,
  USER_SCHEMES,
  EXTERNAL_SCHEMES,
};
