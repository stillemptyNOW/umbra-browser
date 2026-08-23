'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitiseSetting } = require('../src/main/settings');

test('unknown keys are rejected', () => {
  assert.equal(sanitiseSetting('notARealSetting', true), undefined);
  assert.equal(sanitiseSetting('__proto__', { polluted: true }), undefined);
});

test('booleans coerce, enums do not', () => {
  assert.equal(sanitiseSetting('blockAds', 1), true);
  assert.equal(sanitiseSetting('blockAds', 0), false);
  assert.equal(sanitiseSetting('fingerprintDefense', 'strict'), 'strict');
  assert.equal(sanitiseSetting('fingerprintDefense', 'maximum'), undefined);
  assert.equal(sanitiseSetting('webrtcPolicy', 'disable-udp'), 'disable-udp');
  assert.equal(sanitiseSetting('webrtcPolicy', 'off'), undefined);
});

test('homepage cannot be a script or file URL', () => {
  assert.equal(sanitiseSetting('homepage', 'https://example.com'), 'https://example.com');
  assert.equal(sanitiseSetting('homepage', 'umbra://newtab'), 'umbra://newtab');
  assert.equal(sanitiseSetting('homepage', 'javascript:alert(1)'), undefined);
  assert.equal(sanitiseSetting('homepage', 'data:text/html,x'), undefined);
  assert.equal(sanitiseSetting('homepage', 'file:///etc/passwd'), undefined);
  assert.equal(sanitiseSetting('homepage', 'http://example.com'), undefined);
  assert.equal(sanitiseSetting('homepage', 'http://localhost:3000'), 'http://localhost:3000');
});

test('custom search must be https and include a query placeholder', () => {
  assert.equal(sanitiseSetting('customSearchUrl', ''), '');
  assert.equal(sanitiseSetting('customSearchUrl', 'https://s.example/?q=%s'), 'https://s.example/?q=%s');
  assert.equal(sanitiseSetting('customSearchUrl', 'http://s.example/?q=%s'), undefined);
  assert.equal(sanitiseSetting('customSearchUrl', 'https://s.example/'), undefined);
});

test('session tabs drop error pages and non-web URLs', () => {
  assert.deepEqual(
    sanitiseSetting('sessionTabs', [
      'https://example.com',
      'umbra://settings',
      'umbra://error/?url=x',
      'javascript:alert(1)',
      'file:///tmp/x',
      { url: 'https://kept.example' },
    ]),
    ['https://example.com', 'umbra://settings', 'https://kept.example']
  );
});
