import { compareMatchedVacancies } from '../../../shared/vacancyMatchOrder';
import {
  countConfirmedApplications,
  countOpenedApplications,
  type VacancyApplication,
} from '../../../shared/vacancyApplication';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

/**
 * Кампания поиска: то, что продукт действительно знает о ходе поиска.
 *
 * Макет «Пульт» рисует пять плиток и воронку из пяти ступеней. Продукт сегодня
 * считает две из них — сколько записей подобрано и сколько откликов
 * подтвердил кандидат. Просмотры, ответы и интервью не отслеживаются ничем,
 * поэтому на их месте стоит «не отслеживается», а не ноль: ноль означал бы,
 * что мы посмотрели и не нашли (B179).
 */

const DAYS = 14;
const DAY_MS = 86_400_000;
/** Столько записей помещается в очередь на сегодня, не превращая её в пул. */
const QUEUE_SIZE = 8;

export interface CampaignTile {
  readonly id: 'fresh' | 'applications' | 'answers' | 'interviews';
  readonly label: string;
  /** `undefined` — величина не измеряется; плитка говорит это словами. */
  readonly value?: number;
  readonly note?: string;
}

export interface CampaignFunnelStep {
  readonly label: string;
  readonly value?: number;
}

export interface SearchCampaign {
  readonly poolTotal: number;
  readonly freshToday: number;
  readonly tiles: readonly CampaignTile[];
  readonly funnel: readonly CampaignFunnelStep[];
  readonly queue: readonly MatchedVacancyItem[];
  /** Сколько записей пришло в каждый из последних 14 дней. */
  readonly activity: readonly number[];
}

export interface SearchCampaignInput {
  readonly pool: readonly MatchedVacancyItem[];
  /** Команды кандидата: отклик засчитывается только подтверждённый. */
  readonly commands: ReadonlyArray<{ status: string }>;
  /**
   * Ручные отклики (B165, срез 1). Переход по ссылке стоит в ступени
   * «открыто» и откликом не считается: платформа не видит, что произошло на
   * площадке, и вместо кандидата этого не утверждает.
   */
  readonly applications?: readonly VacancyApplication[];
  readonly now: string;
}

const SENT_STATUSES = new Set(['queued', 'sent', 'executing', 'completed_with_receipt']);
const UNTRACKED = 'не отслеживается';

export function buildSearchCampaign({
  pool,
  commands,
  applications = [],
  now,
}: SearchCampaignInput): SearchCampaign {
  const today = dayKey(now);
  const freshToday = pool.filter(
    (entry) => dayKey(entry.cluster.firstObservedAt) === today,
  ).length;
  const opened = countOpenedApplications(applications);
  const applied =
    countConfirmedApplications(applications) +
    commands.filter((command) => SENT_STATUSES.has(command.status)).length;

  return {
    poolTotal: pool.length,
    freshToday,
    tiles: [
      { id: 'fresh', label: 'новых сегодня', value: freshToday },
      { id: 'applications', label: 'откликов', value: applied },
      { id: 'answers', label: 'ответы', note: UNTRACKED },
      { id: 'interviews', label: 'интервью', note: UNTRACKED },
    ],
    funnel: [
      { label: 'подобрано', value: pool.length },
      { label: 'открыто', value: opened },
      { label: 'отклик', value: applied },
      { label: 'просмотр' },
      { label: 'ответ' },
      { label: 'интервью' },
    ],
    queue: [...pool]
      .sort(compareMatchedVacancies)
      .slice(0, QUEUE_SIZE),
    activity: activityByDay(pool, now),
  };
}

function activityByDay(
  pool: readonly MatchedVacancyItem[],
  now: string,
): number[] {
  const end = Date.parse(now);
  const days = new Array<number>(DAYS).fill(0);
  if (Number.isNaN(end)) return days;

  for (const entry of pool) {
    const observed = Date.parse(entry.cluster.firstObservedAt ?? '');
    if (Number.isNaN(observed)) continue;
    const distance = Math.floor((dayStart(end) - dayStart(observed)) / DAY_MS);
    if (distance < 0 || distance >= DAYS) continue;
    days[DAYS - 1 - distance] += 1;
  }
  return days;
}

function dayStart(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

function dayKey(value?: string): string {
  return (value ?? '').slice(0, 10);
}
