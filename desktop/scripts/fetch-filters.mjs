/**
 * Compile the filter lists into a serialised engine that ships inside the app.
 *
 * Without this, the very first launch has to reach a CDN before it can block
 * anything — which is both a bad first impression for a privacy browser and a
 * request the user never asked for. Bundling means blocking works offline,
 * immediately, and the network refresh becomes an optional top-up rather than
 * a prerequisite.
 *
 * The actual work happens in compile-filters.mjs, in a child process. Undici
 * can throw `assert(!this.paused)` from a socket tick during these downloads —
 * an uncatchable crash from this process's point of view, and one that took a
 * Windows release build down. Isolating it in a child turns a failed build
 * into a retry, and a failed retry into a warning.
 *
 * This script always exits 0. Without a bundled engine the app still works and
 * fetches lists at runtime, and the shield says which it is using.
 *
 * Runs from desktop/package.json postinstall, and again in CI before packaging.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'compile-filters.mjs');
const OUT = join(HERE, '..', 'filters', 'engine.bin');
const ATTEMPTS = 3;

console.log('umbra filters — compiling 7 lists');

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const result = spawnSync(process.execPath, [WORKER], {
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  });

  if (result.status === 0 && existsSync(OUT)) {
    console.log('done');
    process.exit(0);
  }

  const why = result.error ? result.error.message : `exit ${result.status ?? 'signal'}`;
  console.warn(`  attempt ${attempt}/${ATTEMPTS} failed (${why})`);
}

console.warn('  could not build the bundled engine — the app will fetch at runtime');
process.exit(0);
