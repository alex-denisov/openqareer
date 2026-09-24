import { apiFetch, readData } from '../coach/apiClient';

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
  readonly level: TodayRoleMatch | null;
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
  readonly kind: 'candidate_turn' | 'new_vacancy' | 'follow_up' | 'interview';
  readonly applicationId?: string;
  readonly clusterId?: string;
  readonly title: string;
  readonly company: string | null;
  readonly eyebrow: string | null;
  readonly dueAt: string | null;
  readonly salary?: TodaySalary;
  readonly location?: string;
  readonly fit: TodayFit | null;
}

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
  readonly closedVacancies: number;
  readonly interviewsAhead: number;
  readonly nextInterview: TodayNextInterview | null;
  readonly newVacanciesCaption: TodayNewVacanciesCaption | null;
  readonly followUpCaptions: readonly string[];
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
}

export interface TodaySnapshot {
  readonly digest: TodayDigest;
  readonly queue: readonly TodayQueueItem[];
  readonly followUps: readonly TodayFollowUp[];
  readonly sinceLastVisit: TodaySinceLastVisit;
  readonly vacanciesPending: boolean;
}

export async function recordCandidateVisit(): Promise<{ since: string | null }> {
  const response = await apiFetch('/api/v1/candidate/visits', { method: 'POST' });
  return readData<{ since: string | null }>(response);
}

export async function getTodaySnapshot(tz: string): Promise<TodaySnapshot> {
  const response = await apiFetch(`/api/v1/candidate/today?tz=${encodeURIComponent(tz)}`);
  return readData<TodaySnapshot>(response);
}
