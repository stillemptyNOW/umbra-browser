'use strict';
/**
 * Settings live in a single JSON file under the user data directory. Nothing
 * is ever synced anywhere: there is no account, no server, no telemetry.
 */
const path = require('node:path');
const { readJsonSync, writeJsonSync } = require('./store');

const ENUMS = Object.freeze({
  fingerprintDefense: ['off', 'standard', 'strict'],
  webrtcPolicy: ['default', 'public-only', 'disable-udp'],
  searchEngine: ['duckduckgo', 'startpage', 'brave', 'mojeek', 'ecosia', 'wikipedia', 'custom'],
  dnsProvider: ['quad9', 'cloudflare', 'mullvad', 'adguard'],
});

const DEFAULTS = Object.freeze({
  // appearance
  theme: 'umbra',

  // search
  searchEngine: 'duckduckgo',
  customSearchUrl: '',
  homepage: 'umbra://newtab',

  // content blocking
  blockAds: true,
  blockTrackers: true,
  blockCosmetics: true,
  // Filters ship inside the app, so this only tops them up. It is the one
  // request Umbra makes without being asked; turning it off means running on
  // whatever the installed build was compiled with.
  updateFilters: true,

  // network privacy
  httpsOnly: true,
  stripTrackingParams: true,
  trimReferrer: true,
  sendGpc: true,
  blockThirdPartyCookies: true,
  secureDns: true,
  dnsProvider: 'quad9',
  webrtcPolicy: 'public-only', // default | public-only | disable-udp

  // fingerprinting
  spoofUserAgent: true,
  fingerprintDefense: 'standard', // off | standard | strict
  spoofTimezone: false,
  spoofLanguage: true,

  // data
  rememberHistory: true,
  restoreTabs: true,
  clearOnExit: false,

  // permissions (deny-by-default; these opt whole categories back in)
  allowMedia: false,
  allowGeolocation: false,
  allowNotifications: false,

  // window
  windowState: { width: 1360, height: 880, x: null, y: null, maximized: false },
  sessionTabs: [],
  sessionActive: 0,
});

const DNS_PROVIDERS = Object.freeze({
  quad9: ['https://dns.quad9.net/dns-query'],
  cloudflare: ['https://mozilla.cloudflare-dns.com/dns-query'],
  mullvad: ['https://dns.mullvad.net/dns-query'],
  adguard: ['https://unfiltered.adguard-dns.com/dns-query'],
});

const SEARCH_ENGINES = Object.freeze({
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  mojeek: { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
  custom: { name: 'Custom', url: '' },
});

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/** Coerce a renderer-supplied value to the type the setting actually is. */
function sanitiseSetting(key, value) {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    return undefined;
  }
  const fallback = DEFAULTS[key];

  if (Object.prototype.hasOwnProperty.call(ENUMS, key)) {
    return ENUMS[key].includes(value) ? value : undefined;
  }

  if (typeof fallback === 'boolean') return Boolean(value);

  if (key === 'homepage') {
    const text = String(value || '').trim();
    if (/^umbra:/i.test(text) || /^https:/i.test(text)) return text;
    if (/^http:\/\/(localhost|127\.0\.0\.1)\b/i.test(text)) return text;
    return undefined;
  }

  if (key === 'customSearchUrl') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.includes('%s') && /^https:/i.test(text)) return text;
    return undefined;
  }

  if (key === 'sessionTabs') {
    if (!Array.isArray(value)) return undefined;
    return value
      .map((entry) => (typeof entry === 'string' ? entry : entry?.url))
      .filter((url) => typeof url === 'string' && /^(https?:|umbra:)/i.test(url) && !url.startsWith('umbra://error'))
      .slice(0, 50);
  }

  if (key === 'sessionActive') {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  if (key === 'windowState' && value && typeof value === 'object') {
    return {
      width: Math.max(520, Number(value.width) || fallback.width),
      height: Math.max(380, Number(value.height) || fallback.height),
      x: value.x == null ? null : Number(value.x),
      y: value.y == null ? null : Number(value.y),
      maximized: Boolean(value.maximized),
    };
  }

  if (typeof fallback === 'string') return String(value ?? '');
  return value;
}

class Settings {
  constructor() {
    const { app } = require('electron');
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.values = { ...DEFAULTS };
    this._writeTimer = null;
    this._listeners = new Set();
    this.load();
  }

  load() {
    const raw = readJsonSync(this.file, null);
    if (raw && typeof raw === 'object') this.values = deepMerge(DEFAULTS, raw);
    return this.values;
  }

  get(key) {
    return key === undefined ? this.values : this.values[key];
  }

  set(key, value) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      return this.values;
    }
    const next = sanitiseSetting(key, value);
    if (next === undefined) return this.values;
    this.values[key] = next;
    this.save();
    for (const fn of this._listeners) fn(key, next);
    return this.values;
  }

  patch(obj) {
    for (const [k, v] of Object.entries(obj)) this.set(k, v);
    return this.values;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Debounced atomic write — a torn settings file would reset the profile. */
  save() {
    clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this._writeTimer);
    writeJsonSync(this.file, this.values);
  }

  searchTemplate() {
    const id = this.values.searchEngine;
    if (id === 'custom' && this.values.customSearchUrl.includes('%s')) {
      return this.values.customSearchUrl;
    }
    return (SEARCH_ENGINES[id] || SEARCH_ENGINES.duckduckgo).url;
  }

  dnsServers() {
    return DNS_PROVIDERS[this.values.dnsProvider] || DNS_PROVIDERS.quad9;
  }
}

let instance = null;
module.exports = {
  DEFAULTS,
  DNS_PROVIDERS,
  SEARCH_ENGINES,
  ENUMS,
  sanitiseSetting,
  get settings() {
    if (!instance) instance = new Settings();
    return instance;
  },
};
