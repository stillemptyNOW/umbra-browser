'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripTrackingParams,
  upgradeToHttps,
  isTelemetryHost,
  isLocalHost,
  allowInsecure,
  wasUpgraded,
  resetHttpsState,
} = require('../src/main/rewrite');

test.beforeEach(() => resetHttpsState());

test('tracking parameters are removed and everything else survives', () => {
  assert.equal(
    stripTrackingParams('https://example.com/a?utm_source=x&id=7&fbclid=abc'),
    'https://example.com/a?id=7'
  );
});

test('any utm_ parameter goes, including ones not on the list', () => {
  assert.equal(
    stripTrackingParams('https://example.com/?utm_never_seen_before=1&keep=2'),
    'https://example.com/?keep=2'
  );
});

test('a URL with nothing to strip is left exactly alone', () => {
  // Returning null rather than an equal string is what stops the request
  // pipeline issuing a pointless redirect on every single navigation.
  assert.equal(stripTrackingParams('https://example.com/a?id=7'), null);
  assert.equal(stripTrackingParams('https://example.com/a'), null);
});

test('stripping does not mangle the rest of the URL', () => {
  assert.equal(
    stripTrackingParams('https://example.com:8443/p/q?gclid=1&a=b%20c#frag'),
    'https://example.com:8443/p/q?a=b+c#frag'
  );
});

test('an unparseable URL is passed through untouched', () => {
  assert.equal(stripTrackingParams('not a url at all'), null);
  assert.equal(upgradeToHttps('not a url at all'), null);
});

test('http is upgraded, https is already fine', () => {
  assert.equal(upgradeToHttps('http://example.com/a'), 'https://example.com/a');
  assert.equal(upgradeToHttps('https://example.com/a'), null);
});

test('local and non-web hosts are never upgraded', () => {
  for (const host of [
    'localhost', '127.0.0.1', 'dev.local', 'x.test',
    '192.168.1.10', 'abcdefghijklmnop.onion',
  ]) {
    assert.equal(upgradeToHttps(`http://${host}/`), null, host);
    assert.ok(isLocalHost(host), host);
  }
});

test('a host is only exempted after its upgrade actually failed', () => {
  assert.equal(upgradeToHttps('http://legacy.example/'), 'https://legacy.example/');
  allowInsecure('https://legacy.example/');
  assert.equal(upgradeToHttps('http://legacy.example/'), null);
  // The exemption is per host, not global.
  assert.equal(upgradeToHttps('http://other.example/'), 'https://other.example/');
});

test('an upgrade is only attributed to us for a short window', () => {
  const now = 1_000_000;
  upgradeToHttps('http://slow.example/', now);
  assert.equal(wasUpgraded('https://slow.example/', now + 1000), true);
  assert.equal(wasUpgraded('https://slow.example/', now + 60_000), false);
  // A host we never touched is never blamed on us.
  assert.equal(wasUpgraded('https://untouched.example/', now), false);
});

test('telemetry hosts match on subdomains but not on lookalikes', () => {
  assert.equal(isTelemetryHost('https://www.google-analytics.com/collect'), true);
  assert.equal(isTelemetryHost('https://google-analytics.com/'), true);
  assert.equal(isTelemetryHost('https://notgoogle-analytics.com/'), false);
  assert.equal(isTelemetryHost('https://google-analytics.com.evil.test/'), false);
  assert.equal(isTelemetryHost('https://example.com/'), false);
});
