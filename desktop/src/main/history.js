'use strict';
/**
 * Local history, used for omnibox completion and the site list in settings.
 *
 * It never leaves the machine, private windows never write to it, and turning
 * "remember history" off stops recording immediately rather than merely hiding
 * the UI. Entries are capped so the file cannot grow without bound.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const MAX_ENTRIES = 4000;
const SKIP = /^(umbra|about|data|blob|chrome|devtools):/i;

let entries = null; // Map<url, {url, title, host, visits, last}>
let writeTimer = null;

function file() {
  return path.join(app.getPath('userData'), 'history.json');
}

function load() {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    for (const e of raw) entries.set(e.url, e);
  } catch { /* first run */ }
  return entries;
}

function save() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      const list = [...load().values()].sort((a, b) => b.last - a.last).slice(0, MAX_ENTRIES);
      entries = new Map(list.map((e) => [e.url, e]));
      const tmp = file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(list), 'utf8');
      fs.renameSync(tmp, file());
    } catch (err) {
      console.error('[umbra] could not persist history:', err.message);
    }
  }, 1500);
}

function record(url, title) {
  if (!url || SKIP.test(url)) return;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const db = load();
  const existing = db.get(url);
  db.set(url, {
    url,
    host,
    title: title || existing?.title || host,
    visits: (existing?.visits || 0) + 1,
    last: Date.now(),
  });
  save();
}

/** Omnibox completion: prefer things visited often and recently. */
function suggest(query, limit = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const now = Date.now();
  const scored = [];
  for (const e of load().values()) {
    const inHost = e.host.toLowerCase().indexOf(q);
    const inUrl = e.url.toLowerCase().indexOf(q);
    const inTitle = (e.title || '').toLowerCase().indexOf(q);
    if (inHost === -1 && inUrl === -1 && inTitle === -1) continue;
    const ageDays = (now - e.last) / 86400000;
    const score =
      (inHost === 0 ? 100 : inHost > -1 ? 40 : 0) +
      (inUrl > -1 ? 10 : 0) +
      (inTitle > -1 ? 15 : 0) +
      Math.min(e.visits, 20) * 3 -
      Math.min(ageDays, 60);
    scored.push({ ...e, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function listOrigins() {
  const byHost = new Map();
  for (const e of load().values()) {
    const cur = byHost.get(e.host) || { host: e.host, visits: 0, last: 0 };
    cur.visits += e.visits;
    cur.last = Math.max(cur.last, e.last);
    byHost.set(e.host, cur);
  }
  return [...byHost.values()].sort((a, b) => b.visits - a.visits).slice(0, 200);
}

function forgetOrigin(host) {
  const db = load();
  for (const [url, e] of db) if (e.host === host) db.delete(url);
  save();
}

function clear() {
  entries = new Map();
  try {
    fs.unlinkSync(file());
  } catch { /* nothing to remove */ }
}

module.exports = { record, suggest, listOrigins, forgetOrigin, clear };
