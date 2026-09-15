#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { LinkedinAccountPool } from '../../server/crawler/linkedinAccountPool';
import { LinkedinScraper } from '../../server/crawler/linkedinScraper';

const DEFAULT_POOL_ROOT = path.resolve(process.cwd(), 'data/crawlers/linkedin');

function printStatus(pool: LinkedinAccountPool): void {
  const summary = pool.getPoolSummary();
  console.log('--- LinkedIn Crawler Pool Status (B208 / Obscura) ---');
  console.log(`Storage root: ${DEFAULT_POOL_ROOT}`);
  console.log(`Total accounts: ${summary.total}`);
  console.log(`Active: ${summary.active}`);
  console.log(`Cooling down: ${summary.coolingDown}`);
  console.log(`Checkpoint required: ${summary.checkpointRequired}`);
  console.log(`Banned: ${summary.banned}`);
  console.log('----------------------------------------------------');
}

function initDirectories(accountIds: string[]): void {
  for (const id of accountIds) {
    const dir = path.join(DEFAULT_POOL_ROOT, id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Initialized account profile directory: ${dir}`);
    }
  }
  console.log('LinkedIn test account pool directories initialized.');
}

function getCliArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

async function runScrapePosts(pool: LinkedinAccountPool): Promise<void> {
  const keywords = getCliArg('--keywords') ?? '#hiring';
  const proxyUrl = getCliArg('--proxy');
  const scraper = new LinkedinScraper({ pool, proxyUrl });

  console.log(`[scrape-posts] Scraping with keywords: "${keywords}" (proxy: ${proxyUrl ?? 'none'})...`);
  const result = await scraper.scrapePosts({ keywords });
  console.log(`[scrape-posts] Status: ${result.status}, account: ${result.accountId ?? 'none'}, found: ${result.vacancies.length}`);

  for (const v of result.vacancies) {
    console.log(`- [${v.company}] ${v.title} | ${v.location ?? 'Unknown'} | ${v.url}`);
    if (v.contactInfo) console.log(`  Contacts: ${v.contactInfo}`);
  }
}

async function runScrapeJobs(pool: LinkedinAccountPool): Promise<void> {
  const keywords = getCliArg('--keywords') ?? 'Software Engineer';
  const location = getCliArg('--location') ?? 'Remote';
  const proxyUrl = getCliArg('--proxy');
  const scraper = new LinkedinScraper({ pool, proxyUrl });

  console.log(`[scrape-jobs] Scraping: "${keywords}" in "${location}" (proxy: ${proxyUrl ?? 'none'})...`);
  const result = await scraper.scrapeJobs({ keywords, location });
  console.log(`[scrape-jobs] Status: ${result.status}, account: ${result.accountId ?? 'none'}, found: ${result.vacancies.length}`);

  for (const v of result.vacancies) {
    console.log(`- [${v.company}] ${v.title} | ${v.location ?? 'Unknown'} | ${v.url}`);
  }
}

async function main() {
  const command = process.argv[2] ?? 'status';

  if (!fs.existsSync(DEFAULT_POOL_ROOT)) {
    fs.mkdirSync(DEFAULT_POOL_ROOT, { recursive: true });
  }

  const existingEntries = fs
    .readdirSync(DEFAULT_POOL_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('account-'))
    .map((entry) => entry.name);

  const accountIds =
    existingEntries.length > 0
      ? existingEntries
      : ['account-1', 'account-2', 'account-3', 'account-4', 'account-5'];

  const pool = new LinkedinAccountPool({
    accountIds,
    storageRoot: DEFAULT_POOL_ROOT,
  });

  switch (command) {
    case 'status':
      printStatus(pool);
      break;
    case 'init':
      initDirectories(accountIds);
      break;
    case 'scrape-posts':
      await runScrapePosts(pool);
      break;
    case 'scrape-jobs':
      await runScrapeJobs(pool);
      break;
    default:
      console.log(`Unknown command: ${command}. Available: status, init, scrape-posts, scrape-jobs`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('[manage-pool] Error:', err);
  process.exit(1);
});
