/**
 * Правки кандидата в подготовке STAR и их сохранение на отклик (B392).
 * Движок подготовки отдаёт только то, что есть в подтверждённых фактах;
 * пробелы остаются пробелами, пока кандидат сам не заполнит поле.
 */
import type { StarAnswer, StarQuestion } from './interviewPrepEngine';

export type StarField = keyof StarAnswer;

const STAR_FIELDS: readonly StarField[] = ['situation', 'task', 'action', 'result'];

/** Начала заготовок, которыми движок помечает поле без подтверждённых данных. */
const GAP_MARKERS: readonly string[] = [
  'Контекст ситуации в подтверждённых данных не зафиксирован',
  'Задача и критерии успеха в подтверждённых данных не зафиксированы',
  'Действия кандидата в профиле не зафиксированы',
  'Результат в подтверждённых данных не зафиксирован',
  'Результат этого действия в профиле не зафиксирован',
];

export interface StarPrepDraft {
  readonly applicationId: string;
  readonly edits: Readonly<Record<string, Partial<Record<StarField, string>>>>;
}

export interface StarQuestionWithGaps extends StarQuestion {
  readonly unresolved: readonly StarField[];
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (applicationId: string): string => `oq-star-prep:${applicationId}`;

export function isGapText(text: string): boolean {
  return GAP_MARKERS.some((marker) => text.startsWith(marker));
}

export function gapFields(question: StarQuestion): readonly StarField[] {
  return STAR_FIELDS.filter((field) => isGapText(question.starAnswer[field]));
}

export function emptyStarPrepDraft(applicationId: string): StarPrepDraft {
  return { applicationId, edits: {} };
}

export function editStarField(
  draft: StarPrepDraft,
  questionId: string,
  field: StarField,
  text: string,
): StarPrepDraft {
  const { [field]: _removed, ...rest } = draft.edits[questionId] ?? {};
  const trimmed = text.trim();
  const questionEdits = trimmed ? { ...rest, [field]: trimmed } : rest;
  const { [questionId]: _old, ...otherQuestions } = draft.edits;
  const edits =
    Object.keys(questionEdits).length > 0
      ? { ...otherQuestions, [questionId]: questionEdits }
      : otherQuestions;
  return { ...draft, edits };
}

export function withBriefGaps(
  questions: readonly StarQuestion[],
  draft: StarPrepDraft,
): readonly StarQuestionWithGaps[] {
  return questions.map((question) => {
    const edited = draft.edits[question.id] ?? {};
    const starAnswer: StarAnswer = { ...question.starAnswer, ...edited };
    const unresolved = STAR_FIELDS.filter((field) => isGapText(starAnswer[field]));
    return { ...question, starAnswer, unresolved };
  });
}

export function loadStarPrepDraft(applicationId: string, storage: DraftStorage): StarPrepDraft {
  try {
    const raw = storage.getItem(storageKey(applicationId));
    if (!raw) return emptyStarPrepDraft(applicationId);
    const parsed = JSON.parse(raw) as Partial<StarPrepDraft>;
    if (
      parsed.applicationId !== applicationId ||
      typeof parsed.edits !== 'object' ||
      !parsed.edits
    ) {
      return emptyStarPrepDraft(applicationId);
    }
    return { applicationId, edits: parsed.edits };
  } catch {
    return emptyStarPrepDraft(applicationId);
  }
}

export function saveStarPrepDraft(draft: StarPrepDraft, storage: DraftStorage): void {
  try {
    storage.setItem(storageKey(draft.applicationId), JSON.stringify(draft));
  } catch {
    // Хранилище может быть закрыто (приватное окно): подготовка живёт до закрытия вкладки.
  }
}
