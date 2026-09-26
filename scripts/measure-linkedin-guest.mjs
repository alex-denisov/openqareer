#!/usr/bin/env node
import { access, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GUEST_ENDPOINT = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PAGE_SIZE = 10;
const LAST_TESTED_OFFSET = 550;
const MAX_PAGES_PER_QUERY = LAST_TESTED_OFFSET / PAGE_SIZE + 1;
const MIN_REQUEST_INTERVAL_MS = 5_000;
const REQUEST_JITTER_MS = 1_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const LINKEDIN_GUEST_MEASURE_QUERIES = Object.freeze([
  {
    number: 1,
    role: 'VP Technology & Operations',
    location: 'Dubai, United Arab Emirates',
    remote: false,
  },
  { number: 2, role: 'CTO', location: 'Dubai, United Arab Emirates', remote: false },
  {
    number: 3,
    role: 'Head of Engineering',
    location: 'Dubai, United Arab Emirates',
    remote: false,
  },
  {
    number: 4,
    role: 'Enterprise Architect',
    location: 'Dubai, United Arab Emirates',
    remote: false,
  },
  { number: 5, role: 'VP Technology & Operations', location: 'Moscow, Russia', remote: false },
  { number: 6, role: 'CTO', location: 'Moscow, Russia', remote: false },
  { number: 7, role: 'Head of Engineering', location: 'Moscow, Russia', remote: false },
  { number: 8, role: 'Head of Product', location: 'Moscow, Russia', remote: false },
  { number: 9, role: 'VP Technology & Operations', location: 'Worldwide', remote: true },
  { number: 10, role: 'CTO', location: 'Worldwide', remote: true },
  { number: 11, role: 'Head of Engineering', location: 'Worldwide', remote: true },
  { number: 12, role: 'Chief Product Officer', location: 'Worldwide', remote: true },
  { number: 13, role: 'Enterprise Architect', location: 'Worldwide', remote: true },
  { number: 14, role: 'VP Engineering', location: 'Berlin, Germany', remote: false },
  { number: 15, role: 'CTO', location: 'Berlin, Germany', remote: false },
  { number: 16, role: 'Head of Data', location: 'Berlin, Germany', remote: false },
  {
    number: 17,
    role: 'VP Technology & Operations',
    location: 'Amsterdam, Netherlands',
    remote: false,
  },
  {
    number: 18,
    role: 'Chief Information Officer',
    location: 'Amsterdam, Netherlands',
    remote: false,
  },
  { number: 19, role: 'Head of Engineering', location: 'Amsterdam, Netherlands', remote: false },
  { number: 20, role: 'VP AI', location: 'Worldwide', remote: true },
]);

export function buildGuestPageUrl(query, start) {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > LAST_TESTED_OFFSET ||
    start % PAGE_SIZE
  ) {
    throw new RangeError('LinkedIn guest page offset is outside the measured range.');
  }
  const url = new URL(GUEST_ENDPOINT);
  url.searchParams.set('keywords', query.role);
  url.searchParams.set('location', query.location);
  url.searchParams.set('f_TPR', 'r604800');
  url.searchParams.set('start', String(start));
  if (query.remote) url.searchParams.set('f_WT', '2');
  return url.toString();
}

export function parseGuestJobIds(html) {
  return Array.from(
    String(html).matchAll(/data-entity-urn=["']urn:li:jobPosting:(\d+)["']/g),
    (match) => match[1],
  );
}

function delay(milliseconds, signal) {
  return new Promise((resolveDelay, rejectDelay) => {
    if (signal.aborted) return rejectDelay(new Error('aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolveDelay();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      rejectDelay(new Error('aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function waitForRequestSlot(state) {
  if (state.signal.aborted) return false;
  if (state.requestCount === 0) return true;
  try {
    const jitter = Math.floor(state.random() * REQUEST_JITTER_MS);
    await state.sleep(MIN_REQUEST_INTERVAL_MS + jitter, state.signal);
    return !state.signal.aborted;
  } catch {
    return false;
  }
}

async function readBoundedHtml(response) {
  if (!response.body?.getReader) {
    const html = await response.text();
    return Buffer.byteLength(html, 'utf8') <= MAX_RESPONSE_BYTES ? html : null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

async function fetchGuestPage(url, signal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'manual',
    signal: AbortSignal.any([signal, timeoutSignal]),
  });
}

async function inspectGuestResponse(response) {
  const status = Number(response.status) || 0;
  const contentType = response.headers?.get('content-type') ?? '';
  if (status === 429 || status === 999) return { status, ids: [], stopReason: `http_${status}` };
  if (status !== 200)
    return { status, ids: [], stopReason: status ? `http_${status}` : 'network_error' };
  if (!contentType.toLowerCase().includes('text/html'))
    return { status, ids: [], stopReason: 'unexpected_content_type' };
  const html = await readBoundedHtml(response);
  return html === null
    ? { status, ids: [], stopReason: 'response_too_large' }
    : { status, ids: parseGuestJobIds(html), stopReason: null };
}

async function requestMeasurePage(query, pageIndex, state) {
  const start = pageIndex * PAGE_SIZE;
  if (!(await waitForRequestSlot(state))) {
    return {
      requested: false,
      page: pageIndex + 1,
      start,
      status: 0,
      elapsedMs: 0,
      ids: [],
      stopReason: 'aborted',
    };
  }
  const requestStarted = state.now();
  state.requestCount += 1;
  try {
    const response = await state.fetchPage(buildGuestPageUrl(query, start), state.signal);
    const { status, ids, stopReason } = await inspectGuestResponse(response);
    return {
      requested: true,
      page: pageIndex + 1,
      start,
      status,
      elapsedMs: Math.max(0, Math.round(state.now() - requestStarted)),
      ids,
      stopReason,
    };
  } catch {
    return {
      requested: true,
      page: pageIndex + 1,
      start,
      status: 0,
      elapsedMs: Math.max(0, Math.round(state.now() - requestStarted)),
      ids: [],
      stopReason: state.signal.aborted ? 'aborted' : 'network_error',
    };
  }
}

function emptyQueryResult(query, status = 'partial', stopReason = 'not_started') {
  return {
    number: query.number,
    role: query.role,
    location: query.location,
    remote: query.remote,
    status,
    stopReason,
    elapsedMs: 0,
    requestCount: 0,
    pages: [],
    returnedCount: 0,
    uniqueCount: 0,
    duplicateCount: 0,
    duplicateRatePct: 0,
  };
}

async function measureOneQuery(query, state) {
  const queryStarted = state.now();
  const pages = [];
  const uniqueIds = new Set();
  let returnedCount = 0;
  let stopReason = 'page_limit';

  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_QUERY; pageIndex += 1) {
    const pageResult = await requestMeasurePage(query, pageIndex, state);
    if (pageResult.requested) {
      pages.push({
        page: pageResult.page,
        start: pageResult.start,
        status: pageResult.status,
        elapsedMs: pageResult.elapsedMs,
        returnedCount: pageResult.ids.length,
      });
    }
    if (pageResult.stopReason) {
      stopReason = pageResult.stopReason;
      state.stopReason = stopReason;
      break;
    }
    if (pageResult.ids.length === 0) {
      stopReason = 'empty_page';
      break;
    }
    returnedCount += pageResult.ids.length;
    for (const id of pageResult.ids) uniqueIds.add(id);
  }

  const duplicateCount = returnedCount - uniqueIds.size;
  const status =
    stopReason === 'empty_page' || stopReason === 'page_limit' ? 'complete' : 'partial';
  return {
    ...emptyQueryResult(query, status, stopReason),
    elapsedMs: Math.max(0, Math.round(state.now() - queryStarted)),
    requestCount: pages.length,
    pages,
    returnedCount,
    uniqueCount: uniqueIds.size,
    duplicateCount,
    duplicateRatePct: returnedCount
      ? Number(((duplicateCount / returnedCount) * 100).toFixed(2))
      : 0,
  };
}

export async function measureGuestQueries({
  queries = LINKEDIN_GUEST_MEASURE_QUERIES,
  fetchPage = fetchGuestPage,
  sleep = delay,
  now = () => performance.now(),
  wallClock = () => new Date().toISOString(),
  random = Math.random,
  signal = new AbortController().signal,
} = {}) {
  const startedAt = wallClock();
  const state = { fetchPage, sleep, now, random, signal, requestCount: 0, stopReason: null };
  const results = [];
  for (const query of queries) {
    if (state.stopReason) {
      results.push(emptyQueryResult(query, 'skipped', state.stopReason));
      continue;
    }
    results.push(await measureOneQuery(query, state));
  }
  return {
    schemaVersion: 1,
    source: 'linkedin_guest',
    startedAt,
    finishedAt: wallClock(),
    requestCount: state.requestCount,
    stopReason: state.stopReason,
    queries: results,
  };
}

export function formatMeasurementTable(measurement) {
  const rows = [
    '# | Role | Location | Cards | Unique | Dup % | Pages | Last HTTP',
    ...measurement.queries.map((query) => {
      const lastStatus = query.pages.at(-1)?.status ?? '—';
      return `${query.number} | ${query.role} | ${query.location}${query.remote ? ' (remote)' : ''} | ${query.returnedCount} | ${query.uniqueCount} | ${query.duplicateRatePct}% | ${query.pages.length} | ${lastStatus}`;
    }),
  ];
  return rows.join('\n');
}

export function parseMeasureArgs(args) {
  let runLive = false;
  let outputPath = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--run-live') {
      if (runLive) throw new Error('Use --run-live only once.');
      runLive = true;
    } else if (args[index] === '--output') {
      if (outputPath) throw new Error('Use --output only once.');
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output requires a JSON file path.');
      outputPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  if (runLive && !outputPath) throw new Error('--run-live requires --output <path.json>.');
  if (!runLive && outputPath)
    throw new Error('--output requires --run-live; default mode sends no requests.');
  return { runLive, outputPath };
}

async function validateOutputPath(outputPath) {
  const path = resolve(outputPath);
  await access(dirname(path));
  try {
    await access(path);
    throw new Error('Output file already exists.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return path;
}

async function runCli(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseMeasureArgs(args);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (!options.runLive) {
    process.stdout.write(
      'Dry run: no LinkedIn requests sent. Use --run-live --output <path.json> to measure.\n',
    );
    return;
  }

  let outputPath;
  try {
    outputPath = await validateOutputPath(options.outputPath);
  } catch {
    process.stderr.write(
      'Output path must have an existing parent directory and a new filename.\n',
    );
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once('SIGINT', onInterrupt);
  try {
    const measurement = await measureGuestQueries({ signal: controller.signal });
    await writeFile(outputPath, `${JSON.stringify(measurement, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(`${formatMeasurementTable(measurement)}\nJSON: ${outputPath}\n`);
    if (measurement.stopReason === 'aborted') process.exitCode = 130;
    else if (measurement.stopReason) process.exitCode = 2;
  } catch {
    process.stderr.write('Measurement or JSON output failed; no successful result was recorded.\n');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
