'use strict';
/**
 * Reading and writing the small JSON files that make up a profile.
 *
 * Two things every caller needs and kept getting written out again:
 *
 *  - A byte order mark defeats JSON.parse. Files Umbra writes never have one,
 *    but settings.json and extensions.json are exactly the sort of thing a
 *    person edits by hand, and most Windows editors add one without asking.
 *    A silently ignored config file is a horrible failure mode.
 *  - Writes go to a temporary file and are renamed into place, so an interrupted
 *    write leaves the previous contents rather than a truncated file.
 */
const fs = require('node:fs');
const path = require('node:path');
const { log } = require('./log');

function readJsonSync(file, fallback = null) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.error(`[umbra] ignoring unreadable ${path.basename(file)}: ${err.message}`);
    }
    return fallback;
  }
}

function writeJsonSync(file, value, { pretty = true } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 2 : 0), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    log.error(`[umbra] could not write ${path.basename(file)}: ${err.message}`);
    return false;
  }
}

module.exports = { readJsonSync, writeJsonSync };
