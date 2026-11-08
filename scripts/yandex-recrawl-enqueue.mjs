#!/usr/bin/env node
/**
 * GEO 09.11: new permanent pages go to the head of the Yandex recrawl queue.
 *
 * Reads the deployed `static-1.xml` (the page registry as prod serves it) and
 * puts every address that is in neither the queue nor the done list at the top
 * of `~/.openqareer/seo/recrawl-queue.txt`. The daily task `openqareer-seo-daily`
 * runs this first, then sends its 10 URLs through the Webmaster UI. IndexNow
 * needs no script: the maintenance process pings changed sitemap URLs itself.
 *
 * Usage: node scripts/yandex-recrawl-enqueue.mjs [--dir ~/.openqareer/seo] [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SITEMAP = 'https://openqareer.com/sitemaps/static-1.xml';

export function sitemapLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) =>
    match[1].replace(/&amp;/gu, '&').trim(),
  );
}

function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Done lines are «YYYY-MM-DD URL»; the URL is the field that starts with http. */
function urlOf(line) {
  return line.split(/\s+/u).find((field) => field.startsWith('http')) ?? line;
}

export function enqueue(locs, queue, done) {
  const known = new Set([...queue, ...done].map(urlOf));
  const fresh = locs.filter((url) => !known.has(url));
  return { fresh, queue: [...fresh, ...queue] };
}

async function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : join(homedir(), '.openqareer', 'seo');
  const response = await fetch(SITEMAP, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`sitemap ${response.status}`);
  const locs = sitemapLocs(await response.text());
  if (locs.length === 0) throw new Error('sitemap has no <loc>');
  const queuePath = join(dir, 'recrawl-queue.txt');
  const result = enqueue(locs, readLines(queuePath), readLines(join(dir, 'recrawl-done.txt')));
  if (!args.includes('--dry-run') && result.fresh.length > 0) {
    writeFileSync(queuePath, `${result.queue.join('\n')}\n`);
  }
  process.stdout.write(
    `${JSON.stringify({ sitemapUrls: locs.length, added: result.fresh.length, fresh: result.fresh })}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`yandex-recrawl-enqueue failed: ${error.message}\n`);
    process.exit(1);
  });
}
