/**
 * B704: сессия кандидата hh.ru в приложении. Кандидат входит в hh.ru сам, в окне площадки
 * внутри настольного приложения; список резюме и содержимое выбранного читаются в этом окне.
 * Отклик от имени кандидата уходит только после его подтверждения и в пределах дневного лимита.
 */

export const HH_RESUMES_MAX = 20;
export const HH_RESUME_TITLE_MAX_LENGTH = 300;
export const HH_RESUME_TEXT_MAX_LENGTH = 40_000;
/** B678: для сверки хватает начала резюме; так снимок с пятью резюме укладывается в предел тела запроса. */
export const HH_REVIEW_TEXT_MAX_LENGTH = 8_000;
/** B678: сколько резюме сверяется за одно открытие листа — страницы hh.ru читаются по одной. */
export const HH_REVIEW_RESUMES_MAX = 5;

/** Идентификатор резюме hh.ru — из ссылки карточки резюме. */
export const HH_RESUME_ID = /^[A-Za-z0-9]{1,64}$/u;
/** Номер вакансии hh.ru из адреса `hh.ru/vacancy/<номер>`. */
export const HH_VACANCY_ID = /^[1-9][0-9]{0,14}$/u;

export interface HhResumeSummary {
  readonly id: string;
  readonly title: string;
  /** «обновлено 3 ноября», как пишет hh.ru. */
  readonly updatedLabel?: string;
}

/** Содержимое резюме так, как его показывает hh.ru: заголовок и текст страницы. */
export interface HhResumeContent {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

export interface HhResumeSnapshot {
  readonly resumes: readonly HhResumeSummary[];
  /** Резюме, которым кандидат откликается. */
  readonly selected: HhResumeContent | null;
  /** B678: прочитанное содержимое остальных резюме списка — для сверки с вакансией. */
  readonly contents?: readonly HhResumeContent[];
  readonly readAt: string;
}

export type HhResumeFitStatus = 'fits' | 'gaps' | 'unread';

/** B678: сверка одного резюме hh.ru с требованиями вакансии. */
export interface HhResumeFit {
  readonly resumeId: string;
  readonly title: string;
  /** «подходит» — есть все требования, «не хватает» — есть пропуски, «unread» — содержимое не читали. */
  readonly status: HhResumeFitStatus;
  readonly matched: readonly string[];
  readonly missing: readonly string[];
}

export interface HhResumeReview {
  readonly requirements: readonly string[];
  readonly resumes: readonly HhResumeFit[];
  /** Резюме, которое лучше подходит вакансии; `null` — ни одно не прочитано. */
  readonly recommendedId: string | null;
}

export const HH_APPLY_OUTCOMES = ['sent', 'questionnaire', 'failed'] as const;
export type HhApplyOutcome = (typeof HH_APPLY_OUTCOMES)[number];

export interface HhApplyAttempt {
  readonly attemptId: string;
  /** Сколько откликов через hh.ru ещё можно отправить сегодня, считая этот. */
  readonly remainingToday: number;
}

/** Номер вакансии из её адреса на hh.ru; не hh.ru — `null`. */
export function hhVacancyIdFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'hh.ru' && !host.endsWith('.hh.ru')) return null;
    const match = /^\/vacancy\/([0-9]+)\/?$/u.exec(url.pathname);
    return match && HH_VACANCY_ID.test(match[1]!) ? match[1]! : null;
  } catch {
    return null;
  }
}
