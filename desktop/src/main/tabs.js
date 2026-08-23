'use strict';
/**
 * Tabs are real Chromium views (WebContentsView), not iframes or <webview>
 * tags: each one is an out-of-process renderer with its own site isolation,
 * exactly like a stock Chromium tab.
 */
const path = require('node:path');
const { WebContentsView, Menu, clipboard, shell } = require('electron');
const { allowInsecure, wasUpgraded } = require('./rewrite');
const { resetTabStats, getStats } = require('./adblock');
const { log } = require('./log');
const { isTabUrl, isExternalUrl } = require('./urls');

const CONTENT_PRELOAD = path.join(__dirname, '..', 'preload', 'content.js');
const NEW_TAB = 'umbra://newtab';

/** Load failures that mean the host has no HTTPS, not that TLS is being attacked. */
const UPGRADE_FAILURES = new Set([
  -102, // CONNECTION_REFUSED
  -118, // CONNECTION_TIMED_OUT
  -324, // EMPTY_RESPONSE
]);

/** Errors Chromium reports that are not actually a failed page load. */
const IGNORED_FAILURES = new Set([-3 /* ABORTED */, 0]);

/** Schemes a tab may navigate to itself. file: and data: only come from the user. */
const NAVIGABLE_SCHEMES = /^(https?|umbra|file|about|blob|view-source):/i;

let nextId = 1;

class Tab {
  constructor(host, { url = NEW_TAB, partition }) {
    this.host = host;
    this.id = nextId++;
    this.title = '';
    this.url = url;
    this.favicon = null;
    this.loading = true;
    this.error = null;
    this.muted = false;

    this.view = new WebContentsView({
      webPreferences: {
        preload: CONTENT_PRELOAD,
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        safeDialogs: true,
        spellcheck: false,
        autoplayPolicy: 'user-gesture-required',
        backgroundThrottling: true,
        webviewTag: false,
        navigateOnDragDrop: false,
      },
    });
    this.view.setBackgroundColor('#00000000');

    this.wc = this.view.webContents;
    this.#wire();
    this.navigate(url);
  }

  get contentsId() {
    return this.wc.id;
  }

  #wire() {
    const wc = this.wc;
    const push = () => this.host.publish();

    wc.setWebRTCIPHandlingPolicy(this.host.webrtcPolicy());
    // Shortcuts have to work while focus is inside a page, which is where it
    // spends nearly all of its time.
    this.host.attachShortcuts(wc);

    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      this.host.recordVisit(this.url, title);
      push();
    });

    wc.on('page-favicon-updated', (_e, icons) => {
      const source = icons && icons.length ? icons[icons.length - 1] : null;
      // Resolved to a data URL through this tab's own session — see
      // BrowserWindowController.resolveFavicon for why that matters.
      this.host.resolveFavicon(source).then((favicon) => {
        if (this.wc.isDestroyed()) return;
        this.favicon = favicon;
        push();
      });
    });

    wc.on('did-start-loading', () => {
      this.loading = true;
      this.error = null;
      push();
    });

    wc.on('did-stop-loading', () => {
      this.loading = false;
      push();
    });

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame) return;
      this.url = details.url;
      resetTabStats(wc.id);
      push();
    });

    wc.on('did-navigate', (_e, url) => {
      this.url = url;
      this.host.recordVisit(url, this.title);
      push();
    });

    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      push();
    });

    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || IGNORED_FAILURES.has(code)) return;

      // If we are the reason the request went to HTTPS and HTTPS is what
      // broke, undo the upgrade for this host rather than blaming the site.
      if (UPGRADE_FAILURES.has(code) && wasUpgraded(validatedURL)) {
        allowInsecure(validatedURL);
        const downgraded = validatedURL.replace(/^https:/, 'http:');
        this.error = null;
        wc.loadURL(downgraded).catch(() => {});
        return;
      }

      this.error = { code, description, url: validatedURL };
      this.loading = false;
      const q = new URLSearchParams({ url: validatedURL, code: String(code), description });
      wc.loadURL(`umbra://error/?${q}`).catch(() => {});
      push();
    });

    wc.on('render-process-gone', (_e, details) => {
      this.error = { code: 0, description: details.reason, url: this.url };
      this.loading = false;
      push();
    });

    wc.on('media-started-playing', push);
    wc.on('media-paused', push);

    wc.on('found-in-page', (_e, result) => this.host.send('find-result', result));

    wc.on('enter-html-full-screen', () => this.host.setFullScreen(true));
    wc.on('leave-html-full-screen', () => this.host.setFullScreen(false));

    // Popups become tabs. Nothing gets to open a chromeless window.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'save-to-disk') return { action: 'allow' };
      if (isTabUrl(url)) {
        this.host.createTab({ url, background: disposition === 'background-tab' });
      } else if (isExternalUrl(url)) {
        shell.openExternal(url).catch(() => {});
      } else {
        log.warn('[umbra] refused window.open to an unhandled scheme:', String(url).slice(0, 64));
      }
      return { action: 'deny' };
    });

    wc.on('context-menu', (_e, params) => this.#contextMenu(params));

    wc.on('will-navigate', (event, url) => {
      const from = wc.getURL() || '';
      // A web page does not get to open files off disk, even though the
      // omnibox will load a file:// the user typed themselves.
      if (/^file:/i.test(url) && !/^file:/i.test(from) && !from.startsWith('umbra:')) {
        event.preventDefault();
        log.warn('[umbra] refused file: navigation from', from.slice(0, 64));
        return;
      }
      if (NAVIGABLE_SCHEMES.test(url)) return;
      event.preventDefault();

      // Handing an arbitrary scheme to the OS is how a page gets to launch
      // whatever the user happens to have registered for it. Only these few
      // are worth the risk, and everything else is dropped in silence.
      if (isExternalUrl(url)) {
        shell.openExternal(url).catch(() => {});
      } else {
        log.warn('[umbra] refused navigation to an unhandled scheme:', url.slice(0, 64));
      }
    });
  }

  #contextMenu(params) {
    const wc = this.wc;
    const items = [];
    const add = (item) => items.push(item);

    if (params.linkURL) {
      add({
        label: 'Open link in new tab',
        click: () => {
          if (isTabUrl(params.linkURL)) this.host.createTab({ url: params.linkURL, background: true });
        },
      });
      add({ label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) });
      add({ type: 'separator' });
    }
    if (params.srcURL && params.mediaType === 'image') {
      add({
        label: 'Open image in new tab',
        click: () => {
          if (isTabUrl(params.srcURL)) this.host.createTab({ url: params.srcURL, background: true });
        },
      });
      add({ label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) });
      add({ label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) });
      add({ type: 'separator' });
    }
    if (params.isEditable) {
      add({ role: 'undo' }, { role: 'redo' }, { type: 'separator' });
      add({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
      add({ type: 'separator' });
    } else if (params.selectionText) {
      add({ role: 'copy' });
      add({
        label: `Search for “${params.selectionText.slice(0, 32)}”`,
        click: () => this.host.createTab({ url: this.host.searchFor(params.selectionText), background: false }),
      });
      add({ type: 'separator' });
    }

    add({ label: 'Back', enabled: this.canGoBack(), click: () => this.goBack() });
    add({ label: 'Forward', enabled: this.canGoForward(), click: () => this.goForward() });
    add({ label: 'Reload', click: () => wc.reload() });
    add({ type: 'separator' });
    add({ label: 'Inspect element', click: () => { wc.inspectElement(params.x, params.y); } });

    Menu.buildFromTemplate(items).popup({ window: this.host.win });
  }

  navigate(url) {
    if (isExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
      return;
    }
    if (!NAVIGABLE_SCHEMES.test(url)) {
      log.warn('[umbra] refused navigation to an unhandled scheme:', String(url).slice(0, 64));
      return;
    }
    this.url = url;
    this.wc.loadURL(url).catch(() => { /* handled by did-fail-load */ });
  }

  canGoBack() {
    return this.wc.navigationHistory ? this.wc.navigationHistory.canGoBack() : false;
  }

  canGoForward() {
    return this.wc.navigationHistory ? this.wc.navigationHistory.canGoForward() : false;
  }

  goBack() {
    if (this.canGoBack()) this.wc.navigationHistory.goBack();
  }

  goForward() {
    if (this.canGoForward()) this.wc.navigationHistory.goForward();
  }

  reload(hard = false) {
    if (hard) this.wc.reloadIgnoringCache();
    else this.wc.reload();
  }

  stop() {
    this.wc.stop();
  }

  setMuted(muted) {
    this.muted = muted;
    this.wc.setAudioMuted(muted);
  }

  state(activeId) {
    const isInternal = this.url.startsWith('umbra://');
    let host = '';
    let secure = isInternal;
    try {
      const u = new URL(this.url);
      host = u.hostname;
      secure = isInternal || u.protocol === 'https:';
    } catch { /* about:blank and friends */ }

    return {
      id: this.id,
      contentsId: this.wc.isDestroyed() ? null : this.wc.id,
      title: this.title || host || 'New tab',
      url: this.url === NEW_TAB ? '' : this.url,
      host,
      favicon: this.favicon,
      loading: this.loading,
      secure,
      internal: isInternal,
      error: this.error,
      muted: this.muted,
      audible: !this.wc.isDestroyed() && this.wc.isCurrentlyAudible(),
      canGoBack: this.canGoBack(),
      canGoForward: this.canGoForward(),
      blocked: this.wc.isDestroyed() ? 0 : getStats(this.wc.id).tab,
      active: this.id === activeId,
    };
  }

  destroy() {
    if (!this.wc.isDestroyed()) {
      resetTabStats(this.wc.id);
      this.wc.close();
    }
  }
}

class TabManager {
  constructor(host) {
    this.host = host;
    this.tabs = [];
    this.activeId = null;
  }

  get active() {
    return this.tabs.find((t) => t.id === this.activeId) || null;
  }

  get(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }

  create({ url = NEW_TAB, background = false, index } = {}) {
    const tab = new Tab(this.host, { url, partition: this.host.partition });
    if (Number.isInteger(index)) this.tabs.splice(index, 0, tab);
    else this.tabs.push(tab);

    if (!background || this.activeId === null) this.activate(tab.id);
    else this.host.publish();
    return tab;
  }

  activate(id) {
    const tab = this.get(id);
    if (!tab) return null;

    const previous = this.active;
    if (previous && previous !== tab) this.host.detachView(previous.view);

    this.activeId = id;
    this.host.attachView(tab.view);
    this.host.layout();
    if (!tab.wc.isDestroyed()) tab.wc.focus();
    this.host.publish();
    return tab;
  }

  close(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;
    const [tab] = this.tabs.splice(index, 1);

    if (this.activeId === id) this.activeId = null;
    this.host.detachView(tab.view);
    tab.destroy();

    if (this.tabs.length === 0) {
      this.host.onLastTabClosed();
      return;
    }
    if (this.activeId === null) {
      this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id);
    } else {
      this.host.publish();
    }
  }

  move(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from === -1) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab);
    this.host.publish();
  }

  cycle(delta) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = (i + delta + this.tabs.length) % this.tabs.length;
    this.activate(this.tabs[next].id);
  }

  closeOthers(id) {
    for (const tab of [...this.tabs]) if (tab.id !== id) this.close(tab.id);
  }

  list() {
    return this.tabs.map((t) => t.state(this.activeId));
  }

  destroyAll() {
    for (const tab of this.tabs) tab.destroy();
    this.tabs = [];
    this.activeId = null;
  }
}

module.exports = { TabManager, Tab, NEW_TAB };
