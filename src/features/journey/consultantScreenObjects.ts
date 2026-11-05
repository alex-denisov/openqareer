import { CoachApiError } from '../coach/apiClient';
import type { ConsultantThread } from '../coach/candidateSnapshotApi';
import type { CoachTurnSubject } from '../coach/coachApi';
import type { ConsultantScreenObject } from './consultantScreenTopic';

const SCREEN_DRAFT_MAX_CHARS = 8_000;

export const LETTER_OBJECT_INTRO =
  'Вижу письмо и эту вакансию. Подскажу, какой результат поставить и чего не хватает.';
export const VACANCY_OBJECT_INTRO =
  'Сравню требования этой вакансии с вашим опытом и скажу, где пробелы.';

const LETTER_PROMPTS = [
  'Письмо суховато, добавь результат.',
  'Какой результат поставить первым?',
  'Что убрать из письма?',
] as const;

/** Макет 9: экран письма занят одной вакансией, консультант говорит о ней и о тексте. */
export function letterScreenObject(vacancyId: string): ConsultantScreenObject {
  return {
    id: `letter:${vacancyId}`,
    stages: ['vacancies'],
    subject: { kind: 'vacancy', id: vacancyId },
    fillsScreen: true,
    sendsLetterDraft: true,
    intro: LETTER_OBJECT_INTRO,
    prompts: LETTER_PROMPTS,
    placeholder: 'Что поправить в письме',
  };
}

export function vacancyScreenObject(vacancyId: string): ConsultantScreenObject {
  return {
    id: `vacancy:${vacancyId}`,
    stages: ['vacancies'],
    subject: { kind: 'vacancy', id: vacancyId },
    intro: VACANCY_OBJECT_INTRO,
  };
}

/** Выбранный отклик: вступление остаётся у вкладки, ход идёт об этом отклике. */
export function applicationScreenObject(applicationId: string): ConsultantScreenObject {
  return {
    id: `application:${applicationId}`,
    stages: ['responses'],
    subject: { kind: 'application', id: applicationId },
  };
}

/** Свой разговор есть у компании и у вакансии; остальные объекты живут в ленте этапа. */
export function consultantThread(subject: CoachTurnSubject | undefined): ConsultantThread | undefined {
  return subject?.kind === 'company' || subject?.kind === 'vacancy'
    ? { kind: subject.kind, id: subject.id }
    : undefined;
}

export interface ScreenTurn {
  readonly subject: CoachTurnSubject | undefined;
  readonly fromScreen: boolean;
  readonly screenDraft?: string;
}

/**
 * Явное «Обсудить» важнее открытой строки: кандидат спросил о другой вакансии. Письмо
 * занимает весь экран, поэтому старый объект панели здесь уже неверен.
 */
export function screenTurnFor(
  subject: CoachTurnSubject | undefined,
  object: ConsultantScreenObject | null,
  letterDraft: string,
): ScreenTurn {
  if (!object || (subject && !object.fillsScreen)) return { subject, fromScreen: false };
  const draft = object.sendsLetterDraft ? letterDraft.slice(0, SCREEN_DRAFT_MAX_CHARS) : '';
  return {
    subject: object.subject,
    fromScreen: true,
    ...(draft.trim() ? { screenDraft: draft } : {}),
  };
}

/**
 * Объект экрана кандидат не выбирал: вакансия могла уйти из пула, и ошибка «Объект не
 * найден» на обычный вопрос была бы непонятна. Такой ход повторяется без него.
 */
export async function sendScreenAwareTurn<Input extends object, Result>(
  send: (input: Input & { subject?: CoachTurnSubject; screenDraft?: string }) => Promise<Result>,
  input: Input,
  panelSubject: CoachTurnSubject | undefined,
  turn: ScreenTurn,
): Promise<Result> {
  const { subject, screenDraft } = turn;
  try {
    return await send({ ...input, subject, ...(screenDraft ? { screenDraft } : {}) });
  } catch (error) {
    if (!turn.fromScreen || !(error instanceof CoachApiError) || error.code !== 'subject_not_found') {
      throw error;
    }
    return send({ ...input, subject: panelSubject });
  }
}
