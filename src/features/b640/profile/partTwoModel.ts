import type { ResumeDraft } from '../../resume/resumeTypes';

const unanswered = (entry: ResumeDraft['experience'][number]): boolean =>
  !entry.teamSize && !entry.teamSizeDeclined;

export interface ProfileQuestion {
  readonly entryId: string;
  readonly employer: string;
  readonly text: string;
}

/**
 * Один вопрос о профиле: размер команды у первого места работы, где он не
 * указан и кандидат не отказался его указывать. Отдельного списка вопросов на сервере нет — вопрос выводим из профиля.
 */
export function nextQuestion(draft: ResumeDraft): ProfileQuestion | null {
  const entry = draft.experience.find(unanswered);
  if (!entry) return null;
  const employer = entry.employer?.trim() ?? '';
  const place = employer
    ? `в «${employer}»`
    : `на месте «${entry.title?.trim() || 'без названия'}»`;
  return { entryId: entry.id, employer, text: `Сколько человек было в команде ${place}?` };
}

/** Сколько вопросов о профиле осталось: по месту работы без размера команды. */
export function questionCount(draft: ResumeDraft): number {
  return draft.experience.filter(unanswered).length;
}

const MAX_TEAM_SIZE = 100_000;

/** Размер команды из ответа; `null` — ответ не число. */
export function teamAnswer(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/u.test(value)) return null;
  const size = Number(value);
  return size >= 1 && size <= MAX_TEAM_SIZE ? size : null;
}
