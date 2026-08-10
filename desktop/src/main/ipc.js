'use strict';
/**
 * Every message the UI and page preloads can send. Handlers are deliberately
 * narrow: the renderer names an action, never a code path.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ipcMain, app, shell, clipboard } = require('electron');
const { settings } = require('./settings');
const { getTheme, listThemes } = require('./themes');
const { getStats } = require('./adblock');
const { listOrigins, forgetOrigin } = require('./history');
const { resolveInput } = require('./urls');
const { SEARCH_ENGINES } = require('./settings');

let windowsApi = null; // set by register() to avoid a require cycle

// ---------------------------------------------------------------------------
// Per-profile fingerprinting secret
// ---------------------------------------------------------------------------

let secret = null;

/**
 * A random per-profile key. Site seeds are HMACs of the site's domain under
 * this key, so a site gets stable values across visits, two sites never see
 * the same values, and nothing is derived from anything a site can observe.
 */
function profileSecret() {
  if (secret) return secret;
  const file = path.join(app.getPath('userData'), 'fp-secret');
  try {
    secret = fs.readFileSync(file);
    if (secret.length === 32) return secret;
  } catch { /* first run */ }
  secret = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch { /* non-persistent profile; in-memory secret is fine */ }
  return secret;
}

function seedFor(url) {
  let key = 'about:blank';
  try {
    key = new URL(url).hostname || key;
  } catch { /* keep fallback */ }
  const mac = crypto.createHmac('sha256', profileSecret()).update(key).digest();
  return mac.readUInt32LE(0);
}

// ---------------------------------------------------------------------------

function register(windows) {
  windowsApi = windows;

  const controllerFor = (event) =>
    windowsApi.allWindows().find((w) => w.chrome.webContents.id === event.sender.id) ||
    windowsApi.focusedWindow();

  const activeTab = (event, id) => {
    const c = controllerFor(event);
    if (!c) return [null, null];
    return [c, id != null ? c.tabs.get(id) : c.tabs.active];
  };

  // -- page preload -------------------------------------------------------

  ipcMain.on('umbra:page-config', (event, url) => {
    const cfg = settings.get();
    event.returnValue = {
      defense: cfg.fingerprintDefense,
      seed: seedFor(url),
      spoofTimezone: cfg.spoofTimezone,
      spoofLanguage: cfg.spoofLanguage,
      internal: typeof url === 'string' && url.startsWith('umbra:'),
    };
  });

  ipcMain.handle('umbra:internal-state', () => ({
    theme: getTheme(settings.get('theme')),
    settings: settings.get(),
    stats: getStats(),
    engines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name })),
    version: {
      umbra: require('../../package.json').version,
      chromium: process.versions.chrome,
      electron: process.versions.electron,
    },
  }));

  ipcMain.on('umbra:internal-search', (event, query) => {
    const url = resolveInput(query, settings.searchTemplate());
    if (url) event.sender.loadURL(url).catch(() => {});
  });

  ipcMain.on('umbra:internal-navigate', (event, url) => {
    const resolved = resolveInput(url, settings.searchTemplate());
    if (resolved) event.sender.loadURL(resolved).catch(() => {});
  });

  ipcMain.on('umbra:internal-settings', () => {
    const c = windowsApi.focusedWindow();
    if (c) c.tabs.create({ url: 'umbra://settings' });
  });

  // -- tabs ---------------------------------------------------------------

  ipcMain.on('umbra:tab-create', (event, opts = {}) => {
    const c = controllerFor(event);
    if (c) c.tabs.create(opts);
  });

  ipcMain.on('umbra:tab-close', (event, id) => {
    const c = controllerFor(event);
    if (c) c.tabs.close(id);
  });

  ipcMain.on('umbra:tab-close-others', (event, id) => {
    const c = controllerFor(event);
    if (c) c.tabs.closeOthers(id);
  });

  ipcMain.on('umbra:tab-activate', (event, id) => {
    const c = controllerFor(event);
    if (c) c.tabs.activate(id);
  });

  ipcMain.on('umbra:tab-move', (event, { id, index }) => {
    const c = controllerFor(event);
    if (c) c.tabs.move(id, index);
  });

  ipcMain.on('umbra:tab-mute', (event, { id, muted }) => {
    const [, tab] = activeTab(event, id);
    if (tab) tab.setMuted(muted);
    const c = controllerFor(event);
    if (c) c.publish();
  });

  // -- navigation ---------------------------------------------------------

  ipcMain.on('umbra:navigate', (event, { id, input }) => {
    const [c, tab] = activeTab(event, id);
    if (!c) return;
    const url = resolveInput(input, settings.searchTemplate());
    if (!url) return;
    if (tab) tab.navigate(url);
    else c.tabs.create({ url });
  });

  ipcMain.on('umbra:back', (event, id) => { const [, t] = activeTab(event, id); t?.goBack(); });
  ipcMain.on('umbra:forward', (event, id) => { const [, t] = activeTab(event, id); t?.goForward(); });
  ipcMain.on('umbra:stop', (event, id) => { const [, t] = activeTab(event, id); t?.stop(); });
  ipcMain.on('umbra:reload', (event, { id, hard } = {}) => {
    const [, t] = activeTab(event, id);
    t?.reload(!!hard);
  });
  ipcMain.on('umbra:home', (event, id) => {
    const [, t] = activeTab(event, id);
    t?.navigate(settings.get('homepage') || 'umbra://newtab');
  });

  ipcMain.on('umbra:zoom', (event, delta) => {
    const [, t] = activeTab(event);
    if (!t) return;
    const wc = t.wc;
    wc.setZoomLevel(delta === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + delta)));
  });

  ipcMain.on('umbra:devtools', (event) => {
    const [, t] = activeTab(event);
    if (t) t.wc.toggleDevTools();
  });

  // -- chrome UI ----------------------------------------------------------

  ipcMain.on('umbra:chrome-expanded', (event, expanded) => {
    const c = controllerFor(event);
    if (c) c.setChromeExpanded(!!expanded);
  });

  ipcMain.on('umbra:find', (event, { action, text, forward = true }) => {
    const c = controllerFor(event);
    const tab = c?.tabs.active;
    if (!c || !tab) return;
    if (action === 'open') {
      c.setFindOpen(true);
    } else if (action === 'close') {
      c.setFindOpen(false);
      tab.wc.stopFindInPage('clearSelection');
    } else if (action === 'search' && text) {
      tab.wc.findInPage(text, { forward, findNext: false });
    } else if (action === 'next' && text) {
      tab.wc.findInPage(text, { forward, findNext: true });
    }
  });

  ipcMain.on('umbra:new-window', (event, { isPrivate } = {}) => {
    windowsApi.createWindow({ isPrivate: !!isPrivate });
  });

  ipcMain.on('umbra:window-control', (event, action) => {
    const c = controllerFor(event);
    if (!c || c.win.isDestroyed()) return;
    if (action === 'minimize') c.win.minimize();
    else if (action === 'close') c.win.close();
    else if (action === 'maximize') {
      if (c.win.isMaximized()) c.win.unmaximize();
      else c.win.maximize();
    }
  });

  ipcMain.on('umbra:open-external', (_event, url) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });

  ipcMain.on('umbra:copy', (_event, text) => clipboard.writeText(String(text ?? '')));

  // -- settings -----------------------------------------------------------

  ipcMain.handle('umbra:settings-get', () => ({
    values: settings.get(),
    theme: getTheme(settings.get('theme')),
    themes: listThemes(),
    engines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name })),
  }));

  ipcMain.on('umbra:settings-set', (_event, { key, value }) => {
    settings.set(key, value);
    applySettingSideEffects(key, value);
    for (const c of windowsApi.allWindows()) {
      c.publishSettings();
      c.publish();
    }
  });

  ipcMain.handle('umbra:suggest', (event, query) => {
    const c = controllerFor(event);
    if (c?.isPrivate || !settings.get('rememberHistory')) return [];
    return require('./history').suggest(query);
  });

  ipcMain.handle('umbra:sites-list', () => listOrigins());
  ipcMain.on('umbra:site-forget', (_event, origin) => forgetOrigin(origin));

  ipcMain.handle('umbra:clear-data', async (event, what = {}) => {
    const c = controllerFor(event);
    if (!c) return false;
    const storages = [];
    if (what.cookies) storages.push('cookies');
    if (what.storage) storages.push('localstorage', 'indexdb', 'websql', 'shadercache', 'serviceworkers', 'cachestorage');
    if (storages.length) await c.session.clearStorageData({ storages });
    if (what.cache) await c.session.clearCache();
    if (what.history) {
      require('./history').clear();
      for (const tab of c.tabs.tabs) tab.wc.navigationHistory.clear();
    }
    return true;
  });

  ipcMain.handle('umbra:stats', (event) => {
    const c = controllerFor(event);
    return getStats(c?.tabs.active?.contentsId);
  });
}

/** Settings that need something to happen right now, not just be stored. */
function applySettingSideEffects(key, value) {
  if (key === 'secureDns' || key === 'dnsProvider') {
    app.configureHostResolver({
      secureDnsMode: settings.get('secureDns') ? 'secure' : 'automatic',
      secureDnsServers: settings.dnsServers(),
    });
  }
  if (key === 'webrtcPolicy') {
    for (const c of windowsApi.allWindows()) {
      for (const tab of c.tabs.tabs) {
        if (!tab.wc.isDestroyed()) tab.wc.setWebRTCIPHandlingPolicy(c.webrtcPolicy());
      }
    }
  }
  if (key === 'spoofUserAgent') {
    const { genericUserAgent } = require('./privacy');
    for (const c of windowsApi.allWindows()) {
      c.session.setUserAgent(value ? genericUserAgent() : app.userAgentFallback);
    }
  }
  if (key === 'theme') {
    for (const c of windowsApi.allWindows()) {
      if (c.win.isDestroyed()) continue;
      c.win.setBackgroundColor(getTheme(value).colors.surface);
    }
  }
}

module.exports = { register, seedFor };
