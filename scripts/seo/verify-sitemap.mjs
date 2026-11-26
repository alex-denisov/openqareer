#!/usr/bin/env node
/**
 * Walks every URL of every sitemap under BASE and checks the rules in
 * sitemapRules.mjs. Usage: node scripts/seo/verify-sitemap.mjs [base] [--concurrency=8]
 * Exit 0 only with zero violations; the report lists one line per violation.
 */
import { writeFileSync } from 'node:fs';
import { checkUrl, extractLocs, isSitemapIndex, parseRobotsDisallow } from './sitemapRules.mjs';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://openqareer.com').replace(/\/$/, '');
const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? 8);
const reportPath = args.find((a) => a.startsWith('--report='))?.split('=')[1];
const UA = 'Mozilla/5.0 (compatible; openqareer-sitemap-verify/1.0)';

async function get(url, attempt = 0) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } });
    const body = await res.text();
    if (res.status >= 500 && attempt < 2) return get(url, attempt + 1);
    return { status: res.status, location: res.headers.get('location'), headers: Object.fromEntries(res.headers), html: body };
  } catch (error) {
    if (attempt < 2) return get(url, attempt + 1);
    return { status: 0, location: String(error?.cause?.code ?? error), headers: {}, html: '' };
  }
}

async function collect(sitemapUrl, sections) {
  const res = await get(sitemapUrl);
  if (res.status !== 200) throw new Error(`${sitemapUrl}: status ${res.status}`);
  if (isSitemapIndex(res.html)) {
    for (const child of extractLocs(res.html)) await collect(child, sections);
  } else {
    sections.set(sitemapUrl, extractLocs(res.html));
  }
}

const robots = await get(`${base}/robots.txt`);
const disallow = parseRobotsDisallow(robots.html);
const sections = new Map();
await collect(`${base}/sitemap.xml`, sections);
const urls = [...sections.values()].flat();
for (const [name, list] of sections) console.log(`${name}: ${list.length}`);

const dupes = urls.length - new Set(urls).size;
const violations = [];
if (dupes) violations.push(`(sitemap)\t${dupes} duplicate URLs`);
let next = 0;
let done = 0;
async function worker() {
  while (next < urls.length) {
    const url = urls[next++];
    for (const problem of checkUrl({ url, ...(await get(url)) }, disallow)) violations.push(`${url}\t${problem}`);
    if (++done % 2000 === 0) console.error(`${done}/${urls.length}, violations ${violations.length}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

if (reportPath) writeFileSync(reportPath, violations.join('\n') + '\n');
for (const line of violations.slice(0, 50)) console.log(line);
console.log(`\n${urls.length} URLs, ${violations.length} violations`);
process.exit(violations.length ? 1 : 0);
