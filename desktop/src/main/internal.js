'use strict';
/**
 * The umbra:// scheme, which serves the browser's own UI and internal pages.
 *
 *   umbra://chrome/…    the browser chrome (tab strip, toolbar, popovers)
 *   umbra://assets/…    images the chrome and internal pages share
 *   umbra://<page>      an internal page, e.g. umbra://settings
 *
 * Protocol handlers are per-session, not per-application, so this has to be
 * registered on every partition tabs can live in — not just the default one.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { net } = require('electron');

const PAGES = path.join(__dirname, '..', 'pages');
const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(RENDERER, 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Resolve `child` under `root`, refusing anything that escapes it. */
function safeJoin(root, child) {
  const target = path.resolve(root, '.' + path.posix.normalize('/' + (child || '')));
  return target.startsWith(path.resolve(root)) ? target : null;
}

function notFound() {
  return new Response('<h1>Page not found</h1>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function serveInternal(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const host = (url.hostname || 'newtab').toLowerCase();
  const hasPath = url.pathname && url.pathname !== '/';

  const file =
    host === 'assets'
      ? safeJoin(ASSETS, url.pathname)
      : host === 'chrome'
        ? safeJoin(RENDERER, hasPath ? url.pathname : '/index.html')
        : hasPath
          ? safeJoin(PAGES, url.pathname)
          : safeJoin(PAGES, `/${host}.html`);

  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound();

  const response = await net.fetch(pathToFileURL(file).toString(), {
    bypassCustomProtocolHandlers: true,
  });

  return new Response(response.body, {
    status: 200,
    headers: {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    },
  });
}

/** Idempotent: sessions are prepared once but this is cheap to guard anyway. */
function serveOn(ses) {
  if (ses.protocol.isProtocolHandled('umbra')) return;
  ses.protocol.handle('umbra', serveInternal);
}

module.exports = { serveOn, serveInternal, PAGES, RENDERER, ASSETS };
