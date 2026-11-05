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
  /** How many late timers in a row may be forgiven before the request is aborted anyway. */
  maxGraces?: number;
}

const DEFAULT_GRACE_MS = 10_000;
const DEFAULT_LAG_MS = 2_000;
// 05.11: the loop was blocked 48 % of the time, so one grace often landed in the next stall.
const DEFAULT_MAX_GRACES = 5;

export async function withRequestTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  options: RequestTimeoutOptions = {},
): Promise<T> {
  const clock = options.clock ?? Date.now;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const lagMs = options.lagMs ?? DEFAULT_LAG_MS;
  const controller = new AbortController();
  const maxGraces = options.maxGraces ?? DEFAULT_MAX_GRACES;
  let expectedAt = clock() + timeoutMs;
  let graces = 0;
  let timer: ReturnType<typeof setTimeout>;

  const onTimer = () => {
    const firedAt = clock();
    if (firedAt - expectedAt >= lagMs && graces < maxGraces) {
      graces += 1;
      expectedAt = firedAt + graceMs;
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

/**
 * `fetch failed` alone cannot tell a refused connection from a connect timer
 * that fired after a stall: the reason is in `cause`, so it goes into the journal.
 */
export function failureMessage(reason: unknown): string {
  if (!(reason instanceof Error)) return String(reason);
  const cause = (reason as Error & { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' ? `${reason.message} (${cause.code})` : reason.message;
}
