/**
 * B621: темп и паузы гостевых запросов LinkedIn.
 *
 * Один исполнитель, интервал между LinkedIn-запросами не меньше `minGapMs`.
 * 429/999 или проверка браузера ставят общую паузу (10 мин, затем вдвое до
 * 6 ч) в таблице статусов; строка уходит в `retry_after` до конца паузы и
 * повторяется — не пропускается.
 */
import {
  LinkedinThrottled,
  resolveCompany,
  type FetchPage,
  type PageKind,
} from './linkedinOrgResolver';
import type { LinkedinOrgStore, ResolutionOutcome } from './linkedinOrgStore';
import type { LinkedinGuestBudget } from '../../vacancies/linkedinGuestBudget';

export interface RunnerLog {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

export interface RunnerOptions {
  readonly store: LinkedinOrgStore;
  readonly fetchPage: FetchPage;
  readonly log: RunnerLog;
  readonly minGapMs?: number;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Общий бюджет гостевого LinkedIn процесса (B622); без него — свой интервал. */
  readonly budget?: LinkedinGuestBudget;
}

export const DEFAULT_MIN_GAP_MS = 20_000;
export const BASE_COOLDOWN_MS = 10 * 60_000;
export const MAX_COOLDOWN_MS = 6 * 60 * 60_000;
export const STRIKE_DECAY_MS = 60 * 60_000;

export type StepResult =
  | { readonly kind: 'idle' }
  | { readonly kind: 'cooldown'; readonly until: Date }
  | { readonly kind: 'done'; readonly companyKey: string; readonly outcome: ResolutionOutcome };

export function cooldownMs(strikes: number): number {
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** Math.max(0, strikes - 1));
}

export class LinkedinOrgRunner {
  private lastLinkedinAt = 0;
  private pausedByBudget = false;
  private readonly minGapMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: RunnerOptions) {
    this.minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private readonly pacedFetch: FetchPage = async (url: string, kind: PageKind) => {
    if (kind === 'linkedin' && this.options.budget) {
      try {
        await this.options.budget.acquire('resolver');
      } catch {
        this.pausedByBudget = true;
        throw new LinkedinThrottled('rate_limited', url);
      }
    } else if (kind === 'linkedin') {
      const wait = this.lastLinkedinAt + this.minGapMs - this.now().getTime();
      if (wait > 0) await this.sleep(wait);
      this.lastLinkedinAt = this.now().getTime();
    }
    return this.options.fetchPage(url, kind);
  };

  /** Одна строка очереди или ничего, если идёт пауза / очередь пуста. */
  async step(): Promise<StepResult> {
    const { store, log } = this.options;
    const now = this.now();
    const cooldown = store.cooldownUntil();
    if (cooldown && cooldown.until > now) return { kind: 'cooldown', until: cooldown.until };
    const row = store.nextDue(now);
    this.pausedByBudget = false;
    if (!row) return { kind: 'idle' };
    try {
      const outcome = await resolveCompany(row, this.pacedFetch, now);
      store.record(row.companyKey, outcome, this.now());
      // Страйки гаснут, только если после паузы час прошёл без нового 429:
      // иначе повторный 429 сразу после паузы снова дал бы 10 минут.
      if (
        cooldown &&
        cooldown.strikes > 0 &&
        now.getTime() - cooldown.until.getTime() > STRIKE_DECAY_MS
      )
        store.setCooldown(this.now(), 0, 'recovered', this.now());
      return { kind: 'done', companyKey: row.companyKey, outcome };
    } catch (error: unknown) {
      if (!(error instanceof LinkedinThrottled)) throw error;
      // Свой 429 резолвера ставит паузу и каналам с гостевым поиском (B622).
      if (!this.pausedByBudget) this.options.budget?.markRateLimited();
      this.pausedByBudget = false;
      const strikes = (cooldown?.strikes ?? 0) + 1;
      const until = new Date(this.now().getTime() + cooldownMs(strikes));
      store.setCooldown(until, strikes, error.kind, this.now());
      const outcome: ResolutionOutcome = {
        status: 'retry_after',
        reason: `linkedin_${error.kind}`,
        retryAt: until.toISOString(),
      };
      store.record(row.companyKey, outcome, this.now());
      log.warn(
        { companyKey: row.companyKey, kind: error.kind, strikes, until: until.toISOString() },
        'linkedin-org-cooldown',
      );
      return { kind: 'cooldown', until };
    }
  }
}
