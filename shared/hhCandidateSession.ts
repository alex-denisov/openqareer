/**
 * B704: сессия кандидата hh.ru в приложении. Кандидат входит в hh.ru сам, в окне площадки
 * внутри настольного приложения; список резюме и содержимое выбранного читаются в этом окне.
 * Отклик от имени кандидата уходит только после его подтверждения и в пределах дневного лимита.
 */

export const HH_RESUMES_MAX = 20;
export const HH_RESUME_TITLE_MAX_LENGTH = 300;
export const HH_RESUME_TEXT_MAX_LENGTH = 40_000;

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
  readonly readAt: string;
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
