'use strict';
/**
 * Umbra — a private, Chromium-based browser.
 * Copyright (c) 2026 stillemptyNOW. MIT licensed.
 *
 * Start-up order matters here: command-line hardening has to happen before the
 * app is ready, and DNS has to be configured before anything makes a request.
 */
const { app, protocol, session, dialog } = require('electron');

const { log, installStdioGuards } = require('./log');
const { hardenCommandLine, genericUserAgent } = require('./privacy');
const { settings } = require('./settings');
const { initBlocker } = require('./adblock');
const { serveOn } = require('./internal');
const windows = require('./window');
const ipc = require('./ipc');
const { buildMenu } = require('./menu');

// --- before ready -----------------------------------------------------------

installStdioGuards();
hardenCommandLine(app);

// umbra:// behaves like a real web origin so internal pages get a secure
// context, fetch and modules, but it is not allowed to be a CSP bypass.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'umbra',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// Second launches hand their URLs to the running instance instead of starting
// a second profile on the same directory.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const target = windows.focusedWindow();
    if (!target) return;
    if (!target.win.isDestroyed()) {
      if (target.win.isMinimized()) target.win.restore();
      target.win.focus();
    }
    for (const url of urlsFromArgv(argv)) target.tabs.create({ url });
  });

  main();
}

// --- lifecycle --------------------------------------------------------------

function urlsFromArgv(argv) {
  return argv
    .slice(1)
    .filter((a) => /^(https?|umbra):\/\//i.test(a));
}

async function main() {
  await app.whenReady();

  // Encrypted DNS, before the first lookup. 'secure' means no plaintext
  // fallback: a resolver that cannot answer over HTTPS gets no query at all.
  try {
    app.configureHostResolver({
      secureDnsMode: settings.get('secureDns') ? 'secure' : 'automatic',
      secureDnsServers: settings.dnsServers(),
      enableBuiltInResolver: true,
    });
  } catch (err) {
    log.error('[umbra] DNS configuration failed:', err.message);
  }

  app.userAgentFallback = genericUserAgent();

  // The chrome UI runs in the default session; tabs run in their own
  // partitions, which prepareSession() covers.
  serveOn(session.defaultSession);

  // Certificate problems are fatal. No click-through, ever.
  app.on('certificate-error', (event, _wc, url, error) => {
    event.preventDefault();
    log.warn('[umbra] rejected certificate for', url, error);
  });

  // Nothing may attach a debugger or spawn a renderer we did not configure.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  await initBlocker(settings);

  // Extensions load before the first window so their content scripts are in
  // place for the first page, not the second.
  await windows.prepareDefaultSession();

  ipc.register(windows);
  buildMenu(windows);

  const startUrls = urlsFromArgv(process.argv);
  windows.createWindow({ urls: startUrls });

  app.on('activate', () => {
    if (windows.allWindows().length === 0) windows.createWindow({});
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  settings.saveNow();
  if (!settings.get('clearOnExit')) return;

  event.preventDefault();
  try {
    const ses = session.fromPartition('persist:umbra');
    await ses.clearStorageData();
    await ses.clearCache();
    require('./history').clear();
  } catch (err) {
    dialog.showErrorBox('Umbra', `Could not clear browsing data on exit: ${err.message}`);
  }
  app.exit(0);
});
