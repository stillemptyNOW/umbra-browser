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
// URL rewriting
// ---------------------------------------------------------------------------

/** Query parameters that exist only to attribute a click to a campaign. */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'utm_name', 'utm_cid', 'utm_reader', 'utm_source_platform', 'utm_creative_format',
  'utm_marketing_tactic', 'utm_referrer', 'utm_social', 'utm_social-type', 'utm_brand',
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid',
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
  'msclkid', 'twclid', 'ttclid', 'igshid', 'igsh', 'li_fat_id', 'epik', 'rdt_cid',
  'mc_cid', 'mc_eid', 'mkt_tok', 'vero_id', 'vero_conv', '_openstat', 'yclid', 'ysclid',
  'oly_anon_id', 'oly_enc_id', 'hsCtaTracking', '__hssc', '__hstc', '__hsfp', 'hsa_cam',
  'hsa_grp', 'hsa_ad', 'hsa_src', 'hsa_tgt', 'hsa_kw', 'hsa_mt', 'hsa_net', 'hsa_ver',
  'pk_campaign', 'pk_kwd', 'pk_source', 'pk_medium', 'piwik_campaign', 'piwik_kwd',
  'matomo_campaign', 'matomo_kwd', 's_cid', 'ref_src', 'ref_url', 'spm', 'scm',
  'share_source', 'share_medium', 'from_source', 'wt_mc', 'wt_zmc', 'cmpid', 'campaign_id',
  '_ga', '_gl', 'ir_clickid', 'irclickid', 'sc_campaign', 'sc_channel', 'sc_content',
  'trk', 'trkCampaign', 'guccounter', 'guce_referrer', 'guce_referrer_sig',
]);

/** Hosts that exist solely to receive telemetry. Blocked outright. */
const TELEMETRY_HOSTS = [
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'connect.facebook.net', 'graph.facebook.com', 'analytics.tiktok.com',
  'sentry.io', 'bugsnag.com', 'mixpanel.com', 'segment.io', 'segment.com',
  'amplitude.com', 'fullstory.com', 'hotjar.com', 'clarity.ms', 'branch.io',
  'appsflyer.com', 'adjust.com', 'braze.com', 'onesignal.com', 'crashlytics.com',
  'clients2.google.com', 'clientservices.googleapis.com', 'update.googleapis.com',
  'ssl.gstatic.com/safebrowsing', 'safebrowsing.googleapis.com',
];

/** Never upgrade or rewrite these — they are local or non-web by nature. */
function isLocalHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.onion') ||
    hostname.endsWith('.test') ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    /^\[?[0-9a-f:]+\]?$/i.test(hostname)
  );
}

/** Sites where the HTTPS upgrade failed; we stop forcing it for the session. */
const httpsExceptions = new Set();

/** Hosts we upgraded recently, so a load failure can be attributed to us. */
const recentUpgrades = new Map();
const UPGRADE_MEMORY_MS = 30_000;

function allowInsecure(url) {
  try {
    const { hostname } = new URL(url);
    httpsExceptions.add(hostname);
    recentUpgrades.delete(hostname);
  } catch {
    /* not a parseable URL — nothing to remember */
  }
}

/** Did Umbra force this host to HTTPS in the last few seconds? */
function wasUpgraded(url) {
  try {
    const { hostname } = new URL(url);
    const at = recentUpgrades.get(hostname);
    return at != null && Date.now() - at < UPGRADE_MEMORY_MS;
  } catch {
    return false;
  }
}

function stripTrackingParams(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.search) return null;
  let touched = false;
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) || key.toLowerCase().startsWith('utm_')) {
      u.searchParams.delete(key);
      touched = true;
    }
  }
  return touched ? u.toString() : null;
}

function upgradeToHttps(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:') return null;
  if (isLocalHost(u.hostname) || httpsExceptions.has(u.hostname)) return null;
  u.protocol = 'https:';
  recentUpgrades.set(u.hostname, Date.now());
  return u.toString();
}

function isTelemetryHost(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return TELEMETRY_HOSTS.some(
      (h) =>
        (h.includes('/') && (hostname + pathname).startsWith(h)) ||
        hostname === h ||
        hostname.endsWith('.' + h)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// First-party / third-party classification
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

module.exports = {
  hardenCommandLine,
  hardenSession,
  genericUserAgent,
  allowInsecure,
  wasUpgraded,
  httpsExceptions,
  TRACKING_PARAMS,
  TELEMETRY_HOSTS,
  isLocalHost,
};
