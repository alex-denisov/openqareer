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
  /** Пауза и интервал, пережившие перезапуск процесса (09.11: 5 стартов за час). */
  readonly initial?: { readonly pausedUntil: number; readonly gapMs: number };
  /** Вызывается после 429 и после ослабления интервала: сохранить состояние. */
  readonly onChange?: (stats: LinkedinBudgetStats) => void;
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

class SharedGuestBudget implements LinkedinGuestBudget {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseGapMs: number;
  private readonly maxGapMs: number;
  private readonly pauseMs: number;
  private readonly shares: Readonly<Record<LinkedinConsumer, number>>;
  private gapMs: number;
  private pausedUntil = 0;
  private lastGrantAt = -Infinity;
  private lastLimitAt = -Infinity;
  private lastRelaxAt = 0;
  private waiters: readonly Waiter[] = [];
  private pumping = false;
  private grants: readonly { at: number; consumer: LinkedinConsumer }[] = [];
  private limits: readonly number[] = [];

  private readonly onChange: (stats: LinkedinBudgetStats) => void;

  constructor(options: LinkedinGuestBudgetOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.baseGapMs = options.baseGapMs ?? DEFAULT_GAP_MS;
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
    this.pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
    this.shares = options.shares ?? DEFAULT_SHARES;
    this.onChange = options.onChange ?? (() => undefined);
    this.gapMs = Math.min(this.maxGapMs, Math.max(this.baseGapMs, options.initial?.gapMs ?? 0));
    this.pausedUntil = options.initial?.pausedUntil ?? 0;
    // Пауза из прошлого процесса — как недавний 429: интервал не ослабевает сразу.
    if (this.pausedUntil > this.now()) this.lastLimitAt = this.now();
  }

  acquire(consumer: LinkedinConsumer): Promise<void> {
    const t = this.now();
    if (t < this.pausedUntil) return Promise.reject(new LinkedinPaused(this.pausedUntil, t));
    const granted = new Promise<void>((resolve, reject) => {
      this.waiters = [...this.waiters, { consumer, resolve, reject }];
    });
    void this.pump();
    return granted;
  }

  markRateLimited(): void {
    const t = this.now();
    this.pausedUntil = Math.max(this.pausedUntil, t + this.pauseMs);
    this.gapMs = Math.min(this.maxGapMs, this.gapMs * 2);
    this.lastLimitAt = t;
    this.limits = [...this.limits, t];
    this.rejectAll(t);
    this.onChange(this.stats());
  }

  isPaused(): boolean {
    return this.now() < this.pausedUntil;
  }

  stats(): LinkedinBudgetStats {
    this.prune(this.now());
    const count = (c: LinkedinConsumer) => this.grants.filter((g) => g.consumer === c).length;
    return {
      gapMs: this.gapMs,
      pausedUntil: this.pausedUntil,
      lastHour: {
        resolver: count('resolver'),
        companies: count('companies'),
        guest: count('guest'),
      },
      rateLimitedLastHour: this.limits.length,
    };
  }

  private prune(t: number): void {
    this.grants = this.grants.filter((g) => t - g.at < HOUR_MS);
    this.limits = this.limits.filter((at) => t - at < HOUR_MS);
  }

  private usage(consumer: LinkedinConsumer): number {
    return this.grants.filter((g) => g.consumer === consumer).length / this.shares[consumer];
  }

  private relax(t: number): void {
    if (
      this.gapMs > this.baseGapMs &&
      t - this.lastLimitAt >= HOUR_MS &&
      t - this.lastRelaxAt >= HOUR_MS / 4
    ) {
      this.gapMs = Math.max(this.baseGapMs, Math.round(this.gapMs * 0.75));
      this.lastRelaxAt = t;
      this.onChange(this.stats());
    }
  }

  private rejectAll(t: number): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.reject(new LinkedinPaused(this.pausedUntil, t));
  }

  private grantNext(t: number): void {
    this.prune(t);
    this.relax(t);
    const pick = this.waiters.reduce((best, w) =>
      this.usage(w.consumer) < this.usage(best.consumer) ? w : best,
    );
    this.waiters = this.waiters.filter((w) => w !== pick);
    this.lastGrantAt = t;
    this.grants = [...this.grants, { at: t, consumer: pick.consumer }];
    pick.resolve();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length > 0) {
        const t = this.now();
        if (t < this.pausedUntil) return this.rejectAll(t);
        const wait = this.lastGrantAt + this.gapMs - t;
        if (wait > 0) await this.sleep(wait);
        else this.grantNext(t);
      }
    } finally {
      this.pumping = false;
    }
  }
}

export function createLinkedinGuestBudget(
  options: LinkedinGuestBudgetOptions = {},
): LinkedinGuestBudget {
  return new SharedGuestBudget(options);
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
