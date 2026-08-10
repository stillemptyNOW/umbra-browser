'use strict';
/**
 * Ad and tracker blocking, backed by Ghostery's filter engine running EasyList,
 * EasyPrivacy and the uBlock Origin filter sets.
 *
 * Load order, best first:
 *
 *   1. a refreshed engine cached in the user data directory
 *   2. the engine compiled into the app at build time
 *   3. a fetch from the filter CDN
 *
 * The bundled engine is what makes the first launch work offline and without
 * a single outbound request. The refresh in (1) is the only network call
 * Umbra makes on its own initiative; it carries no identifier, it can be
 * turned off, and PRIVACY.md says so plainly rather than burying it.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

const BUNDLED = path.join(__dirname, '..', '..', 'filters', 'engine.bin');
const REFRESH_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

let blocker = null;
let state = { ready: false, source: 'none', error: null, updatedAt: null };

/** Blocked-request counters: total for the session, plus per web contents. */
const stats = {
  total: 0,
  byTab: new Map(),
  since: Date.now(),
};

const cachePath = () => path.join(app.getPath('userData'), 'filters.engine.bin');

function recordBlock(request) {
  stats.total += 1;
  const tabId = request?.tabId;
  if (tabId != null && tabId !== -1) {
    stats.byTab.set(tabId, (stats.byTab.get(tabId) || 0) + 1);
  }
}

async function deserialiseFrom(file) {
  const buffer = await fs.readFile(file);
  return ElectronBlocker.deserialize(new Uint8Array(buffer));
}

async function ageOf(file) {
  try {
    return Date.now() - (await fs.stat(file)).mtimeMs;
  } catch {
    return Infinity;
  }
}

/**
 * Pull a fresh engine and cache it for next launch. Deliberately not awaited
 * by start-up: the browser is already blocking with whatever it loaded, and a
 * slow CDN must not hold the first window hostage.
 */
async function refreshInBackground() {
  const file = cachePath();
  try {
    const fresh = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    await fs.writeFile(file, fresh.serialize());
    state.updatedAt = Date.now();
  } catch (err) {
    // Offline, or the CDN is unreachable. The bundled engine carries on.
    console.warn('[umbra] filter refresh failed:', err.message);
  }
}

async function initBlocker(settings) {
  const wantsRefresh = settings ? settings.get('updateFilters') !== false : true;
  const cache = cachePath();

  for (const [source, file] of [['cached', cache], ['bundled', BUNDLED]]) {
    try {
      blocker = await deserialiseFrom(file);
      state = { ready: true, source, error: null, updatedAt: Date.now() - (await ageOf(file)) };
      break;
    } catch {
      // Missing or from an incompatible engine version; try the next one.
    }
  }

  if (!blocker) {
    if (wantsRefresh) {
      try {
        blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
        await fs.writeFile(cache, blocker.serialize()).catch(() => {});
        state = { ready: true, source: 'network', error: null, updatedAt: Date.now() };
      } catch (err) {
        state = { ready: false, source: 'none', error: err.message, updatedAt: null };
      }
    } else {
      state = {
        ready: false,
        source: 'none',
        error: 'No bundled filters and online updates are turned off',
        updatedAt: null,
      };
    }
  }

  // Carry on unprotected but honest rather than refusing to start.
  if (!blocker) {
    blocker = new ElectronBlocker();
    console.error('[umbra] no filter engine available:', state.error);
  }

  blocker.on('request-blocked', (event) => recordBlock(event.request ?? event));
  blocker.on('request-redirected', (event) => recordBlock(event.request ?? event));

  if (wantsRefresh && state.source !== 'network' && (await ageOf(cache)) > REFRESH_AFTER_MS) {
    refreshInBackground();
  }

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
    ready: state.ready,
    source: state.source,
    error: state.error,
    updatedAt: state.updatedAt,
    total: stats.total,
    tab: tabId != null ? stats.byTab.get(tabId) || 0 : 0,
    since: stats.since,
  };
}

function resetTabStats(tabId) {
  stats.byTab.delete(tabId);
}

module.exports = { initBlocker, enableInSession, getBlocker, getStats, resetTabStats };
