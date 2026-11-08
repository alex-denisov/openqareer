/**
 * B622: вакансии компаний в LinkedIn читаются по одной и с паузой, а первый
 * 429 ставит на паузу все компании сразу — 429 значит «подождите», а не
 * «переходите к следующей». Состояние живёт в замыкании сборщика, не глобально.
 */
export interface LinkedinCompanyGate {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export interface LinkedinCompanyGateOptions {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly spacingMs?: number;
  readonly pauseMs?: number;
}

const DEFAULT_SPACING_MS = 1_500;
const DEFAULT_PAUSE_MS = 30 * 60_000;

function pausedError(untilMs: number, nowMs: number): Error {
  const seconds = Math.max(1, Math.ceil((untilMs - nowMs) / 1000));
  return Object.assign(new Error('vacancy_source_unreachable: 429 (linkedin_paused)'), {
    statusCode: 429,
    headers: new Headers({ 'retry-after': String(seconds) }),
  });
}

function isRateLimited(err: unknown): boolean {
  return (err as { statusCode?: number } | null)?.statusCode === 429;
}

export function createLinkedinCompanyGate(
  options: LinkedinCompanyGateOptions = {},
): LinkedinCompanyGate {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const spacingMs = options.spacingMs ?? DEFAULT_SPACING_MS;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  let pausedUntil = 0;
  let lastEndedAt = 0;
  let queue: Promise<unknown> = Promise.resolve();

  async function guarded<T>(task: () => Promise<T>): Promise<T> {
    if (now() < pausedUntil) throw pausedError(pausedUntil, now());
    const wait = lastEndedAt + spacingMs - now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } catch (err) {
      if (isRateLimited(err)) pausedUntil = now() + pauseMs;
      throw err;
    } finally {
      lastEndedAt = now();
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = queue.then(
        () => guarded(task),
        () => guarded(task),
      );
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
