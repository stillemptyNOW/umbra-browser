/**
 * Compile the filter lists into a serialised engine that ships inside the app.
 *
 * Without this, the very first launch has to reach a CDN before it can block
 * anything — which is both a bad first impression for a privacy browser and a
 * request the user never asked for. Bundling means blocking works offline,
 * immediately, and the network refresh becomes an optional top-up rather than
 * a prerequisite.
 *
 * Runs from desktop/package.json postinstall, and again in CI before packaging.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FiltersEngine } from '@ghostery/adblocker';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'filters', 'engine.bin');

const LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
];

console.log(`umbra filters — compiling ${LISTS.length} lists`);

let engine;
try {
  engine = await FiltersEngine.fromLists(fetch, LISTS);
} catch (error) {
  // A build machine without network still has to produce a working app; the
  // runtime falls back to fetching lists itself and says so in the shield.
  console.warn(`  could not fetch lists: ${error.message}`);
  console.warn('  skipping the bundled engine — the app will fetch at runtime');
  process.exit(0);
}

const serialised = engine.serialize();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, serialised);

const kb = (serialised.byteLength / 1024).toFixed(0);
console.log(`  filters/engine.bin (${kb} KB)`);
console.log('done');
