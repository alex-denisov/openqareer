/**
 * A request deadline that measures network time, not event-loop stalls.
 *
 * `AbortSignal.timeout` is a plain timer. When the process blocks the loop for
 * tens of seconds (synchronous pool writes, 1990 `pool-write-slow` events on
 * 03.11), every in-flight request's timer fires on the first tick after the
 * stall, before the loop reads the responses that already arrived: eleven
 * sources failed "timeout" with one timestamp. A timer that fires much later
 * than it was set for proves the loop, not the source, was the slow party, so
 * the request gets one short grace period to let queued I/O run.
 */
export interface RequestTimeoutOptions {
  clock?: () => number;
  graceMs?: number;
  lagMs?: number;
}

const DEFAULT_GRACE_MS = 10_000;
const DEFAULT_LAG_MS = 2_000;

export async function withRequestTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  options: RequestTimeoutOptions = {},
): Promise<T> {
  const clock = options.clock ?? Date.now;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const lagMs = options.lagMs ?? DEFAULT_LAG_MS;
  const controller = new AbortController();
  const startedAt = clock();
  let graced = false;
  let timer: ReturnType<typeof setTimeout>;

  const onTimer = () => {
    const lateBy = clock() - startedAt - timeoutMs;
    if (!graced && lateBy >= lagMs) {
      graced = true;
      timer = setTimeout(onTimer, graceMs);
      return;
    }
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  };
  timer = setTimeout(onTimer, timeoutMs);

  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
