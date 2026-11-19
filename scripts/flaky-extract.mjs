#!/usr/bin/env node
// Turns a Playwright or Vitest JSON report into a small record of the tests
// that failed or passed only on a retry. CI uploads the record as an artifact
// after every unit and browser shard; scripts/flaky-report.mjs aggregates them.
//
// Usage: node scripts/flaky-extract.mjs <report.json> <out.json>
// Context comes from the GitHub Actions environment (sha, run, attempt, job).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ERROR_CHARS = 300;

const firstLine = (text) =>
  String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim()
    .slice(0, MAX_ERROR_CHARS) ?? '';

function* walkSuites(suites, titles = []) {
  for (const suite of suites ?? []) {
    const path = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) yield { spec, titles: path };
    yield* walkSuites(suite.suites, path);
  }
}

/** Playwright `json` reporter → entries. `flaky` = failed, then passed on retry. */
export function fromPlaywright(report) {
  const entries = [];
  for (const { spec, titles } of walkSuites(report.suites)) {
    for (const test of spec.tests ?? []) {
      if (test.status !== 'flaky' && test.status !== 'unexpected') continue;
      const failedResult = (test.results ?? []).find((result) => result.status !== 'passed');
      entries.push({
        status: test.status === 'flaky' ? 'flaky' : 'failed',
        file: spec.file,
        title: [...titles.slice(1), spec.title].join(' › '),
        project: test.projectName ?? '',
        retries: Math.max(0, (test.results ?? []).length - 1),
        error: firstLine(failedResult?.error?.message ?? failedResult?.errors?.[0]?.message),
      });
    }
  }
  return entries;
}

/** Vitest `json` reporter (Jest shape) → entries. */
export function fromVitest(report, cwd = process.cwd()) {
  const entries = [];
  for (const file of report.testResults ?? []) {
    const relative = String(file.name ?? '').replace(`${cwd}/`, '');
    for (const test of file.assertionResults ?? []) {
      const retried = Number(test.retryCount ?? 0) > 0;
      if (test.status === 'passed' && !retried) continue;
      if (test.status !== 'passed' && test.status !== 'failed') continue;
      entries.push({
        status: test.status === 'passed' ? 'flaky' : 'failed',
        file: relative,
        title: test.fullName ?? [...(test.ancestorTitles ?? []), test.title].join(' > '),
        project: 'unit',
        retries: Number(test.retryCount ?? 0),
        error: firstLine(test.failureMessages?.[0]),
      });
    }
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) {
      entries.push({
        status: 'failed',
        file: relative,
        title: '(file failed to load)',
        project: 'unit',
        retries: 0,
        error: firstLine(file.message),
      });
    }
  }
  return entries;
}

export function extract(report, context) {
  const kind = Array.isArray(report.testResults) ? 'unit' : 'e2e';
  const tests = kind === 'unit' ? fromVitest(report, context.cwd) : fromPlaywright(report);
  return {
    version: 1,
    kind,
    sha: context.sha,
    runId: context.runId,
    attempt: context.attempt,
    job: context.job,
    ref: context.ref,
    createdAt: context.now,
    tests,
  };
}

function main([input, output]) {
  if (!input || !output) {
    console.error('usage: flaky-extract.mjs <report.json> <out.json>');
    process.exit(2);
  }
  const env = process.env;
  const context = {
    sha: env.GITHUB_SHA ?? '',
    runId: Number(env.GITHUB_RUN_ID ?? 0),
    attempt: Number(env.GITHUB_RUN_ATTEMPT ?? 1),
    job: env.FLAKY_JOB_NAME ?? env.GITHUB_JOB ?? '',
    ref: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '',
    now: new Date().toISOString(),
    cwd: process.cwd(),
  };
  // A shard that died before its reporter wrote anything still leaves a
  // record, so the aggregate can tell "no report" from "all green".
  const record = existsSync(input)
    ? extract(JSON.parse(readFileSync(input, 'utf8')), context)
    : { ...extract({ suites: [] }, context), missingReport: true };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  const flaky = record.tests.filter((test) => test.status === 'flaky').length;
  const failed = record.tests.length - flaky;
  console.log(`flaky-extract: ${flaky} flaky, ${failed} failed → ${output}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
