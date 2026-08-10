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

const { safeJoin } = require('./paths');

/**
 * Sent on every umbra:// response, not just relied on from a <meta> tag in
 * each page. A page that forgets its meta tag is then still covered, and the
 * header applies to responses that are not HTML at all.
 *
 * 'unsafe-inline' for styles only: the pages carry <style> blocks. Scripts are
 * 'self', which is why every internal page keeps its logic in its own file.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src umbra: data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

function headers(contentType) {
  return {
    'content-type': contentType,
    'content-security-policy': CSP,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
}

function notFound() {
  return new Response('<h1>Page not found</h1>', {
    status: 404,
    headers: headers('text/html; charset=utf-8'),
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
    headers: headers(MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'),
  });
}

/** Idempotent: sessions are prepared once but this is cheap to guard anyway. */
function serveOn(ses) {
  if (ses.protocol.isProtocolHandled('umbra')) return;
  ses.protocol.handle('umbra', serveInternal);
}

module.exports = { serveOn, serveInternal, PAGES, RENDERER, ASSETS };
