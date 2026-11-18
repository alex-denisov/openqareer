#!/usr/bin/env node
// Aggregates the `flaky-*` artifacts that verify-and-deploy.yml uploads after
// every unit and browser shard into one table of unstable tests.
//
//   node scripts/flaky-report.mjs [--days 14] [--json] [--dir <cache>]
//
// Uses the local `gh` login only (no tokens in the repo, no external service).
// Downloaded artifacts are cached in --dir (default .flaky-cache/), so a second
// run only fetches new runs. An unstable test is counted when it
//   - passed only on a Playwright/Vitest retry inside one job ("retry pass"), or
//   - failed in a job and the same job passed on a later attempt of the same
//     commit ("rerun pass").
// A failure that never passed again on that commit is a "hard fail": likely a
// real regression, shown for context only.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = 'verify-and-deploy.yml';
const ARTIFACT_PREFIX = 'flaky-';

const testKey = (test) => `${test.project}|${test.file}|${test.title}`;
const jobKey = (record) => `${record.kind}|${record.sha}|${record.job}`;

/** The same job on the same commit ran again later and this test did not fail. */
const passedLater = (sameJob, record, test) =>
  sameJob.some(
    (other) =>
      other.createdAt > record.createdAt &&
      !other.missingReport &&
      !(other.tests ?? []).some((t) => t.status === 'failed' && testKey(t) === testKey(test)),
  );

/** Pure: records → rows sorted by unstable count. */
export function aggregate(records) {
  const runsByKind = new Map();
  const byJob = new Map();
  for (const record of records) {
    const runs = runsByKind.get(record.kind) ?? new Set();
    runsByKind.set(record.kind, runs.add(`${record.runId}|${record.attempt}|${record.job}`));
    byJob.set(jobKey(record), [...(byJob.get(jobKey(record)) ?? []), record]);
  }
  const rows = new Map();
  const row = (record, test) => {
    const key = `${record.kind}|${testKey(test)}`;
    const existing = rows.get(key) ?? {
      kind: record.kind,
      project: test.project,
      file: test.file,
      title: test.title,
      retryPass: 0,
      rerunPass: 0,
      hardFail: 0,
      last: '',
      errors: new Map(),
    };
    rows.set(key, existing);
    return existing;
  };
  for (const record of records) {
    for (const test of record.tests ?? []) {
      const target = row(record, test);
      if (test.status === 'flaky') target.retryPass += 1;
      else if (passedLater(byJob.get(jobKey(record)) ?? [], record, test)) target.rerunPass += 1;
      else target.hardFail += 1;
      if (record.createdAt > target.last) target.last = record.createdAt;
      if (test.error) target.errors.set(test.error, (target.errors.get(test.error) ?? 0) + 1);
    }
  }
  return [...rows.values()]
    .map(({ errors, ...rest }) => ({
      ...rest,
      flaky: rest.retryPass + rest.rerunPass,
      runs: runsByKind.get(rest.kind)?.size ?? 0,
      topError: [...errors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    }))
    .filter((r) => r.flaky > 0)
    .sort((a, b) => b.flaky - a.flaky || b.last.localeCompare(a.last));
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function listRuns(days) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const out = gh([
    'run',
    'list',
    '--workflow',
    WORKFLOW,
    '--created',
    `>=${since}`,
    '--limit',
    '2000',
    '--json',
    'databaseId,status',
  ]);
  return JSON.parse(out)
    .filter((run) => run.status === 'completed')
    .map((run) => run.databaseId);
}

function download(runId, dir) {
  const target = join(dir, String(runId));
  if (existsSync(target)) return target;
  try {
    gh(['run', 'download', String(runId), '--pattern', `${ARTIFACT_PREFIX}*`, '--dir', target]);
  } catch {
    // Runs before the collector landed, light runs and expired artifacts
    // have nothing to download; remember that so the next call skips them.
    mkdirSync(target, { recursive: true });
  }
  return target;
}

function readRecords(dir) {
  const records = [];
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json')) {
        try {
          records.push(JSON.parse(readFileSync(full, 'utf8')));
        } catch (error) {
          console.error(`skip ${full}: ${error.message}`);
        }
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return records;
}

function printTable(rows, days, recordCount) {
  console.log(`Unstable tests, last ${days} days (${recordCount} shard reports)\n`);
  console.log('| flaky | retry | rerun | hard | runs | last | kind | test | top error |');
  console.log('|---:|---:|---:|---:|---:|---|---|---|---|');
  for (const r of rows) {
    const name = `${r.project ? `[${r.project}] ` : ''}${r.file} › ${r.title}`.replaceAll(
      '|',
      '\\|',
    );
    const error = r.topError.replaceAll('|', '\\|').slice(0, 80);
    console.log(
      `| ${r.flaky} | ${r.retryPass} | ${r.rerunPass} | ${r.hardFail} | ${r.runs} | ${r.last.slice(0, 10)} | ${r.kind} | ${name} | ${error} |`,
    );
  }
  if (rows.length === 0) console.log('| 0 | | | | | | | no unstable tests | |');
}

function parseArgs(argv) {
  const args = { days: 14, json: false, dir: '.flaky-cache' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--days') args.days = Number(argv[(i += 1)]);
    else if (argv[i] === '--dir') args.dir = argv[(i += 1)];
    else if (argv[i] === '--json') args.json = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!Number.isFinite(args.days) || args.days <= 0)
    throw new Error('--days must be a positive number');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.dir, { recursive: true });
  const since = Date.now() - args.days * 86_400_000;
  for (const runId of listRuns(args.days)) download(runId, args.dir);
  const records = readRecords(args.dir).filter((r) => Date.parse(r.createdAt) >= since);
  const rows = aggregate(records);
  if (args.json) console.log(JSON.stringify(rows, null, 2));
  else printTable(rows, args.days, records.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`flaky-report: ${error.message}`);
    process.exit(1);
  }
}
