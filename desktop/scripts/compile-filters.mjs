/**
 * Fetch the filter lists and write the serialised engine. Does the work; makes
 * no attempt to survive failure — that is fetch-filters.mjs's job, which runs
 * this in a child process precisely so a crash here cannot take a build down.
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

const engine = await FiltersEngine.fromLists(fetch, LISTS);
const serialised = engine.serialize();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, serialised);

console.log(`  filters/engine.bin (${(serialised.byteLength / 1024).toFixed(0)} KB)`);
