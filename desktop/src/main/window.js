'use strict';
/**
 * A browser window: one chrome UI view stacked on top of one tab view.
 *
 * The chrome view normally occupies a strip at the top. When a popover opens
 * it is expanded to cover the whole window and made transparent below the
 * toolbar — that gives click-outside-to-dismiss for free, without a second
 * renderer or an OS-level popup that would render outside the window on Linux.
 */
const path = require('node:path');
const { BaseWindow, WebContentsView, session, screen, shell } = require('electron');
const { settings } = require('./settings');
const { hardenSession, genericUserAgent } = require('./privacy');
const { enableInSession, getBlocker, getStats } = require('./adblock');
const { serveOn } = require('./internal');
const extensions = require('./extensions');
const { log } = require('./log');
const shortcuts = require('./shortcuts');
const { TabManager, NEW_TAB } = require('./tabs');
const { getTheme } = require('./themes');
const { resolveInput } = require('./urls');

const CHROME_PRELOAD = path.join(__dirname, '..', 'preload', 'chrome.js');
const CHROME_URL = 'umbra://chrome/index.html';

const TABSTRIP_H = 40;
const TOOLBAR_H = 48;
const FINDBAR_H = 44;

/** A favicon larger than this is not a favicon. */
const MAX_FAVICON_BYTES = 256 * 1024;
const MAX_FAVICON_CACHE = 256;

const POPUP_W = 380;
const POPUP_H = 560;

const WEBRTC_POLICIES = {
  default: 'default',
  'public-only': 'default_public_interface_only',
  'disable-udp': 'disable_non_proxied_udp',
};

const windows = new Set();
const hardenedPartitions = new Set();
let privateCounter = 0;

/** Sessions are hardened once; every window on a partition shares the work. */
function prepareSession(partition) {
  const ses = session.fromPartition(partition);
  if (hardenedPartitions.has(partition)) return ses;
  hardenedPartitions.add(partition);

  serveOn(ses);

  // The blocker registers its cosmetic-filter preload and IPC first, then
  // hardenSession takes over the webRequest listeners and calls back into it.
  enableInSession(ses);
  hardenSession(ses, { settings, getBlocker });

  // Fire and forget for private windows, which are created on demand. The
  // default session is awaited during start-up instead, so extensions are in
  // place before the first page loads — see prepareDefaultSession.
  extensions.loadInto(ses, partition).catch((err) => {
    log.error('[umbra] extensions failed to load:', err.message);
  });
  return ses;
}

/** Await extension loading for the main profile before the first window. */
async function prepareDefaultSession() {
  const partition = 'persist:umbra';
  const ses = session.fromPartition(partition);
  if (!hardenedPartitions.has(partition)) {
    hardenedPartitions.add(partition);
    serveOn(ses);
    enableInSession(ses);
    hardenSession(ses, { settings, getBlocker });
  }
  await extensions.loadInto(ses, partition);
  return ses;
}

class BrowserWindowController {
  constructor({ isPrivate = false, urls = [] } = {}) {
    this.isPrivate = isPrivate;
    this.partition = isPrivate ? `umbra-private-${++privateCounter}` : 'persist:umbra';
    this.session = prepareSession(this.partition);
    this.findOpen = false;
    this.chromeExpanded = false;
    this.fullScreen = false;
    this.downloads = [];
    this.favicons = new Map();
    this.popup = null;

    const saved = settings.get('windowState');
    const bounds = this.#sanitiseBounds(saved);

    this.win = new BaseWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x ?? undefined,
      y: bounds.y ?? undefined,
      minWidth: 520,
      minHeight: 380,
      title: isPrivate ? 'Umbra — Private' : 'Umbra',
      backgroundColor: getTheme(settings.get('theme')).colors.surface,
      autoHideMenuBar: true,
      // macOS keeps its traffic lights; elsewhere the chrome UI draws its own
      // caption buttons, because titleBarOverlay has no web contents to attach
      // to on a BaseWindow.
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
    });
    if (saved?.maximized) this.win.maximize();

    // Hands this window the application menu, which is what makes Ctrl+T and
    // the rest of the accelerators fire at all.
    require('./menu').attachTo(this.win);

    this.chrome = new WebContentsView({
      webPreferences: {
        preload: CHROME_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        // The chrome preload only needs ipcRenderer and contextBridge, both of
        // which a sandboxed preload can reach — so there is no reason for the
        // UI renderer to run with more privilege than a web page.
        sandbox: true,
        spellcheck: false,
        webviewTag: false,
      },
    });
    this.chrome.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.chrome);

    // A silent exception in the chrome renderer looks exactly like a dead
    // button, which is a miserable thing to debug from a screenshot. Surface
    // them on the main process's stderr.
    this.chrome.webContents.on('console-message', (...args) => {
      const [event, legacyLevel, legacyMessage, legacyLine, legacySource] = args;
      const level = event?.level ?? legacyLevel;
      const message = event?.message ?? legacyMessage;
      const line = event?.lineNumber ?? legacyLine;
      const source = event?.sourceId ?? legacySource;
      if (level === 'error' || level === 3 || level === 'warning' || level === 2) {
        log.error(`[umbra chrome] ${message}  (${source}:${line})`);
      }
    });

    shortcuts.attach(this.chrome.webContents, this);
    this.chrome.webContents.loadURL(CHROME_URL);

    // `npm run dev` opens the inspector on the browser's own interface, which
    // is otherwise unreachable — Ctrl+Shift+I targets the page, not the chrome.
    if (process.argv.includes('--dev')) {
      this.chrome.webContents.openDevTools({ mode: 'detach' });
    }

    this.tabs = new TabManager(this);

    this.#wireWindow();
    this.#wireDownloads();

    this.chrome.webContents.once('did-finish-load', () => {
      this.publish();
      this.publishSettings();
    });

    const start = this.#startUrls(urls);
    for (const url of start.urls) {
      this.tabs.create({ url, background: true });
    }
    if (this.tabs.tabs.length) {
      const index = Math.max(0, Math.min(start.active, this.tabs.tabs.length - 1));
      this.tabs.activate(this.tabs.tabs[index].id);
    }

    windows.add(this);
  }

  // -- session --------------------------------------------------------------

  #startUrls(urls) {
    if (urls.length) return { urls, active: 0 };
    const homepage = settings.get('homepage') || NEW_TAB;
    if (this.isPrivate || !settings.get('restoreTabs')) {
      return { urls: [homepage], active: 0 };
    }
    const saved = settings.get('sessionTabs');
    if (!Array.isArray(saved) || saved.length === 0) {
      return { urls: [homepage], active: 0 };
    }
    return { urls: saved, active: settings.get('sessionActive') || 0 };
  }

  persistSession() {
    if (this.isPrivate) return;
    const urls = this.tabs.tabs
      .map((t) => t.url)
      .filter((u) => typeof u === 'string' && /^(https?:|umbra:)/i.test(u) && !u.startsWith('umbra://error'));
    settings.set('sessionTabs', urls);
    settings.set(
      'sessionActive',
      Math.max(0, this.tabs.tabs.findIndex((t) => t.id === this.tabs.activeId))
    );
  }

  // -- geometry -------------------------------------------------------------

  #sanitiseBounds(saved) {
    const fallback = { width: 1360, height: 880, x: null, y: null };
    if (!saved) return fallback;
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(Math.max(saved.width || fallback.width, 520), area.width);
    const height = Math.min(Math.max(saved.height || fallback.height, 380), area.height);
    // A window restored onto a monitor that is no longer attached is invisible.
    const onScreen =
      saved.x != null &&
      saved.y != null &&
      screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return saved.x < w.x + w.width && saved.x + width > w.x &&
               saved.y < w.y + w.height && saved.y + height > w.y;
      });
    return { width, height, x: onScreen ? saved.x : null, y: onScreen ? saved.y : null };
  }

  chromeHeight() {
    if (this.fullScreen) return 0;
    return TABSTRIP_H + TOOLBAR_H + (this.findOpen ? FINDBAR_H : 0);
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    const top = this.chromeHeight();

    this.chrome.setBounds(
      this.chromeExpanded && !this.fullScreen
        ? { x: 0, y: 0, width, height }
        : { x: 0, y: 0, width, height: top }
    );

    const active = this.tabs.active;
    if (active) {
      active.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
    }
  }

  attachView(view) {
    this.win.contentView.addChildView(view);
    // Re-adding the chrome moves it back to the top of the stacking order.
    this.win.contentView.addChildView(this.chrome);
  }

  detachView(view) {
    try {
      this.win.contentView.removeChildView(view);
    } catch { /* already gone */ }
  }

  setChromeExpanded(expanded) {
    if (this.chromeExpanded === expanded) return;
    this.chromeExpanded = expanded;
    this.layout();
  }

  // -- extension action popups ----------------------------------------------

  /**
   * Extension popups are real pages on a chrome-extension:// origin, so they
   * need their own view rather than an iframe in the chrome UI — the chrome's
   * CSP forbids remote origins, and rightly so.
   */
  openExtensionPopup(extensionPath, anchor) {
    this.closeExtensionPopup();

    let url;
    try {
      url = extensions.popupUrl(extensionPath);
    } catch {
      url = null;
    }
    if (!url) return false;

    this.popup = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.popup.setBackgroundColor(getTheme(settings.get('theme')).colors.surface);
    this.win.contentView.addChildView(this.popup);

    const { width, height } = this.win.getContentBounds();
    const w = Math.min(POPUP_W, width - 20);
    const h = Math.min(POPUP_H, height - this.chromeHeight() - 20);
    const right = anchor?.right ?? width - 10;
    this.popup.setBounds({
      x: Math.max(10, Math.min(Math.round(right - w), width - w - 10)),
      y: this.chromeHeight() + 4,
      width: w,
      height: h,
    });

    this.popup.webContents.loadURL(url).catch(() => this.closeExtensionPopup());
    this.popup.webContents.once('did-finish-load', () => this.popup?.webContents.focus());
    return true;
  }

  closeExtensionPopup() {
    if (!this.popup) return;
    try {
      this.win.contentView.removeChildView(this.popup);
      this.popup.webContents.close();
    } catch { /* already gone */ }
    this.popup = null;
  }

  setFindOpen(open) {
    if (this.findOpen === open) return;
    this.findOpen = open;
    this.layout();
  }

  setFullScreen(on) {
    this.fullScreen = on;
    this.win.setFullScreen(on);
    this.layout();
  }

  // -- wiring ---------------------------------------------------------------

  #wireWindow() {
    const persist = () => {
      if (this.isPrivate || this.win.isDestroyed()) return;
      const maximized = this.win.isMaximized();
      if (!maximized) {
        const b = this.win.getBounds();
        settings.set('windowState', { width: b.width, height: b.height, x: b.x, y: b.y, maximized });
      } else {
        settings.set('windowState', { ...settings.get('windowState'), maximized: true });
      }
    };

    this.win.on('resize', () => { this.layout(); persist(); });
    this.win.on('move', persist);
    this.win.on('maximize', () => { this.layout(); persist(); });
    this.win.on('unmaximize', () => { this.layout(); persist(); });
    this.win.on('enter-full-screen', () => { this.fullScreen = true; this.layout(); this.publish(); });
    this.win.on('leave-full-screen', () => { this.fullScreen = false; this.layout(); this.publish(); });
    this.win.on('focus', () => this.publish());

    this.win.on('closed', () => {
      windows.delete(this);
      this.closeExtensionPopup();
      this.tabs.destroyAll();
      if (this.isPrivate) {
        // The partition is in-memory, but the HTTP cache and any code caches
        // outlive it unless they are cleared explicitly.
        this.session.clearStorageData().catch(() => {});
        this.session.clearCache().catch(() => {});
        this.session.clearCodeCaches({}).catch(() => {});
        this.session.clearAuthCache().catch(() => {});
      }
      this.favicons.clear();
    });
  }

  #wireDownloads() {
    this.session.on('will-download', (_event, item) => {
      const entry = {
        id: `${Date.now()}-${this.downloads.length}`,
        filename: item.getFilename(),
        url: item.getURL(),
        received: 0,
        total: item.getTotalBytes(),
        state: 'progressing',
        path: null,
      };
      this.downloads.unshift(entry);
      this.downloads = this.downloads.slice(0, 40);

      item.on('updated', (_e, state) => {
        entry.received = item.getReceivedBytes();
        entry.state = state;
        this.send('downloads', this.downloads);
      });
      item.once('done', (_e, state) => {
        entry.state = state;
        entry.path = state === 'completed' ? item.getSavePath() : null;
        this.send('downloads', this.downloads);
      });
      this.send('downloads', this.downloads);
    });
  }

  // -- host interface used by TabManager ------------------------------------

  createTab(opts) {
    return this.tabs.create(opts);
  }

  newWindow(isPrivate) {
    createWindow({ isPrivate: !!isPrivate });
  }

  /** Tabs call this so their pages get the same shortcuts as the chrome. */
  attachShortcuts(webContents) {
    shortcuts.attach(webContents, this);
  }

  webrtcPolicy() {
    return WEBRTC_POLICIES[settings.get('webrtcPolicy')] || 'default_public_interface_only';
  }

  searchFor(text) {
    return resolveInput(text, settings.searchTemplate());
  }

  /**
   * Turn a page's favicon URL into a data URL, fetched through the tab's own
   * session.
   *
   * Handing the raw URL to the chrome UI and letting <img> load it would send
   * the request from the UI renderer, which lives in the default session: it
   * would skip the tab's partition, skip the blocker, skip the cookie policy,
   * and in a private window it would leak the visit into the persistent
   * profile. Fetching here keeps every favicon request inside the same
   * boundary as the page that asked for it.
   */
  async resolveFavicon(url) {
    if (!url) return null;
    if (url.startsWith('data:')) return url.length <= MAX_FAVICON_BYTES ? url : null;
    if (!/^https?:/i.test(url)) return null;

    if (this.favicons.has(url)) return this.favicons.get(url);

    let result = null;
    try {
      const response = await this.session.fetch(url, {
        credentials: 'omit',
        cache: 'force-cache',
      });
      const type = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (response.ok && type.startsWith('image/')) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length && bytes.length <= MAX_FAVICON_BYTES) {
          result = `data:${type};base64,${bytes.toString('base64')}`;
        }
      }
    } catch {
      // Blocked, offline, or the site simply has no favicon. The UI falls
      // back to its globe glyph.
    }

    if (this.favicons.size >= MAX_FAVICON_CACHE) {
      this.favicons.delete(this.favicons.keys().next().value);
    }
    this.favicons.set(url, result);
    return result;
  }

  /** Private windows and "don't remember history" both mean: write nothing. */
  recordVisit(url, title) {
    if (this.isPrivate || !settings.get('rememberHistory')) return;
    require('./history').record(url, title);
  }

  onLastTabClosed() {
    this.win.close();
  }

  // -- talking to the chrome UI ---------------------------------------------

  send(channel, payload) {
    if (this.chrome.webContents.isDestroyed()) return;
    this.chrome.webContents.send(`umbra:${channel}`, payload);
  }

  publish() {
    if (this.win.isDestroyed()) return;
    this.persistSession();
    this.send('tabs', {
      tabs: this.tabs.list(),
      activeId: this.tabs.activeId,
      isPrivate: this.isPrivate,
      fullScreen: this.fullScreen,
      maximized: this.win.isMaximized(),
      stats: getStats(this.tabs.active?.contentsId),
      platform: process.platform,
    });
  }

  publishSettings() {
    this.send('settings', {
      values: settings.get(),
      theme: getTheme(settings.get('theme')),
      userAgent: settings.get('spoofUserAgent') ? genericUserAgent() : this.session.getUserAgent(),
      version: {
        umbra: require('../../package.json').version,
        chromium: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
      },
    });
  }

  openExternal(url) {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  }
}

function createWindow(opts) {
  return new BrowserWindowController(opts);
}

function allWindows() {
  return [...windows];
}

function focusedWindow() {
  return allWindows().find((w) => !w.win.isDestroyed() && w.win.isFocused()) || allWindows()[0] || null;
}

module.exports = {
  createWindow,
  allWindows,
  focusedWindow,
  prepareSession,
  prepareDefaultSession,
  BrowserWindowController,
};
