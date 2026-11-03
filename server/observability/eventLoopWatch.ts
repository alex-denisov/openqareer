import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { redactRequestUrlForLogs } from './redactRequestUrl';

type WatchLog = (fields: Record<string, unknown>, message: string) => void;

export interface EventLoopWatchOptions {
  /** Defaults to the app logger at info. */
  readonly log?: WatchLog;
  /** A tick that arrives this much late is a stall worth naming. */
  readonly stallMs?: number;
  readonly tickMs?: number;
  /** Loop delay percentiles are logged and reset this often. */
  readonly reportMs?: number;
}

interface Tracked {
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

const NS_PER_MS = 1e6;
const MAX_NAMED = 8;

const round = (value: number) => Math.round(value * 10) / 10;

/** Requests open during the held window, finished ones included, oldest first. */
function heldRequests(
  tracked: Map<string, Tracked>,
  windowStart: number,
  now: number,
): HeldRequest[] {
  const held = [...tracked.entries()];
  for (const [id, item] of held) {
    if (item.finishedAt !== undefined) tracked.delete(id);
  }
  return held
    .map(([, item]) => item)
    .filter((item) => item.finishedAt === undefined || item.finishedAt >= windowStart)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((item) => ({
      method: item.method,
      url: item.url,
      ageMs: Math.round((item.finishedAt ?? now) - item.startedAt),
      finished: item.finishedAt !== undefined,
    }));
}

interface HeldRequest {
  readonly method: string;
  readonly url: string;
  readonly ageMs: number;
  readonly finished: boolean;
}

/**
 * The named few: unfinished requests first, then finished ones, each oldest first. Prod 03.11:
 * eight finished company reads filled the list and hid the request that held a 7.6 s stall.
 */
export function namedInFlight(held: readonly HeldRequest[]): HeldRequest[] {
  const open = held.filter((item) => !item.finished);
  const done = held.filter((item) => item.finished);
  return [...open, ...done].slice(0, MAX_NAMED);
}

function trackRequests(app: FastifyInstance): Map<string, Tracked> {
  const tracked = new Map<string, Tracked>();
  app.addHook('onRequest', async (request) => {
    tracked.set(request.id, {
      method: request.method,
      url: redactRequestUrlForLogs(request.url),
      startedAt: performance.now(),
    });
  });
  // A handler that holds the loop often finishes before the late tick sees the stall, so a
  // finished request stays named until the next tick.
  const finish = async (request: { id: string }) => {
    const item = tracked.get(request.id);
    if (item) tracked.set(request.id, { ...item, finishedAt: performance.now() });
  };
  app.addHook('onResponse', finish);
  // Prod 03.11: a read the client dropped never reached onResponse and stayed «in flight» for hours,
  // crowding the requests that really held the loop out of the named eight.
  app.addHook('onRequestAbort', finish);
  return tracked;
}

function stallTicker(
  tracked: Map<string, Tracked>,
  log: WatchLog,
  stallMs: number,
  tickMs: number,
) {
  let lastTick = performance.now();
  return {
    reset: () => {
      lastTick = performance.now();
    },
    tick: () => {
      const now = performance.now();
      const late = now - lastTick - tickMs;
      const held = heldRequests(tracked, lastTick, now);
      lastTick = now;
      if (late < stallMs) return;
      log(
        {
          stallMs: Math.round(late),
          inFlight: namedInFlight(held),
          inFlightCount: held.length,
          unfinishedCount: held.filter((item) => !item.finished).length,
        },
        'event-loop-stall',
      );
    },
  };
}

function lagReporter(log: WatchLog) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  let last = performance.eventLoopUtilization();
  return {
    delay,
    report: () => {
      const utilization = performance.eventLoopUtilization(last);
      last = performance.eventLoopUtilization();
      log(
        {
          p50Ms: round(delay.percentile(50) / NS_PER_MS),
          p99Ms: round(delay.percentile(99) / NS_PER_MS),
          maxMs: round(delay.max / NS_PER_MS),
          utilization: Math.round(utilization.utilization * 100) / 100,
        },
        'event-loop-lag',
      );
      delay.reset();
    },
  };
}

/**
 * Measures how long the event loop is held and by what (CPO prod 02.11: /health took 37 s and
 * static files 23 s). A stall names the requests that were open while the loop was held.
 */
export function registerEventLoopWatch(
  app: FastifyInstance,
  options: EventLoopWatchOptions = {},
): void {
  const { stallMs = 250, tickMs = 50, reportMs = 60_000 } = options;
  const log: WatchLog = options.log ?? ((fields, message) => app.log.info(fields, message));
  const stalls = stallTicker(trackRequests(app), log, stallMs, tickMs);
  const lag = lagReporter(log);
  const timers: NodeJS.Timeout[] = [];
  app.addHook('onReady', async () => {
    lag.delay.enable();
    stalls.reset();
    timers.push(setInterval(stalls.tick, tickMs), setInterval(lag.report, reportMs));
    timers.forEach((timer) => timer.unref());
  });
  app.addHook('onClose', async () => {
    timers.forEach((timer) => clearInterval(timer));
    lag.delay.disable();
  });
}
