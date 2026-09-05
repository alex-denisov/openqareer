#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { LinkedinAccountPool } from '../../server/crawler/linkedinAccountPool';

const DEFAULT_POOL_ROOT = path.resolve(process.cwd(), 'data/crawlers/linkedin');

function main() {
  const command = process.argv[2] ?? 'status';

  // Ensure data directory exists
  if (!fs.existsSync(DEFAULT_POOL_ROOT)) {
    fs.mkdirSync(DEFAULT_POOL_ROOT, { recursive: true });
  }

  // Detect available account directories or use default accounts 1..5
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

  if (command === 'status') {
    const summary = pool.getPoolSummary();
    console.log('--- LinkedIn Crawler Pool Status (B208 / Obscura) ---');
    console.log(`Storage root: ${DEFAULT_POOL_ROOT}`);
    console.log(`Total accounts: ${summary.total}`);
    console.log(`Active: ${summary.active}`);
    console.log(`Cooling down: ${summary.coolingDown}`);
    console.log(`Checkpoint required: ${summary.checkpointRequired}`);
    console.log(`Banned: ${summary.banned}`);
    console.log('----------------------------------------------------');
  } else if (command === 'init') {
    for (const id of accountIds) {
      const dir = path.join(DEFAULT_POOL_ROOT, id);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Initialized account profile directory: ${dir}`);
      }
    }
    console.log('LinkedIn test account pool directories initialized.');
  } else {
    console.log(`Unknown command: ${command}. Available: status, init`);
    process.exit(1);
  }
}

main();
