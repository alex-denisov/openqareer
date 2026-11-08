/**
 * B622: один бюджет гостевых запросов LinkedIn на процесс для трёх
 * потребителей — резолвер org_id (B621), каналы компаний и общий гостевой
 * поиск. Раньше каждый держал свой темп, и сумма (общий поиск — 160 страниц
 * за синк с паузой 0,4–1 с) ставила адрес прода под 429 (09.11).
 *
 * - Между любыми двумя запросами — не меньше `gapMs`.
 * - Когда ждут несколько потребителей, слот получает тот, у кого за
 *   последний час меньше всего запросов относительно его доли. Свободный
 *   слот отдаётся тому, кто ждёт, — бюджет не простаивает.
 * - 429 ставит паузу всем и вдвое растягивает интервал (до потолка); час без
 *   429 возвращает интервал к базовому шагами по 25 %.
 */
export type LinkedinConsumer = 'resolver' | 'companies' | 'guest';

export interface LinkedinGuestBudgetOptions {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly baseGapMs?: number;
  readonly maxGapMs?: number;
  readonly pauseMs?: number;
  readonly shares?: Readonly<Record<LinkedinConsumer, number>>;
}

export interface LinkedinBudgetStats {
  readonly gapMs: number;
  readonly pausedUntil: number;
  readonly lastHour: Readonly<Record<LinkedinConsumer, number>>;
  readonly rateLimitedLastHour: number;
}

export interface LinkedinGuestBudget {
  /** Ждёт свой слот; во время паузы бросает ошибку 429 с Retry-After. */
  acquire(consumer: LinkedinConsumer): Promise<void>;
  markRateLimited(): void;
  isPaused(): boolean;
  stats(): LinkedinBudgetStats;
}

/**
 * Замер 09.11: 56 запросов подряд без 429 при ~0,7 с, но сумма трёх
 * потребителей под нагрузку часа давала 429. 4 с = 900 запросов в час на всех.
 */
export const DEFAULT_GAP_MS = 4_000;
const DEFAULT_MAX_GAP_MS = 60_000;
const DEFAULT_PAUSE_MS = 30 * 60_000;
const HOUR_MS = 60 * 60_000;
/** Пока ID нет у ~2/3 компаний, резолверу половина: ID открывают каналы. */
export const DEFAULT_SHARES: Readonly<Record<LinkedinConsumer, number>> = {
  resolver: 0.5,
  companies: 0.3,
  guest: 0.2,
};

export class LinkedinPaused extends Error {
  readonly statusCode = 429;
  readonly headers: Headers;
  constructor(
    readonly untilMs: number,
    nowMs: number,
  ) {
    super('vacancy_source_unreachable: 429 (linkedin_paused)');
    this.name = 'LinkedinPaused';
    const seconds = Math.max(1, Math.ceil((untilMs - nowMs) / 1000));
    this.headers = new Headers({ 'retry-after': String(seconds) });
  }
}

interface Waiter {
  readonly consumer: LinkedinConsumer;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export function createLinkedinGuestBudget(
  options: LinkedinGuestBudgetOptions = {},
): LinkedinGuestBudget {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const baseGapMs = options.baseGapMs ?? DEFAULT_GAP_MS;
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const shares = options.shares ?? DEFAULT_SHARES;
  let gapMs = baseGapMs;
  let pausedUntil = 0;
  let lastGrantAt = -Infinity;
  let lastLimitAt = -Infinity;
  let lastRelaxAt = 0;
  let waiters: Waiter[] = [];
  let pumping = false;
  let grants: { at: number; consumer: LinkedinConsumer }[] = [];
  let limits: number[] = [];

  const prune = (t: number): void => {
    grants = grants.filter((g) => t - g.at < HOUR_MS);
    limits = limits.filter((at) => t - at < HOUR_MS);
  };

  const usage = (consumer: LinkedinConsumer): number =>
    grants.filter((g) => g.consumer === consumer).length / shares[consumer];

  const relax = (t: number): void => {
    if (gapMs > baseGapMs && t - lastLimitAt >= HOUR_MS && t - lastRelaxAt >= HOUR_MS / 4) {
      gapMs = Math.max(baseGapMs, Math.round(gapMs * 0.75));
      lastRelaxAt = t;
    }
  };

  const rejectAll = (t: number): void => {
    const pending = waiters;
    waiters = [];
    for (const w of pending) w.reject(new LinkedinPaused(pausedUntil, t));
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      while (waiters.length > 0) {
        const t = now();
        if (t < pausedUntil) return rejectAll(t);
        const wait = lastGrantAt + gapMs - t;
        if (wait > 0) {
          await sleep(wait);
          continue;
        }
        prune(t);
        relax(t);
        const pick = waiters.reduce((best, w) =>
          usage(w.consumer) < usage(best.consumer) ? w : best,
        );
        waiters = waiters.filter((w) => w !== pick);
        lastGrantAt = t;
        grants = [...grants, { at: t, consumer: pick.consumer }];
        pick.resolve();
      }
    } finally {
      pumping = false;
    }
  };

  return {
    acquire(consumer: LinkedinConsumer): Promise<void> {
      const t = now();
      if (t < pausedUntil) return Promise.reject(new LinkedinPaused(pausedUntil, t));
      const granted = new Promise<void>((resolve, reject) => {
        waiters = [...waiters, { consumer, resolve, reject }];
      });
      void pump();
      return granted;
    },
    markRateLimited(): void {
      const t = now();
      pausedUntil = Math.max(pausedUntil, t + pauseMs);
      gapMs = Math.min(maxGapMs, gapMs * 2);
      lastLimitAt = t;
      limits = [...limits, t];
      rejectAll(t);
    },
    isPaused(): boolean {
      return now() < pausedUntil;
    },
    stats(): LinkedinBudgetStats {
      const t = now();
      prune(t);
      const count = (c: LinkedinConsumer) => grants.filter((g) => g.consumer === c).length;
      return {
        gapMs,
        pausedUntil,
        lastHour: {
          resolver: count('resolver'),
          companies: count('companies'),
          guest: count('guest'),
        },
        rateLimitedLastHour: limits.length,
      };
    },
  };
}

/** fetch через бюджет: слот до запроса, 429 в ответе — пауза всем. */
export function budgetedFetch(
  budget: LinkedinGuestBudget,
  consumer: LinkedinConsumer,
  inner: typeof fetch = fetch,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    await budget.acquire(consumer);
    const response = await inner(input, init);
    if (response.status === 429 || response.status === 999) budget.markRateLimited();
    return response;
  }) as typeof fetch;
}
