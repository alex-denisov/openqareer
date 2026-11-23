/**
 * B665: статус кандидата. Пять статусов и контракт маршрутов
 * `/api/v1/candidate/status…`. Статус меняет только сам кандидат.
 */
export const CANDIDATE_STATUSES = [
  'looking',
  'job_search',
  'choosing_role',
  'changing_profession',
  'working',
] as const;

export type CandidateStatusId = (typeof CANDIDATE_STATUSES)[number];

/** Пока кандидат ничего не выбрал, кабинет ведёт себя как при «Ищу работу». */
export const DEFAULT_CANDIDATE_STATUS: CandidateStatusId = 'job_search';

export const TARGET_PROFESSION_MAX_LENGTH = 80;

export interface CandidateStatusOption {
  readonly id: CandidateStatusId;
  readonly label: string;
  readonly caption: string;
}

export const CANDIDATE_STATUS_OPTIONS: readonly CandidateStatusOption[] = [
  { id: 'looking', label: 'Присматриваюсь', caption: 'Работаю, смотрю предложения без спешки' },
  { id: 'job_search', label: 'Ищу работу', caption: 'В своей роли, активно' },
  {
    id: 'choosing_role',
    label: 'Ищу, кем работать',
    caption: 'Не знаю, какая роль мне подходит, или ищу первую работу',
  },
  { id: 'changing_profession', label: 'Меняю профессию', caption: 'Хочу перейти в другую профессию' },
  {
    id: 'working',
    label: 'Работаю',
    caption: 'Осваиваюсь на новом месте, расту, меняю роль внутри компании',
  },
];

export function isCandidateStatusId(value: unknown): value is CandidateStatusId {
  return typeof value === 'string' && (CANDIDATE_STATUSES as readonly string[]).includes(value);
}

export function candidateStatusLabel(status: CandidateStatusId): string {
  return CANDIDATE_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

/** «Меняю профессию: продакт-менеджер» — статус вместе с названной профессией. */
export function candidateStatusTitle(
  status: CandidateStatusId,
  targetProfession: string | null,
): string {
  const label = candidateStatusLabel(status);
  return status === 'changing_profession' && targetProfession
    ? `${label}: ${targetProfession}`
    : label;
}

export interface CandidateStatusCurrent {
  readonly status: CandidateStatusId;
  readonly label: string;
  readonly title: string;
  readonly targetProfession: string | null;
  /** Когда кандидат выбрал статус; `null`, пока он не выбирал. */
  readonly since: string | null;
  readonly chosen: boolean;
}

export interface CandidateStatusHistoryItem {
  readonly id: string;
  readonly status: CandidateStatusId;
  readonly title: string;
  readonly since: string;
}

/** Есть, пока смену можно отменить: до конца дня, в который её сделали. */
export interface CandidateStatusRevert {
  readonly changeId: string;
  readonly previousStatus: CandidateStatusId;
  readonly previousTitle: string;
  readonly until: string;
}

export interface CandidateStatusState {
  readonly current: CandidateStatusCurrent;
  readonly statuses: readonly CandidateStatusOption[];
  readonly history: readonly CandidateStatusHistoryItem[];
  readonly revert: CandidateStatusRevert | null;
}

export const STATUS_CHANGE_OPTION_KEYS = ['pauseAutoApply', 'weeklySelection'] as const;
export type StatusChangeOptionKey = (typeof STATUS_CHANGE_OPTION_KEYS)[number];

/** Переключатель «Что можно поменять»: без отметки кандидата ничего не выключается. */
export interface StatusChangeOption {
  readonly key: StatusChangeOptionKey;
  readonly label: string;
  /** Отметка стоит заранее только при переходе в «Работаю». */
  readonly checked: boolean;
}

export interface CandidateStatusPreview {
  readonly from: CandidateStatusId;
  readonly to: CandidateStatusId;
  readonly title: string;
  /** Тот же статус и та же профессия: менять нечего. */
  readonly unchanged: boolean;
  readonly appears: readonly string[];
  readonly leaves: readonly string[];
  readonly stays: readonly string[];
  readonly options: readonly StatusChangeOption[];
}

export const TODAY_STATUS_MODULE_KEYS = [
  'weekly_vacancies',
  'next_action',
  'role_options',
  'role_vacancies',
  'profession_fit',
  'profession_reason',
  'profile_question',
  'applications_summary',
  'onboarding_plan',
  'next_meeting',
  'record_result',
] as const;
export type TodayStatusModuleKey = (typeof TODAY_STATUS_MODULE_KEYS)[number];

export interface TodayStatusModule {
  readonly key: TodayStatusModuleKey;
  readonly title: string;
}

export interface CandidateStatusToday {
  readonly status: CandidateStatusId;
  readonly title: string;
  readonly chosen: boolean;
  /** Когда кандидат выбрал статус; `null`, пока он не выбирал (B691). */
  readonly since: string | null;
  /** Модули по порядку: первый — главное на «Сегодня» при этом статусе. */
  readonly modules: readonly TodayStatusModule[];
  readonly revert: CandidateStatusRevert | null;
}
