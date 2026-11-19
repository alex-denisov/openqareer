/**
 * B679: разбор отказов. Догадка «вероятно, не хватило» строится только из требования
 * вакансии и сверки с подтверждёнными фактами профиля; своё мнение кандидат отмечает сам.
 */

export const REJECTION_REASONS = ['level', 'experience', 'money', 'no_answer', 'other'] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABELS: Readonly<Record<RejectionReason, string>> = {
  level: 'Уровень',
  experience: 'Опыт',
  money: 'Деньги',
  no_answer: 'Не ответили',
  other: 'Другое',
};

/** Меньше стольких отправленных откликов — выводов не делаем (порог сводки воронки). */
export const REJECTION_REVIEW_MIN_SAMPLE = 20;
export const REJECTION_NOTE_MAX_LENGTH = 2000;
/** Сколько отказов разбираем за один ответ: свежие первыми. */
export const REJECTION_REVIEW_LIMIT = 20;

export interface RejectionGuess {
  /** Требование словами вакансии, коротко. */
  readonly requirement: string;
  /** Цитата из текста вакансии. */
  readonly quote: string;
  /**
   * Подтверждённый факт профиля, который закрывает требование частично.
   * `null` — сверка не нашла подтверждения (это не значит, что опыта нет).
   */
  readonly profileFact: string | null;
}

export interface RejectionCandidateReason {
  readonly reason: RejectionReason;
  readonly note: string | null;
  readonly recordedAt: string;
}

export interface RejectionReviewItem {
  readonly applicationId: string;
  readonly title: string;
  readonly company: string | null;
  readonly rejectedAt: string;
  readonly guess: RejectionGuess | null;
  readonly candidateReason: RejectionCandidateReason | null;
}

export type RejectionRecommendationKind =
  /** Факт в профиле есть, но требование закрыто не полностью: показать его в резюме. */
  | 'show_in_resume'
  /** Подтверждения в профиле не нашлось: выбирать вакансии без такого требования. */
  | 'match_vacancies'
  /** Мало данных: сначала обновить статусы откликов без ответа. */
  | 'update_statuses';

export interface RejectionRecommendation {
  readonly kind: RejectionRecommendationKind;
  /** Требование, на котором стоит рекомендация; у `update_statuses` — `null`. */
  readonly requirement: string | null;
  readonly profileFact: string | null;
  /** Во скольких отказах встретилось и сколько отказов разобрано всего. */
  readonly count: number;
  readonly total: number;
}

export interface RejectionCheckCount {
  readonly count: number;
  readonly total: number;
}

/** B645: проверки экрана «Мало данных», которым порог не нужен. */
export interface RejectionReviewChecks {
  /** Первый отправленный отклик (ISO); `null` — дат отправки нет. */
  readonly since: string | null;
  /** Отклики без ответа: статус стоит обновить. */
  readonly unfinished: RejectionCheckCount;
  /** Вакансии, где верх вилки ниже ожиданий кандидата; `null` — ожиданий в профиле нет. */
  readonly salaryBelow:
    (RejectionCheckCount & { readonly floor: number; readonly currency: string }) | null;
  /** Отклики позже 10 дней после публикации вакансии. */
  readonly late: RejectionCheckCount;
}

export interface RejectionReview {
  /** `low_data` — откликов меньше порога: отказы показываем, выводов и рекомендаций нет. */
  readonly state: 'low_data' | 'ready';
  readonly sentCount: number;
  readonly threshold: number;
  readonly rejectedCount: number;
  readonly rejections: readonly RejectionReviewItem[];
  readonly firstStep: RejectionRecommendation | null;
  readonly recommendations: readonly RejectionRecommendation[];
  /** Ответ на «Разбор помог?»; `null` — ещё не отвечали. */
  readonly helped: boolean | null;
  /** B645: только при `low_data`. */
  readonly checks?: RejectionReviewChecks;
}
