/**
 * B674: контракт трёх читающих маршрутов раздела «Вакансии» кабинета B640.
 * Строка вакансии (`cluster` + `explanation`) — тот же вид, что у подборки.
 */
export const B640_SORT_KEYS = ['fit', 'money', 'role', 'company', 'location', 'format', 'date'] as const;
export type B640SortKey = (typeof B640_SORT_KEYS)[number];
export const B640_SORT_DIRECTIONS = ['desc', 'asc'] as const;
export type B640SortDirection = (typeof B640_SORT_DIRECTIONS)[number];

export const B640_PAGE_LIMIT_MAX = 50;
export const B640_PAGE_LIMIT_DEFAULT = 20;

/** Когда и почему кандидат скрыл вакансию (`at` — ISO). */
export interface B640HiddenInfo {
  readonly reasonId: string;
  readonly at: string;
}

/** `GET /api/v1/candidate/b640/hidden-vacancies`: `data` — строки подборки плюс `hidden`. */
export interface B640HiddenMeta {
  readonly requestId: string;
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
}

/** `GET /api/v1/candidate/b640/application-quota`: `data`. */
export interface B640ApplicationQuota {
  readonly plan: 'free' | 'basic' | 'pro' | 'max' | null;
  /** `null` — лимита нет (биллинг выключен или аккаунт без квот). */
  readonly limit: number | null;
  readonly used: number;
  readonly remaining: number | null;
  /** Начало следующего периода квоты, ISO; `null`, если периода нет. */
  readonly renewsAt: string | null;
}

/** B675: `POST /api/v1/candidate/b640/vacancy-triage` — разбор списка по правилам, без модели. */
export const VACANCY_TRIAGE_MAX_IDS = 1000;
export const VACANCY_TRIAGE_QUESTION_IDS = ['salaryLowerBound'] as const;
export type VacancyTriageQuestionId = (typeof VACANCY_TRIAGE_QUESTION_IDS)[number];
export type VacancyTriageAnswers = Readonly<Partial<Record<VacancyTriageQuestionId, boolean>>>;

export interface VacancyTriageRow {
  readonly clusterId: string;
  readonly verdict: 'keep' | 'hide' | 'needs_data';
  /** Только у hide: с этой причиной строка скрывается. */
  readonly reasonId?: string;
  /** Только у hide: короткая подпись причины. */
  readonly reasonLabel?: string;
  /** Только у needs_data. */
  readonly questionId?: VacancyTriageQuestionId;
}

export interface VacancyTriageQuestion {
  readonly id: VacancyTriageQuestionId;
  readonly text: string;
}

export interface VacancyTriage {
  readonly rows: readonly VacancyTriageRow[];
  /** Только вопросы без ответа, в порядке показа. */
  readonly questions: readonly VacancyTriageQuestion[];
  /** Сколько вопросов у списка всего (с ответом и без). */
  readonly questionTotal: number;
  readonly summary: {
    readonly total: number;
    readonly keep: number;
    readonly hide: number;
    readonly needsData: number;
  };
}
