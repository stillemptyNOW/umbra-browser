'use strict';
/**
 * Ad and tracker blocking, backed by Ghostery's filter engine running EasyList,
 * EasyPrivacy and the uBlock Origin filter sets.
 *
 * The compiled engine is cached on disk, so start-up after the first run is
 * offline and instant. If the very first fetch fails there is no network
 * blocking until the next launch — the browser still works, it just says so
 * in the shield popover rather than pretending to protect you.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

let blocker = null;
let ready = false;
let lastError = null;

/** Blocked-request counters: total for the session, plus per web contents. */
const stats = {
  total: 0,
  byTab: new Map(),
  since: Date.now(),
};

function cachePath() {
  return path.join(app.getPath('userData'), 'filters.engine.bin');
}

const caching = {
  path: '',
  read: (p) => fs.readFile(p),
  write: (p, buffer) => fs.writeFile(p, buffer),
};

function recordBlock(request) {
  stats.total += 1;
  const tabId = request?.tabId;
  if (tabId != null && tabId !== -1) {
    stats.byTab.set(tabId, (stats.byTab.get(tabId) || 0) + 1);
  }
}

async function initBlocker() {
  caching.path = cachePath();
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, caching);
    ready = true;
    lastError = null;
  } catch (err) {
    // Offline, or the CDN is unreachable. Carry on unprotected but honest.
    lastError = err.message;
    blocker = new ElectronBlocker();
    ready = false;
    console.error('[umbra] filter lists unavailable:', err.message);
  }

  blocker.on('request-blocked', (event) => recordBlock(event.request ?? event));
  blocker.on('request-redirected', (event) => recordBlock(event.request ?? event));
  return blocker;
}

/**
 * Register the blocker's cosmetic-filter preload and IPC handlers on a session.
 *
 * Its webRequest listeners are intentionally overwritten straight afterwards by
 * privacy.attachRequestPipeline(), which calls back into blocker.onBeforeRequest
 * and blocker.onHeadersReceived. Electron only keeps one listener per event, so
 * composing them in one place is the only way to run both.
 */
function enableInSession(ses) {
  if (!blocker) return;
  blocker.enableBlockingInSession(ses);
}

const getBlocker = () => blocker;

function getStats(tabId) {
  return {
    ready,
    error: lastError,
    total: stats.total,
    tab: tabId != null ? stats.byTab.get(tabId) || 0 : 0,
    since: stats.since,
  };
}

function resetTabStats(tabId) {
  stats.byTab.delete(tabId);
}

module.exports = { initBlocker, enableInSession, getBlocker, getStats, resetTabStats };
