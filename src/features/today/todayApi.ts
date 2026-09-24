import { apiFetch, readData } from '../coach/apiClient';

/**
 * Транспорт «Сегодня» (B251 S5, architecture.md §57): `POST /visits`
 * отмечает заход и возвращает точку отсчёта «с прошлого визита», `GET
 * /today` — снимок дня относительно этой точки. Часовой пояс кандидата
 * определяет вызывающая сторона (`Intl`), а не сервер: он не знает, где
 * физически находится браузер.
 */

export interface TodayNewVacancy {
  readonly clusterId: string;
  readonly title: string;
  readonly company: string;
  readonly firstObservedAt: string;
}

export interface TodayQueueItem {
  readonly kind: 'candidate_turn' | 'new_vacancy';
  readonly applicationId?: string;
  readonly clusterId?: string;
  readonly title: string;
  readonly dueAt: string | null;
}

export interface TodayDigest {
  readonly waitingForYou: number;
  readonly newVacancies: number;
  readonly closedVacancies: number;
}

export interface TodaySnapshot {
  readonly digest: TodayDigest;
  readonly queue: readonly TodayQueueItem[];
  readonly sinceLastVisit: string | null;
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
