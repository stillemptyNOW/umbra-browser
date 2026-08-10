'use strict';
/**
 * URL rewriting: tracking-parameter stripping, HTTPS upgrading, and the
 * telemetry host list.
 *
 * Deliberately free of Electron imports so it can be tested with plain Node —
 * this is the part of the privacy pipeline where a quiet mistake is invisible
 * in use and expensive in consequence. See desktop/test/rewrite.test.js.
 */

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
function wasUpgraded(url, now = Date.now()) {
  try {
    const at = recentUpgrades.get(new URL(url).hostname);
    return at != null && now - at < UPGRADE_MEMORY_MS;
  } catch {
    return false;
  }
}

/** Returns the cleaned URL, or null when there was nothing to strip. */
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

/** Returns the https:// form, or null when the URL should be left alone. */
function upgradeToHttps(url, now = Date.now()) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:') return null;
  if (isLocalHost(u.hostname) || httpsExceptions.has(u.hostname)) return null;

  u.protocol = 'https:';
  recentUpgrades.set(u.hostname, now);
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

/** Test seam: forget every HTTPS decision made so far. */
function resetHttpsState() {
  httpsExceptions.clear();
  recentUpgrades.clear();
}

module.exports = {
  TRACKING_PARAMS,
  TELEMETRY_HOSTS,
  isLocalHost,
  isTelemetryHost,
  stripTrackingParams,
  upgradeToHttps,
  allowInsecure,
  wasUpgraded,
  httpsExceptions,
  resetHttpsState,
};
