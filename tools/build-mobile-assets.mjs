/**
 * Fans the shared mobile assets out to the two platform builds.
 *
 *   shared/blocklist.txt  ->  android assets (verbatim)
 *                         ->  ios/Resources/blocklist.json (WKContentRuleList)
 *   shared/farble.js      ->  both, verbatim
 *
 * Keeping one source and generating the platform forms means the two mobile
 * builds cannot quietly drift apart in what they block.
 *
 * Run with `npm run mobile-assets` from the repository root.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'shared');
const ANDROID_ASSETS = join(ROOT, 'android', 'app', 'src', 'main', 'assets');
const IOS_RESOURCES = join(ROOT, 'ios', 'Resources');

const write = async (path, contents) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  console.log('  ' + path.slice(ROOT.length + 1).replace(/\\/g, '/'));
};

/** Parse the shared list into { domain, path } entries, dropping comments. */
function parseBlocklist(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const slash = line.indexOf('/');
    entries.push(
      slash === -1
        ? { domain: line.toLowerCase(), path: null }
        : { domain: line.slice(0, slash).toLowerCase(), path: line.slice(slash) }
    );
  }
  return entries;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * WebKit content rules. `url-filter` is a regex over the resource URL, so each
 * entry becomes one rule; the list is far below WebKit's 50,000 rule ceiling.
 */
function toContentRuleList(entries) {
  const rules = entries.map(({ domain, path }) => ({
    trigger: {
      'url-filter': `^https?://([^/]+\\.)?${escapeRegex(domain)}${path ? escapeRegex(path) : '[:/]'}`,
      'load-type': ['third-party'],
    },
    action: { type: 'block' },
  }));

  // Cross-site cookies are refused outright, on top of the domain rules.
  rules.push({
    trigger: { 'url-filter': '.*', 'load-type': ['third-party'] },
    action: { type: 'block-cookies' },
  });

  return rules;
}

const blocklistText = await readFile(join(SHARED, 'blocklist.txt'), 'utf8');
const farble = await readFile(join(SHARED, 'farble.js'));
const entries = parseBlocklist(blocklistText);

console.log(`umbra mobile assets — ${entries.length} blocklist entries`);

await write(join(ANDROID_ASSETS, 'blocklist.txt'), blocklistText);
await write(join(ANDROID_ASSETS, 'farble.js'), farble);

await write(join(IOS_RESOURCES, 'blocklist.json'), JSON.stringify(toContentRuleList(entries)));
await write(join(IOS_RESOURCES, 'farble.js'), farble);

console.log('done');
