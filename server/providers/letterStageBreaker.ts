import type { CoverLetterFailure } from './coverLetterWriter';

/**
 * B640, 10.11 (решение CPO): порядок цепочки утвердил владелец, но в часы деградации DeepSeek кандидат
 * ждал 22–26 с (таймаут 18 с и GLM). Два таймаута первой ступени за 10 минут — и следующие 10 минут
 * цепочка начинается со второй ступени; потом снова с первой. Счётчик в памяти процесса, без базы.
 */
export const BREAKER_WINDOW_MS = 10 * 60_000;
export const BREAKER_TIMEOUTS = 2;
export const BREAKER_OPEN_MS = 10 * 60_000;

export interface BreakerEvent {
  readonly state: 'open' | 'closed';
  readonly stage: string;
  readonly timeouts?: number;
  readonly until?: string;
}

function logBreaker(event: BreakerEvent): void {
  console.warn(JSON.stringify({ event: 'cover-letter-breaker', ...event }));
}

export class SlowStageBreaker {
  private timeouts: readonly number[] = [];
  private openUntil = 0;

  constructor(
    readonly stage: string,
    private readonly now: () => number = Date.now,
    private readonly log: (event: BreakerEvent) => void = logBreaker,
  ) {}

  recordFailure(failure: CoverLetterFailure): void {
    if (failure.stage !== this.stage || failure.kind !== 'timeout') return;
    const at = this.now();
    this.timeouts = [...this.timeouts.filter((time) => at - time < BREAKER_WINDOW_MS), at];
    if (this.openUntil > at || this.timeouts.length < BREAKER_TIMEOUTS) return;
    this.openUntil = at + BREAKER_OPEN_MS;
    this.log({
      state: 'open',
      stage: this.stage,
      timeouts: this.timeouts.length,
      until: new Date(this.openUntil).toISOString(),
    });
  }

  isOpen(): boolean {
    if (this.openUntil === 0) return false;
    if (this.now() < this.openUntil) return true;
    this.openUntil = 0;
    this.timeouts = [];
    this.log({ state: 'closed', stage: this.stage });
    return false;
  }

  /** Порядок ступеней: при открытом автомате медленная ступень меняется местами со следующей. */
  order(labels: readonly string[]): readonly number[] {
    const indices = labels.map((_label, index) => index);
    const slow = labels.indexOf(this.stage);
    if (slow < 0 || slow === labels.length - 1 || !this.isOpen()) return indices;
    return indices.map((index) => (index === slow ? slow + 1 : index === slow + 1 ? slow : index));
  }
}
