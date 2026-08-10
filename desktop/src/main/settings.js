'use strict';
/**
 * Settings live in a single JSON file under the user data directory. Nothing
 * is ever synced anywhere: there is no account, no server, no telemetry.
 */
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  // appearance
  theme: 'umbra',
  showBookmarksBar: false,

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
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

class Settings {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.values = { ...DEFAULTS };
    this._writeTimer = null;
    this._listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.values = deepMerge(DEFAULTS, JSON.parse(raw));
    } catch {
      // First run, or the file is unreadable — defaults are already in place.
    }
    return this.values;
  }

  get(key) {
    return key === undefined ? this.values : this.values[key];
  }

  set(key, value) {
    if (!(key in DEFAULTS)) return this.values;
    this.values[key] = value;
    this.save();
    for (const fn of this._listeners) fn(key, value);
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
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.values, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[umbra] could not persist settings:', err.message);
    }
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
  get settings() {
    if (!instance) instance = new Settings();
    return instance;
  },
};
