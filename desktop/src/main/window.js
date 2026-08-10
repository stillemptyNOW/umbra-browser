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
const { TabManager, NEW_TAB } = require('./tabs');
const { getTheme } = require('./themes');
const { resolveInput } = require('./urls');

const CHROME_PRELOAD = path.join(__dirname, '..', 'preload', 'chrome.js');
const CHROME_URL = 'umbra://chrome/index.html';

const TABSTRIP_H = 40;
const TOOLBAR_H = 48;
const FINDBAR_H = 44;

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

    this.chrome = new WebContentsView({
      webPreferences: {
        preload: CHROME_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });
    this.chrome.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.chrome);
    this.chrome.webContents.loadURL(CHROME_URL);

    this.tabs = new TabManager(this);

    this.#wireWindow();
    this.#wireDownloads();

    this.chrome.webContents.once('did-finish-load', () => {
      this.publish();
      this.publishSettings();
    });

    for (const url of urls.length ? urls : [settings.get('homepage') || NEW_TAB]) {
      this.tabs.create({ url, background: true });
    }
    if (this.tabs.tabs.length) this.tabs.activate(this.tabs.tabs[0].id);

    windows.add(this);
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
      this.tabs.destroyAll();
      if (this.isPrivate) {
        // In-memory partition, but clear explicitly so nothing lingers in caches.
        this.session.clearStorageData().catch(() => {});
      }
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

  webrtcPolicy() {
    return WEBRTC_POLICIES[settings.get('webrtcPolicy')] || 'default_public_interface_only';
  }

  searchFor(text) {
    return resolveInput(text, settings.searchTemplate());
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
    shell.openExternal(url).catch(() => {});
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

module.exports = { createWindow, allWindows, focusedWindow, prepareSession, BrowserWindowController };
