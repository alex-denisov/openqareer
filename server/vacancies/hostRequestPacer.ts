/**
 * Phase 1 F5 — Shared per-host request pacer & cooldown window.
 *
 * Keeps concurrent company-lane workers (e.g., 16 sibling `ats-join-*` boards)
 * within safe per-host request cadence (~1.54 req/s on join.com), enforces
 * FIFO start-to-start spacing without serializing network latency, and shares
 * `429`/`503` `Retry-After` pauses across sibling boards on the same hostname.
 */

export const DEFAULT_MAX_INLINE_WAIT_MS = 30_000;
export const DEFAULT_MAX_HOST_PAUSE_MS = 1_800_000;
const DEFAULT_FALLBACK_PAUSE_MS = 6_000;
const MAX_TRACKED_HOSTS = 256;

export const DEFAULT_HOST_PACE_MS: Readonly<Record<string, number>> = {
  'join.com': 650,
  'recruiting.paylocity.com': 350,
};

export interface HostPacerOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly maxInlineWaitMs?: number;
  readonly maxHostPauseMs?: number;
  readonly hostIntervalsMs?: Readonly<Record<string, number>>;
}

export class HostPausedError extends Error {
  readonly statusCode: number;
  readonly headers: Headers;
  readonly host: string;

  constructor(host: string, statusCode: number, remainingMs: number) {
    const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    super(`vacancy_source_host_paused: ${host} (${statusCode}, retry-after: ${retryAfterSeconds})`);
    this.name = 'HostPausedError';
    this.host = host;
    this.statusCode = statusCode;
    this.headers = new Headers({ 'retry-after': String(retryAfterSeconds) });
  }
}

export interface HostRequestPacer {
  acquire(url: string): Promise<void>;
  recordResponse(url: string, status: number, headers?: Headers): void;
  isHostPaused(host: string, nowMs?: number): boolean;
  isLongPaused(host: string, nowMs?: number): boolean;
  minIntervalForHost(host: string): number;
  readonly maxInlineWaitMs: number;
}

interface HostState {
  nextAllowedAt: number;
  pausedUntil: number;
  pausedStatus: number;
  chain: Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function parseRetryAfterMs(headers: Headers | undefined, nowMs: number): number | undefined {
  const raw = headers?.get('retry-after')?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function matchIntervalForHost(intervals: Readonly<Record<string, number>>, host: string): number {
  const lower = host.toLowerCase();
  for (const [pattern, interval] of Object.entries(intervals)) {
    if (lower === pattern || lower.endsWith(`.${pattern}`)) return interval;
  }
  return 0;
}

function pruneExpiredHosts(hosts: Map<string, HostState>, nowMs: number): void {
  if (hosts.size <= MAX_TRACKED_HOSTS) return;
  for (const [key, entry] of hosts.entries()) {
    if (entry.pausedUntil <= nowMs && entry.nextAllowedAt <= nowMs) hosts.delete(key);
    if (hosts.size <= MAX_TRACKED_HOSTS) break;
  }
}

async function waitForHostSlot(
  state: HostState,
  host: string,
  interval: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  maxInlineWaitMs: number,
): Promise<void> {
  const t0 = now();
  if (state.pausedUntil > t0) {
    const remaining = state.pausedUntil - t0;
    if (remaining > maxInlineWaitMs) throw new HostPausedError(host, state.pausedStatus, remaining);
    await sleep(remaining);
  }
  if (interval > 0) {
    const t1 = now();
    const slotWait = Math.max(0, state.nextAllowedAt - t1);
    if (slotWait > 0) await sleep(slotWait);
    const t2 = now();
    state.nextAllowedAt = Math.max(t2, state.nextAllowedAt) + interval;
  }
}

export function createHostRequestPacer(options: HostPacerOptions = {}): HostRequestPacer {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const maxInlineWaitMs = options.maxInlineWaitMs ?? DEFAULT_MAX_INLINE_WAIT_MS;
  const maxHostPauseMs = options.maxHostPauseMs ?? DEFAULT_MAX_HOST_PAUSE_MS;
  const intervals = { ...DEFAULT_HOST_PACE_MS, ...options.hostIntervalsMs };
  const hosts = new Map<string, HostState>();

  const minIntervalForHost = (host: string): number => matchIntervalForHost(intervals, host);
  const getOrCreate = (host: string): HostState => {
    const existing = hosts.get(host);
    if (existing) return existing;
    pruneExpiredHosts(hosts, now());
    const created: HostState = { nextAllowedAt: 0, pausedUntil: 0, pausedStatus: 429, chain: Promise.resolve() };
    hosts.set(host, created);
    return created;
  };

  async function acquire(url: string): Promise<void> {
    const host = hostOfUrl(url);
    if (!host) return;
    const state = getOrCreate(host);
    const prior = state.chain;
    let release!: () => void;
    state.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      await waitForHostSlot(state, host, minIntervalForHost(host), now, sleep, maxInlineWaitMs);
    } finally {
      release();
    }
  }

  function recordResponse(url: string, status: number, headers?: Headers): void {
    if (status !== 429 && status !== 503) return;
    const host = hostOfUrl(url);
    if (!host) return;
    const state = getOrCreate(host);
    const t = now();
    const clamped = Math.min(parseRetryAfterMs(headers, t) ?? DEFAULT_FALLBACK_PAUSE_MS, maxHostPauseMs);
    if (clamped > 0 && t + clamped > state.pausedUntil) {
      state.pausedUntil = t + clamped;
      state.pausedStatus = status;
    }
  }

  const isHostPaused = (host: string, nowMs: number = now()): boolean =>
    (hosts.get(host.toLowerCase())?.pausedUntil ?? 0) > nowMs;
  const isLongPaused = (host: string, nowMs: number = now()): boolean =>
    (hosts.get(host.toLowerCase())?.pausedUntil ?? 0) - nowMs > maxInlineWaitMs;

  return { acquire, recordResponse, isHostPaused, isLongPaused, minIntervalForHost, maxInlineWaitMs };
}
