/**
 * Адаптивный темп подкачки текста hh (03.11, AIMD): растёт на шаг после чистого
 * окна, делится пополам на первом же отказе 403/429/451/капче. Часы подаются
 * снаружи, значения — в одной таблице констант.
 */

export interface HhTextRateConfig {
  readonly startRatePerSec: number;
  readonly minRatePerSec: number;
  readonly maxRatePerSec: number;
  readonly stepPerSec: number;
  readonly windowMs: number;
  /** Окно с меньшим числом запросов ничего не доказывает — темп не растёт. */
  readonly minSamples: number;
  /** Доля ответов 5xx/сбоев сети, с которой окно уже не чистое. */
  readonly maxServerErrorShare: number;
  readonly maxInFlight: number;
}

export const HH_TEXT_RATE_DEFAULTS: HhTextRateConfig = {
  startRatePerSec: 2,
  minRatePerSec: 1,
  maxRatePerSec: 10,
  stepPerSec: 1,
  windowMs: 10 * 60 * 1_000,
  minSamples: 20,
  maxServerErrorShare: 0.02,
  maxInFlight: 8,
};

export type HhTextOutcome = 'ok' | 'refusal' | 'server_error';

/** Итог закрытого окна: одна строка журнала `hh-text-rate`. */
export interface HhTextRateWindow {
  readonly ratePerSec: number;
  readonly peakRatePerSec: number;
  readonly requests: number;
  readonly refusals: number;
  readonly serverErrors: number;
  readonly refusalsTotal: number;
}

export interface HhTextRateSnapshot {
  readonly ratePerSec: number;
  readonly peakRatePerSec: number;
  readonly refusalsTotal: number;
  readonly inFlight: number;
}

export class HhTextRateController {
  private readonly config: HhTextRateConfig;
  private readonly now: () => number;
  private rate: number;
  private peak: number;
  private windowStart: number;
  private requests = 0;
  private refusals = 0;
  private serverErrors = 0;
  private refusalsTotal = 0;
  private closed: HhTextRateWindow | undefined;

  constructor(options: { now?: () => number } & Partial<HhTextRateConfig> = {}) {
    const { now, ...overrides } = options;
    this.config = { ...HH_TEXT_RATE_DEFAULTS, ...overrides };
    this.now = now ?? Date.now;
    this.rate = this.config.startRatePerSec;
    this.peak = this.rate;
    this.windowStart = this.now();
  }

  intervalMs(): number {
    this.roll();
    return Math.round(1_000 / this.rate);
  }

  maxInFlight(): number {
    this.roll();
    return Math.min(this.config.maxInFlight, Math.max(1, Math.ceil(this.rate)));
  }

  /** Сколько карточек брать за тик, чтобы такты не терялись при текущем темпе. */
  portionFor(tickMs: number): number {
    this.roll();
    return Math.max(1, Math.ceil((this.rate * tickMs) / 1_000));
  }

  record(outcome: HhTextOutcome): void {
    this.roll();
    this.requests += 1;
    if (outcome === 'server_error') this.serverErrors += 1;
    if (outcome !== 'refusal') return;
    this.refusals += 1;
    this.refusalsTotal += 1;
    this.rate = Math.max(this.config.minRatePerSec, this.rate / 2);
  }

  snapshot(): HhTextRateSnapshot {
    this.roll();
    return {
      ratePerSec: this.rate,
      peakRatePerSec: this.peak,
      refusalsTotal: this.refusalsTotal,
      inFlight: this.maxInFlight(),
    };
  }

  /** Сводка последнего закрытого окна — один раз. */
  takeClosedWindow(): HhTextRateWindow | undefined {
    this.roll();
    const closed = this.closed;
    this.closed = undefined;
    return closed;
  }

  private roll(): void {
    const at = this.now();
    if (at - this.windowStart < this.config.windowMs) return;
    const clean =
      this.requests >= this.config.minSamples &&
      this.refusals === 0 &&
      this.serverErrors / this.requests < this.config.maxServerErrorShare;
    if (clean) {
      this.rate = Math.min(this.config.maxRatePerSec, this.rate + this.config.stepPerSec);
      this.peak = Math.max(this.peak, this.rate);
    }
    this.closed = {
      ratePerSec: this.rate,
      peakRatePerSec: this.peak,
      requests: this.requests,
      refusals: this.refusals,
      serverErrors: this.serverErrors,
      refusalsTotal: this.refusalsTotal,
    };
    this.windowStart = at;
    this.requests = 0;
    this.refusals = 0;
    this.serverErrors = 0;
  }
}
