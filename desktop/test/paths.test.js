'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { safeJoin } = require('../src/main/paths');

const ROOT = path.resolve('/srv/umbra/pages');

test('ordinary paths resolve inside the root', () => {
  assert.equal(safeJoin(ROOT, '/newtab.html'), path.join(ROOT, 'newtab.html'));
  assert.equal(safeJoin(ROOT, 'newtab.html'), path.join(ROOT, 'newtab.html'));
  assert.equal(safeJoin(ROOT, '/sub/dir/page.css'), path.join(ROOT, 'sub', 'dir', 'page.css'));
});

test('an empty or root path resolves to the root itself', () => {
  assert.equal(safeJoin(ROOT, ''), ROOT);
  assert.equal(safeJoin(ROOT, '/'), ROOT);
  assert.equal(safeJoin(ROOT, undefined), ROOT);
});

test('traversal out of the root is refused', () => {
  // umbra:// is reachable from page content, so this is the boundary that
  // stops a crafted internal URL reading arbitrary files off the disk.
  for (const attempt of [
    '/../secrets.txt',
    '/../../../../etc/passwd',
    '/sub/../../escape',
    '/./../../escape',
    '/sub/..\\..\\escape',
  ]) {
    assert.equal(safeJoin(ROOT, attempt), null, attempt);
  }
});

test('names that only resemble traversal are ordinary names', () => {
  // "....//" defeats filters that strip "../" by substitution. Umbra does not
  // substitute, so this is simply a directory with a silly name, inside root.
  assert.equal(
    safeJoin(ROOT, '/....//....//escape'),
    path.join(ROOT, '....', '....', 'escape')
  );
});

test('every result is either null or genuinely inside the root', () => {
  // The property that matters, rather than a guess at which specific input
  // escapes: whatever comes back can be opened without further checking.
  const hostile = [
    '/../pages-evil/x',
    '//../pages-evil/x',
    '/..%2f..%2fetc/passwd',
    '/sub/../../../root',
    '/\u0000/etc/passwd',
    '/a/./b/../../../..',
    'C:\\Windows\\System32',
    '/C:/Windows/System32',
  ];
  for (const attempt of hostile) {
    const result = safeJoin(ROOT, attempt);
    if (result === null) continue;
    assert.ok(
      result === ROOT || result.startsWith(ROOT + path.sep),
      `${attempt} escaped to ${result}`
    );
  }
});

test('even traversal that would have stayed inside is refused', () => {
  // No legitimate umbra:// URL contains "..", so rejecting is clearer than
  // quietly resolving to something the caller did not ask for.
  assert.equal(safeJoin(ROOT, '/sub/../newtab.html'), null);
});
