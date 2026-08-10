'use strict';
/**
 * Path containment, kept free of Electron imports so it can be tested with
 * plain Node. See desktop/test/paths.test.js.
 */
const path = require('node:path');

/**
 * Resolve `child` under `root`, returning null for anything that tries to
 * leave — or that merely looks like it is trying.
 *
 * Two layers, deliberately:
 *
 *  1. Any `..` segment in the request is rejected outright. Normalising it
 *     away instead would be safe but dishonest: a request for
 *     `/../secrets.txt` would quietly be served `<root>/secrets.txt`, which
 *     is a confusing thing to debug and a bad thing to log.
 *  2. The resolved path is then still checked against the root, so a bug in
 *     the first layer cannot become a file disclosure. The separator in the
 *     prefix check matters — without it, `<root>-evil` passes as `<root>`.
 */
function safeJoin(root, child) {
  const request = String(child || '');
  if (request.split(/[\\/]+/).includes('..')) return null;

  const base = path.resolve(root);
  // URL pathnames are POSIX-shaped even on Windows.
  const target = path.resolve(base, '.' + path.posix.normalize('/' + request));

  return target === base || target.startsWith(base + path.sep) ? target : null;
}

module.exports = { safeJoin };
