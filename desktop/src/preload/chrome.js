'use strict';
/**
 * Bridge for Umbra's own UI. The renderer gets named actions only — it can
 * never hand the main process a channel name or a path of its own choosing.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Events the main process is allowed to push at the UI. */
const INBOUND = new Set([
  'tabs',
  'settings',
  'downloads',
  'find-result',
  'focus-omnibox',
  'focus-find',
]);

const send = (channel, payload) => ipcRenderer.send(`umbra:${channel}`, payload);

contextBridge.exposeInMainWorld('umbra', {
  on(event, callback) {
    if (!INBOUND.has(event)) throw new Error(`unknown event: ${event}`);
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(`umbra:${event}`, listener);
    return () => ipcRenderer.removeListener(`umbra:${event}`, listener);
  },

  tabs: {
    create: (opts = {}) => send('tab-create', opts),
    close: (id) => send('tab-close', id),
    closeOthers: (id) => send('tab-close-others', id),
    activate: (id) => send('tab-activate', id),
    move: (id, index) => send('tab-move', { id, index }),
    mute: (id, muted) => send('tab-mute', { id, muted }),
  },

  nav: {
    go: (input, id) => send('navigate', { input, id }),
    back: (id) => send('back', id),
    forward: (id) => send('forward', id),
    reload: (hard = false, id) => send('reload', { hard, id }),
    stop: (id) => send('stop', id),
    home: (id) => send('home', id),
    zoom: (delta) => send('zoom', delta),
    devtools: () => send('devtools'),
  },

  ui: {
    expand: (expanded) => send('chrome-expanded', expanded),
    find: (action, text, forward = true) => send('find', { action, text, forward }),
    windowControl: (action) => send('window-control', action),
    newWindow: (isPrivate = false) => send('new-window', { isPrivate }),
  },

  settings: {
    read: () => ipcRenderer.invoke('umbra:settings-get'),
    write: (key, value) => send('settings-set', { key, value }),
  },

  data: {
    suggest: (query) => ipcRenderer.invoke('umbra:suggest', query),
    sites: () => ipcRenderer.invoke('umbra:sites-list'),
    forget: (host) => send('site-forget', host),
    clear: (what) => ipcRenderer.invoke('umbra:clear-data', what),
    stats: () => ipcRenderer.invoke('umbra:stats'),
  },

  openExternal: (url) => send('open-external', url),
  copy: (text) => send('copy', text),
});
