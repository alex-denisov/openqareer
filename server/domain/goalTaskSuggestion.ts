import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * B743 · 2: одна подсказка следующей задачи по цели в карточке цели (d02a). Модель читает только
 * данные самой цели кандидата и предлагает формулировку и срок; всё, что нельзя проверить по
 * этим данным (дубль задачи, дубль пропущенной подсказки, срок вне периода цели), отсекается здесь.
 */
export const GOAL_TASK_SUGGESTION_PROMPT_REVISION = 'goal-task-suggestion-v1';
export const GOAL_TASK_TEXT_MAX = 90;
/** Срок по умолчанию, когда модель его не назвала или назвала неверно: через неделю, но не позже цели. */
const DEFAULT_DUE_DAYS = 7;
const DAY_MS = 86_400_000;

type Value = number | boolean | string;

/** Всё, что модель знает о цели. По нему считается хеш: изменилось — подсказка спрашивается заново. */
export interface GoalSuggestionContext {
  readonly goal: {
    readonly title: string;
    readonly startDate: string;
    readonly dueDate: string;
    readonly risk: string;
    readonly indicators: ReadonlyArray<{
      readonly title: string;
      readonly unit: string;
      readonly target: Value;
      readonly latest: Value | null;
    }>;
  };
  readonly measurements: ReadonlyArray<{
    readonly date: string;
    readonly value: Value;
    readonly comment: string | null;
  }>;
  readonly tasks: ReadonlyArray<{
    readonly title: string;
    readonly dueDate: string;
    readonly completed: boolean;
  }>;
  readonly entries: ReadonlyArray<{ readonly date: string; readonly text: string }>;
}

export interface GoalTaskSuggestionInput {
  readonly today: string;
  readonly context: GoalSuggestionContext;
  /** Тексты пропущенных кандидатом подсказок этой цели: их не повторяем. */
  readonly skipped: readonly string[];
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const answerSchema = z.object({
  task: z.string().nullable(),
  dueDate: dateSchema.nullable().catch(null),
});

export type GoalTaskModelAnswer = z.infer<typeof answerSchema>;

export const GOAL_TASK_JSON_SCHEMA = {
  type: 'object',
  required: ['task', 'dueDate'],
  properties: {
    task: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] },
  },
} as const;

export function goalTaskSuggestionInstructions(today: string): string {
  return [
    `Ты помогаешь человеку довести его рабочую цель до результата. Сегодня ${today}.`,
    'По данным цели предложи ОДНУ следующую конкретную задачу, которая приближает цель.',
    `Формулировка: действие в инфинитиве («Подготовить…», «Согласовать…»), одной строкой, не длиннее ${GOAL_TASK_TEXT_MAX} знаков, без кавычек и точки в конце.`,
    'Не повторяй задачи из списка tasks и тексты из skipped, даже другими словами.',
    'Опирайся только на данные цели: ничего не придумывай, не называй имена, которых в данных нет.',
    `dueDate — дата ГГГГ-ММ-ДД не раньше сегодняшней и не позже срока цели; если разумного срока нет — null.`,
    'Если полезной задачи нет, верни task null.',
    'Не упоминай модели, ИИ и сам запрос.',
  ].join('\n');
}

export function goalTaskUserMessage(input: GoalTaskSuggestionInput): string {
  return `Данные цели:\n<<<\n${JSON.stringify({ ...input.context, skipped: input.skipped })}\n>>>`;
}

/** Ответ модели по схеме; `null` — не объект или не та форма. */
export function parseGoalTaskAnswer(raw: unknown): GoalTaskModelAnswer | null {
  const parsed = answerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Хеш входа: по нему узнаём, что данные цели не менялись и модель спрашивать не нужно. */
export function goalContextHash(context: GoalSuggestionContext): string {
  return createHash('sha256').update(JSON.stringify(context)).digest('hex');
}

/** Нижний регистр, «ё» как «е», без знаков препинания, пробелы схлопнуты. */
export function normalizeTaskText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const MIN_CONTAINED_CHARS = 12;

function sameTask(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_CONTAINED_CHARS && long.includes(short);
}

function realDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export interface GroundedSuggestion {
  readonly text: string;
  readonly dueDate: string | null;
}

/**
 * Ответ модели после проверки; `null` — подсказки нет. Срок вне периода цели отбрасывается,
 * задача остаётся.
 */
export function groundSuggestion(
  answer: GoalTaskModelAnswer,
  input: GoalTaskSuggestionInput,
): GroundedSuggestion | null {
  const text = (answer.task ?? '').replace(/\s+/gu, ' ').trim().replace(/\.$/u, '').trim();
  if (text === '' || text.length > GOAL_TASK_TEXT_MAX) return null;
  const key = normalizeTaskText(text);
  const known = [...input.context.tasks.map((task) => task.title), ...input.skipped];
  if (known.some((other) => sameTask(key, normalizeTaskText(other)))) return null;
  const due = answer.dueDate;
  const fits =
    due !== null && realDate(due) && due >= input.today && due <= input.context.goal.dueDate;
  return { text, dueDate: fits ? due : null };
}

/** Срок, который увидит кандидат: названный моделью или через неделю, но не позже цели и не в прошлом. */
export function suggestionDueDate(
  dueDate: string | null,
  today: string,
  goalDueDate: string,
): string {
  if (dueDate) return dueDate;
  const week = new Date(Date.parse(`${today}T00:00:00.000Z`) + DEFAULT_DUE_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const capped = week < goalDueDate ? week : goalDueDate;
  return capped < today ? today : capped;
}
