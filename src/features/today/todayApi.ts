import type { TodayActionDeferral, TodayDecisionSelection } from '../../../shared/todayDecision';
import { apiFetch, readData } from '../coach/apiClient';
import type { VacancyLevelMatch } from '../../../shared/vacancyMatchOrder';

/**
 * Транспорт «Сегодня» (B251 S4b, architecture.md §57): `POST /visits`
 * отмечает заход и возвращает точку отсчёта «с прошлого визита», `GET
 * /today` — снимок дня относительно этой точки. Часовой пояс кандидата
 * определяет вызывающая сторона (`Intl`), а не сервер: он не знает, где
 * физически находится браузер.
 */

export interface TodaySalary {
  readonly from?: number;
  readonly to?: number;
  readonly currency?: string;
  readonly gross?: boolean;
}

export type TodayRoleMatch = 'target' | 'partial' | 'none';

export interface TodayFit {
  readonly role: TodayRoleMatch;
  readonly level: VacancyLevelMatch;
  readonly geo: boolean | null;
}

export interface TodayNewVacancy {
  readonly clusterId: string;
  readonly title: string;
  readonly company: string;
  readonly firstObservedAt: string;
  readonly lastSeenAt: string;
  readonly salary?: TodaySalary;
  readonly location?: string;
  readonly sourcesCount: number;
  readonly fit: TodayFit;
}

export interface TodayQueueItem {
  readonly kind:
    'candidate_turn' | 'new_vacancy' | 'shortlist' | 'follow_up' | 'interview' | 'linkedin_post';
  readonly material?: 'cover_letter';
  readonly draftId?: string;
  readonly applicationId?: string;
  readonly clusterId?: string;
  readonly title: string;
  readonly company: string | null;
  /** Рекрутер или собеседник из карточки отклика: напоминание называет человека. */
  readonly contactName?: string;
  /** Отклик уже прошёл интервью: напоминание просит итог, а не ответ. */
  readonly afterInterview?: boolean;
  readonly eyebrow: string | null;
  readonly dueAt: string | null;
  readonly salary?: TodaySalary;
  readonly location?: string;
  readonly fit: TodayFit | null;
}

export type TodayProfileFocus =
  | {
      readonly section:
        | 'name'
        | 'contacts'
        | 'education'
        | 'projects'
        | 'skills'
        | 'languages'
        | 'courses'
        | 'certifications'
        | 'recommendations'
        | 'achievements';
    }
  | {
      readonly section: 'experience';
      readonly experienceId?: string;
      readonly employer?: string;
      readonly title?: string;
      readonly field?: 'startDate' | 'endDate' | 'teamSize';
      readonly findingId?: string;
    };

export interface TodayNextInterview {
  readonly company: string | null;
  readonly title: string;
  readonly round: number;
  readonly at: string;
}

export interface TodayNewVacanciesCaption {
  readonly campaignRole: string | null;
  readonly sourcesCount: number;
  readonly updatedAt: string | null;
}

export interface TodayDigest {
  readonly waitingForYou: number;
  readonly newVacancies: number;
  readonly followUpsDueToday: number;
  readonly followUpsOverdue: number;
  readonly closedVacancies: number;
  readonly interviewsAhead: number;
  readonly nextInterview: TodayNextInterview | null;
  readonly newVacanciesCaption: TodayNewVacanciesCaption | null;
  readonly followUpCaptions: readonly string[];
  /** Отклики, которые ждут ответа компании больше 7 дней (B255). */
  readonly applicationsWaitingOver7Days?: number;
}

export type TodayFollowUpStatus = 'today' | 'overdue' | 'sent';

export interface TodayFollowUp {
  readonly applicationId: string;
  readonly company: string | null;
  readonly title: string;
  readonly status: TodayFollowUpStatus;
}

export interface TodaySinceLastVisit {
  readonly since: string | null;
  readonly items: readonly string[];
  readonly newVacanciesCount?: number;
  readonly applicationsWaitingOver7Days?: number;
  readonly nearestInterview?: TodayNextInterview | null;
}

export type MomentumMetricValue = number | 'unknown';

export interface MomentumMetrics {
  readonly applied: MomentumMetricValue;
  readonly views: MomentumMetricValue;
  readonly screenings: MomentumMetricValue;
  readonly interviews: MomentumMetricValue;
}

export type MomentumMetricSource =
  'application_events.recorded_at' | 'candidate_interview_schedules.scheduled_at' | 'unavailable';

export interface MomentumMetricEvidence {
  readonly source: MomentumMetricSource;
  readonly sampleSize: number;
  readonly unknownReason?: string;
}

export interface MomentumWindowEvidence {
  readonly startAt: string;
  readonly endAt: string;
  readonly applied: MomentumMetricEvidence;
  readonly views: MomentumMetricEvidence;
  readonly screenings: MomentumMetricEvidence;
  readonly interviews: MomentumMetricEvidence;
}

export interface SearchMomentum {
  readonly calculatedAt: string;
  readonly windows: {
    readonly '7d': MomentumMetrics;
    readonly '30d': MomentumMetrics;
  };
  readonly evidence: {
    readonly '7d': MomentumWindowEvidence;
    readonly '30d': MomentumWindowEvidence;
  };
  readonly burnoutNotice: boolean;
}

export function todayMomentumMetricValue(
  momentum: SearchMomentum | undefined,
  window: '7d' | '30d',
  metric: keyof MomentumMetrics,
): MomentumMetricValue {
  const windowEvidence = momentum?.evidence?.[window];
  const evidence = windowEvidence?.[metric];
  const value = momentum?.windows?.[window]?.[metric];
  const expectedDuration = window === '7d' ? 7 : 30;
  const startAt = Date.parse(windowEvidence?.startAt ?? '');
  const endAt = Date.parse(windowEvidence?.endAt ?? '');
  const validWindow =
    !Number.isNaN(startAt) &&
    !Number.isNaN(endAt) &&
    endAt - startAt === expectedDuration * 86_400_000 &&
    windowEvidence?.endAt === momentum?.calculatedAt;
  const expectedSource: MomentumMetricSource =
    metric === 'applied'
      ? 'application_events.recorded_at'
      : metric === 'interviews'
        ? 'candidate_interview_schedules.scheduled_at'
        : 'unavailable';

  if (
    !validWindow ||
    !evidence ||
    evidence.source !== expectedSource ||
    evidence.unknownReason ||
    !Number.isSafeInteger(evidence.sampleSize) ||
    evidence.sampleSize < 0 ||
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    evidence.sampleSize < value
  ) {
    return 'unknown';
  }
  return value;
}

export interface TodaySnapshot {
  /** Подключённые площадки (B534): заметка «LinkedIn не подключён» без запроса каталога. */
  readonly connectedSources?: readonly ('linkedin' | 'hh')[];
  readonly todayDecisionSelection?: TodayDecisionSelection;
  readonly todayActionDeferral?: TodayActionDeferral;
  readonly digest: TodayDigest;
  readonly queue: readonly TodayQueueItem[];
  readonly queueTotal?: number;
  readonly queueRevision?: string;
  readonly queueOffset?: number;
  readonly followUps: readonly TodayFollowUp[];
  readonly sinceLastVisit: TodaySinceLastVisit;
  readonly vacanciesPending: boolean;
  readonly momentum?: SearchMomentum;
  readonly funnel?: TodayFunnelCounts;
  /** B540: server-born «Подтвердите размер команды» (`todayTeamSizeDecision.ts`). */
  readonly teamSizeDecision?: TodayTeamSizeDecision;
}

export interface TodayTeamSizeDecision {
  readonly kind: 'team_size';
  readonly experienceId: string;
  readonly employer: string;
  readonly title?: string;
  readonly favoritesTotal: number;
  readonly favoritesAsking: number;
  readonly minTeamSize: number;
  readonly readAt: string;
}

/** Этапы воронки из стадий откликов (сервер, `computeTodayFunnel`). */
export interface TodayFunnelCounts {
  readonly favorites: number;
  /** Старый сервер не присылает: тогда этап из `momentum`. */
  readonly applied?: number;
  readonly responses: number;
  readonly interviews?: number;
  readonly offers: number;
}

export interface TodayQueueRemainder {
  readonly queue: readonly TodayQueueItem[];
  readonly queueTotal: number;
  readonly queueRevision: string;
  readonly queueOffset: number;
}

export const TODAY_DECISION_CHANGED = 'openqareer:today-decision-changed';

export async function selectTodayDecision(
  applicationId: string,
  resolution: 'accepted' | 'dismissed',
): Promise<TodayDecisionSelection> {
  const response = await apiFetch('/api/v1/candidate/today/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationId, resolution }),
  });
  const selection = await readData<TodayDecisionSelection>(response);
  window.dispatchEvent(new Event(TODAY_DECISION_CHANGED));
  return selection;
}

export async function deferTodayAction(actionId: string, tz: string): Promise<TodayActionDeferral> {
  const response = await apiFetch('/api/v1/candidate/today/action-defer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId, tz }),
  });
  const deferral = await readData<TodayActionDeferral>(response);
  window.dispatchEvent(new Event(TODAY_DECISION_CHANGED));
  return deferral;
}

export async function getTodayQueueRemainder(
  tz: string,
  offset: number,
  revision: string,
  signal?: AbortSignal,
): Promise<TodayQueueRemainder> {
  const response = await apiFetch(
    `/api/v1/candidate/today?tz=${encodeURIComponent(tz)}&queueOffset=${offset}&queueRevision=${encodeURIComponent(revision)}`,
    { signal },
  );
  return readData<TodayQueueRemainder>(response);
}

export async function recordCandidateVisit(
  signal?: AbortSignal,
): Promise<{ since: string | null }> {
  const response = await apiFetch('/api/v1/candidate/visits', { method: 'POST', signal });
  return readData<{ since: string | null }>(response);
}

export async function getTodaySnapshot(tz: string, signal?: AbortSignal): Promise<TodaySnapshot> {
  const response = await apiFetch(`/api/v1/candidate/today?tz=${encodeURIComponent(tz)}`, {
    signal,
  });
  return readData<TodaySnapshot>(response);
}
