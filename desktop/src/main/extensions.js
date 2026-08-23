'use strict';
/**
 * Chrome extension support.
 *
 * Electron can load unpacked extensions into a session, and that is genuinely
 * useful — content scripts, background service workers, chrome.storage and
 * chrome.tabs all work. It is not, however, Chrome: `chrome.webRequest`
 * blocking and `declarativeNetRequest` are not wired up, so a content blocker
 * loaded here will not block anything. Umbra does that itself. The
 * umbra://extensions page spells all of this out, so people find out before
 * installing rather than one broken extension at a time.
 *
 * Packed .crx files are not accepted. Electron cannot load them, and unpacking
 * an archive from the internet inside the main process is a bad trade for the
 * convenience. Point Umbra at an unpacked directory instead.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');
const { readJsonSync, writeJsonSync } = require('./store');
const { log } = require('./log');

/** Extensions the user has added: [{ path, enabled }]. */
let registry = null;
/** Loaded extension objects per session partition. */
const loaded = new Map();

function storePath() {
  return path.join(app.getPath('userData'), 'extensions.json');
}

function load() {
  if (registry) return registry;
  const raw = readJsonSync(storePath(), []);
  registry = Array.isArray(raw) ? raw.filter((e) => typeof e?.path === 'string') : [];
  return registry;
}

function save() {
  writeJsonSync(storePath(), load());
}

/** Read and sanity-check a manifest without trusting anything in it. */
function readManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error('no manifest.json in that folder');

  const manifest = readJsonSync(file, null);
  if (!manifest) throw new Error('manifest.json is missing or not valid JSON');
  if (!manifest.name) throw new Error('manifest.json has no name');
  if (manifest.manifest_version !== 2 && manifest.manifest_version !== 3) {
    throw new Error(`unsupported manifest_version ${manifest.manifest_version}`);
  }
  return manifest;
}

/** The action popup and icon, normalised across manifest v2 and v3. */
function actionOf(manifest) {
  const action = manifest.action || manifest.browser_action || manifest.page_action;
  if (!action) return null;
  const icons = action.default_icon || manifest.icons || {};
  const best = typeof icons === 'string'
    ? icons
    : Object.entries(icons).sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1];
  return {
    popup: action.default_popup || null,
    title: action.default_title || manifest.name,
    icon: best || null,
  };
}

function describe(entry, extension) {
  let manifest = null;
  let error = null;
  try {
    manifest = readManifest(entry.path);
  } catch (err) {
    error = err.message;
  }
  return {
    path: entry.path,
    enabled: entry.enabled !== false,
    id: extension?.id ?? null,
    name: manifest?.name ?? path.basename(entry.path),
    version: manifest?.version ?? null,
    description: manifest?.description ?? null,
    manifestVersion: manifest?.manifest_version ?? null,
    action: manifest ? actionOf(manifest) : null,
    error,
  };
}

/**
 * Load every enabled extension into a session. Called once per partition, as
 * sessions are prepared.
 */
async function loadInto(ses, partition) {
  const active = [];
  for (const entry of load()) {
    if (entry.enabled === false) continue;
    try {
      readManifest(entry.path);
      const extension = await ses.loadExtension(entry.path, { allowFileAccess: false });
      active.push({ entry, extension });
    } catch (err) {
      log.error(`[umbra] extension ${entry.path} failed to load: ${err.message}`);
    }
  }
  loaded.set(partition, { ses, active });
  return active;
}

/** Ask for a folder and add it. Returns { ok } or { error }. */
async function addFromDialog(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    title: 'Add an unpacked extension',
    message: 'Choose the folder containing the extension’s manifest.json',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };
  return add(result.filePaths[0]);
}

function add(dir) {
  try {
    readManifest(dir);
  } catch (err) {
    return { error: err.message };
  }

  const list = load();
  if (list.some((e) => path.resolve(e.path) === path.resolve(dir))) {
    return { error: 'that extension is already added' };
  }

  list.push({ path: dir, enabled: true });
  save();
  return { ok: true, restartRequired: true };
}

function remove(dir) {
  registry = load().filter((e) => path.resolve(e.path) !== path.resolve(dir));
  save();

  // Unload it live where we can; a stale content script would otherwise keep
  // running until the browser restarts.
  for (const { ses, active } of loaded.values()) {
    const match = active.find((a) => path.resolve(a.entry.path) === path.resolve(dir));
    if (match?.extension?.id) {
      try {
        ses.removeExtension(match.extension.id);
      } catch { /* already gone */ }
    }
  }
  return { ok: true };
}

function setEnabled(dir, enabled) {
  const entry = load().find((e) => path.resolve(e.path) === path.resolve(dir));
  if (!entry) return { error: 'not found' };
  entry.enabled = !!enabled;
  save();
  return { ok: true, restartRequired: true };
}

/** What the settings page and the toolbar render from. */
function list() {
  const anySession = [...loaded.values()][0];
  return load().map((entry) => {
    const match = anySession?.active.find(
      (a) => path.resolve(a.entry.path) === path.resolve(entry.path)
    );
    return describe(entry, match?.extension);
  });
}

/** Resolve an extension's popup to a loadable chrome-extension:// URL. */
function popupUrl(extensionPath) {
  const anySession = [...loaded.values()][0];
  const match = anySession?.active.find(
    (a) => path.resolve(a.entry.path) === path.resolve(extensionPath)
  );
  if (!match) return null;

  const action = actionOf(readManifest(extensionPath));
  if (!action?.popup) return null;
  return `chrome-extension://${match.extension.id}/${action.popup.replace(/^\//, '')}`;
}

/** Icon as a data URL, read off disk — extensions are local, so this is cheap. */
function iconDataUrl(extensionPath) {
  try {
    const action = actionOf(readManifest(extensionPath));
    if (!action?.icon) return null;
    const file = path.join(extensionPath, action.icon.replace(/^\//, ''));
    const root = path.resolve(extensionPath);
    const resolved = path.resolve(file);
    const rel = path.relative(root, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const type = path.extname(file).toLowerCase() === '.svg' ? 'image/svg+xml' : 'image/png';
    return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { loadInto, add, addFromDialog, remove, setEnabled, list, popupUrl, iconDataUrl };
