'use strict';
/**
 * Every network-level privacy defence Umbra applies, in one place.
 *
 * A note on listener ownership: Electron allows exactly one listener per
 * webRequest event per session, and the Ghostery blocker installs its own for
 * onBeforeRequest/onHeadersReceived. So this module registers *after* the
 * blocker and calls into it, rather than letting the two fight over the slot.
 * See attachRequestPipeline() below.
 */
const { getDomain } = require('tldts');
const { webContents } = require('electron');
const {
  TRACKING_PARAMS,
  TELEMETRY_HOSTS,
  isLocalHost,
  isTelemetryHost,
  stripTrackingParams,
  upgradeToHttps,
  allowInsecure,
  wasUpgraded,
  httpsExceptions,
} = require('./rewrite');

// ---------------------------------------------------------------------------
// Command line — applied once, before app ready.
// ---------------------------------------------------------------------------

/**
 * Chromium features that phone home, profile the user, or exist purely to
 * serve ad-tech. Unknown names are ignored by Chromium, which keeps this list
 * safe to carry across engine upgrades.
 */
const DISABLED_FEATURES = [
  // Google service integration
  'Translate',
  'MediaRouter',
  'OptimizationHints',
  'OptimizationGuideModelDownloading',
  'InterestFeedContentSuggestions',
  'AutofillServerCommunication',
  'CalculateNativeWinOcclusion',
  'SafeBrowsingEnhancedProtection',
  // Privacy Sandbox — ad measurement and interest profiling
  'PrivacySandboxSettings3',
  'PrivacySandboxSettings4',
  'BrowsingTopics',
  'BrowsingTopicsDocumentAPI',
  'InterestGroupStorage',
  'Fledge',
  'FledgeBiddingAndAuctionServer',
  'AttributionReporting',
  'AttributionReportingCrossAppWeb',
  'PrivateAggregationApi',
  'TrustTokens',
  'SharedStorageAPI',
  'FencedFrames',
  // High-entropy fingerprinting surfaces with near-zero legitimate use
  'IdleDetection',
  'ComputePressure',
  'WebNfc',
  'Serial',
  'WebHID',
  'WebBluetooth',
  'DigitalGoodsApi',
];

const SWITCHES = [
  ['no-pings', null],
  ['no-default-browser-check', null],
  ['no-first-run', null],
  ['disable-domain-reliability', null],
  ['disable-background-networking', null],
  ['disable-component-update', null],
  ['disable-breakpad', null],
  ['disable-crash-reporter', null],
  ['disable-sync', null],
  ['disable-client-side-phishing-detection', null],
  ['disable-speech-api', null],
  ['disable-reading-from-canvas', null], // strict mode re-enables per site
  ['enable-features', 'PartitionedCookies,ThirdPartyStoragePartitioning'],
];

function hardenCommandLine(app) {
  app.commandLine.appendSwitch('disable-features', DISABLED_FEATURES.join(','));
  for (const [name, value] of SWITCHES) {
    // Canvas is only blanked wholesale in strict mode; standard mode farbles.
    if (name === 'disable-reading-from-canvas') continue;
    if (value === null) app.commandLine.appendSwitch(name);
    else app.commandLine.appendSwitch(name, value);
  }
}

// ---------------------------------------------------------------------------
// User agent and client hints
// ---------------------------------------------------------------------------

/**
 * Look like an ordinary Chrome install. Umbra's own name in the UA would be a
 * near-unique fingerprint given how few people run it, so the honest-looking
 * choice and the private one point the same way here.
 */
function genericUserAgent() {
  const major = process.versions.chrome.split('.')[0];
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'linux'
        ? 'X11; Linux x86_64'
        : 'Windows NT 10.0; Win64; x64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function clientHints() {
  const major = process.versions.chrome.split('.')[0];
  const platform =
    process.platform === 'darwin' ? 'macOS' : process.platform === 'linux' ? 'Linux' : 'Windows';
  return {
    'sec-ch-ua': `"Chromium";v="${major}", "Not(A:Brand";v="24", "Google Chrome";v="${major}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${platform}"`,
  };
}

/** High-entropy hints that reveal CPU, OS build and device model. */
const DROPPED_HEADERS = [
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-model',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-wow64',
  'sec-ch-ua-form-factors',
  'x-client-data', // Chrome's Google-only experiment identifier
];

// ---------------------------------------------------------------------------
// First-party / third-party classification
//
// URL rewriting itself lives in ./rewrite, free of Electron imports so it can
// be unit tested with plain Node. What stays here is the part that genuinely
// needs a live webContents to answer.
// ---------------------------------------------------------------------------

/** The registrable domain of the page the request was made from. */
function initiatorDomain(details) {
  try {
    const top = details.frame?.top?.url;
    if (top) return getDomain(top);
  } catch {
    /* frame may already be gone */
  }
  if (details.webContentsId != null) {
    const wc = webContents.fromId(details.webContentsId);
    const url = wc && !wc.isDestroyed() ? wc.getURL() : null;
    if (url) return getDomain(url);
  }
  if (details.referrer) return getDomain(details.referrer);
  return null;
}

function isThirdParty(details) {
  if (details.resourceType === 'mainFrame') return false;
  const from = initiatorDomain(details);
  const to = getDomain(details.url);
  if (!from || !to) return false;
  return from !== to;
}

// ---------------------------------------------------------------------------
// Request pipeline
// ---------------------------------------------------------------------------

const NAVIGATION_TYPES = new Set(['mainFrame', 'subFrame']);

/**
 * Install the single owner of onBeforeRequest / onHeadersReceived for a
 * session. `getBlocker` returns the live ElectronBlocker (or null) so that
 * toggling ad blocking at runtime does not require re-registering listeners.
 */
function attachRequestPipeline(ses, { settings, getBlocker }) {
  const filter = { urls: ['<all_urls>'] };

  ses.webRequest.onBeforeRequest(filter, (details, callback) => {
    const cfg = settings.get();

    if (isTelemetryHost(details.url)) return callback({ cancel: true });

    // Rewrites only apply to navigations. Doing it to XHR/fetch would corrupt
    // API calls that legitimately carry these parameters.
    if (NAVIGATION_TYPES.has(details.resourceType)) {
      if (cfg.stripTrackingParams) {
        const cleaned = stripTrackingParams(details.url);
        if (cleaned) return callback({ redirectURL: cleaned });
      }
      if (cfg.httpsOnly) {
        const secure = upgradeToHttps(details.url);
        if (secure) return callback({ redirectURL: secure });
      }
    }

    const blocker = getBlocker();
    if (blocker && (cfg.blockAds || cfg.blockTrackers)) {
      return blocker.onBeforeRequest(details, callback);
    }
    callback({});
  });

  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const cfg = settings.get();
    const headers = { ...details.requestHeaders };

    for (const key of Object.keys(headers)) {
      if (DROPPED_HEADERS.includes(key.toLowerCase())) delete headers[key];
    }

    if (cfg.spoofUserAgent) Object.assign(headers, clientHints());

    if (cfg.sendGpc) {
      headers['Sec-GPC'] = '1';
      headers['DNT'] = '1';
    }

    // Cross-site referrers leak the exact page you came from; send the origin.
    if (cfg.trimReferrer && headers.Referer) {
      try {
        const ref = new URL(headers.Referer);
        if (getDomain(ref.href) !== getDomain(details.url)) {
          headers.Referer = ref.origin + '/';
        }
      } catch {
        delete headers.Referer;
      }
    }

    if (cfg.blockThirdPartyCookies && isThirdParty(details)) {
      delete headers.Cookie;
      delete headers.cookie;
    }

    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived(filter, (details, callback) => {
    const cfg = settings.get();

    const finish = (fromBlocker) => {
      const base = fromBlocker && fromBlocker.responseHeaders
        ? fromBlocker.responseHeaders
        : details.responseHeaders;

      if (!cfg.blockThirdPartyCookies || !isThirdParty(details) || !base) {
        return callback(fromBlocker || {});
      }
      const headers = {};
      for (const [k, v] of Object.entries(base)) {
        if (k.toLowerCase() !== 'set-cookie') headers[k] = v;
      }
      callback({ ...(fromBlocker || {}), responseHeaders: headers });
    };

    const blocker = getBlocker();
    if (blocker && cfg.blockCosmetics) blocker.onHeadersReceived(details, finish);
    else finish(null);
  });
}

// ---------------------------------------------------------------------------
// Permissions — deny by default
// ---------------------------------------------------------------------------

const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const ALWAYS_DENIED = new Set([
  'midi', 'midiSysex', 'hid', 'serial', 'usb', 'bluetooth', 'idle-detection',
  'window-management', 'local-fonts', 'storage-access', 'top-level-storage-access',
  'speaker-selection', 'display-capture', 'clipboard-read',
]);

function permissionDecision(permission, cfg) {
  if (ALWAYS_ALLOWED.has(permission)) return true;
  if (ALWAYS_DENIED.has(permission)) return false;
  if (permission === 'media' || permission === 'mediaKeySystem') return !!cfg.allowMedia;
  if (permission === 'geolocation') return !!cfg.allowGeolocation;
  if (permission === 'notifications') return !!cfg.allowNotifications;
  return false;
}

function attachPermissionHandlers(ses, { settings }) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permissionDecision(permission, settings.get()));
  });
  ses.setPermissionCheckHandler((_wc, permission) =>
    permissionDecision(permission, settings.get())
  );
  // Screen sharing is never granted silently.
  ses.setDisplayMediaRequestHandler((_req, callback) => callback({}));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function hardenSession(ses, { settings, getBlocker }) {
  const cfg = settings.get();

  ses.setUserAgent(cfg.spoofUserAgent ? genericUserAgent() : ses.getUserAgent());
  // Chromium downloads dictionaries from Google for the spellchecker.
  ses.setSpellCheckerEnabled(false);

  attachRequestPipeline(ses, { settings, getBlocker });
  attachPermissionHandlers(ses, { settings });

  return ses;
}

// Rewriting helpers are not re-exported: callers take them from ./rewrite so
// there is only ever one import path to a given function.
module.exports = {
  hardenCommandLine,
  hardenSession,
  genericUserAgent,
  isThirdParty,
  permissionDecision,
};
