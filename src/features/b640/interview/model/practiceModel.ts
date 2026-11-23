import { pluralRu } from '../../../../../shared/pluralRu';
import { scoreInterviewAnswerWithQuotes } from '../../../../../server/domain/interviewAnswerReview';
import {
  extractSystemDesignSchema,
  type SchemaNodeKind,
  type SystemDesignSchema,
} from '../../../../../server/domain/systemDesignSchema';

/** I3: тренировка System Design — задача, ответ со схемой и критериями, разбор. */

export type PracticeChoice = 'start' | 'resume' | 'review' | 'other';

const CRITERIA = [
  ['requirements', 'Требования'],
  ['architecture', 'Архитектура'],
  ['tradeoffs', 'Компромиссы'],
  ['operations', 'Эксплуатация'],
] as const;

const QUOTE_SHOWN = 120;

/** Задача с сервера пригодна для показа: заголовок, условие, пункты и время. */
export function isShownTask(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  const text = (field: unknown) => typeof field === 'string' && field.trim() !== '';
  return (
    text(task.title) &&
    text(task.prompt) &&
    Array.isArray(task.points) &&
    task.points.length > 0 &&
    task.points.every(text) &&
    typeof task.timeLimitMinutes === 'number' &&
    task.timeLimitMinutes > 0
  );
}

/** Пункты «Что важно в задаче»: свои у задачи (B750), у старой — предложения условия. */
export function shownPoints(task: {
  readonly prompt: string;
  readonly points?: readonly string[];
}): string[] {
  return task.points?.length ? [...task.points] : taskPoints(task.prompt);
}

/** Условие задачи по предложениям: это пункты «Что важно в задаче». */
export function taskPoints(prompt: string): string[] {
  return (prompt.match(/[^.!?]+[.!?]?/gu) ?? []).map((part) => part.trim()).filter(Boolean);
}

/**
 * Незаконченная тренировка System Design этого отклика продолжается, законченная
 * с ответом открывает разбор; любую другую незаконченную сначала надо закончить.
 */
export function practiceChoice(
  current: {
    readonly status: string;
    readonly applicationId: string | null;
    readonly questionTypes: readonly string[];
    readonly questions: readonly { readonly answer?: unknown }[];
  } | null,
  responseId: string,
): PracticeChoice {
  if (!current) return 'start';
  const own =
    current.applicationId === responseId && current.questionTypes.includes('system_design');
  const over = current.status === 'completed' || current.status === 'interrupted';
  if (over) return own && current.questions[0]?.answer ? 'review' : 'start';
  return own ? 'resume' : 'other';
}

/** Сколько целых минут осталось от начала тренировки. */
/** «1 минута», «3 минуты», «33 минуты», «45 минут». */
export function minutesLabel(minutes: number): string {
  return pluralRu(minutes, ['минута', 'минуты', 'минут']);
}

export function minutesLeft(startedAt: string, limitMinutes: number, now: number): number {
  const spent = (now - Date.parse(startedAt)) / 60_000;
  // Часы сервера впереди часов браузера дают «46 из 45»: больше лимита не показываем.
  return Math.min(limitMinutes, Math.max(0, Math.ceil(limitMinutes - spent - 1e-9)));
}

export interface LiveCriterion {
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly tag: 'прозвучало' | 'не звучало';
  readonly ok: boolean;
}

function shortQuote(quote: string): string {
  return quote.length > QUOTE_SHOWN ? `${quote.slice(0, QUOTE_SHOWN - 1).trimEnd()}…` : quote;
}

/** Критерии по мере ответа: те же правила, что у разбора, без модели. */
export function liveCriteria(answer: string): LiveCriterion[] {
  const criteria = answer.trim()
    ? scoreInterviewAnswerWithQuotes(answer, 'system_design').criteria
    : {};
  return CRITERIA.map(([key, title]) => {
    const criterion = criteria[key] as { points: number; quote?: string } | undefined;
    const sounded = Boolean(criterion && criterion.points > 0);
    return {
      key,
      title,
      sub: sounded && criterion?.quote ? shortQuote(criterion.quote) : 'Пока не звучало',
      tag: sounded ? 'прозвучало' : 'не звучало',
      ok: sounded,
    };
  });
}

/* ---------- Схема по ответу и правки кандидата ---------- */

export interface SchemaBlock {
  readonly id: string;
  readonly label: string;
}

export type SchemaEdit =
  | { readonly op: 'rename'; readonly id: string; readonly label: string }
  | { readonly op: 'move'; readonly id: string; readonly by: -1 | 1 }
  | { readonly op: 'remove'; readonly id: string }
  | { readonly op: 'add'; readonly id: string; readonly label: string };

export const renameBlock = (id: string, label: string): SchemaEdit => ({ op: 'rename', id, label });
export const moveBlock = (id: string, by: -1 | 1): SchemaEdit => ({ op: 'move', id, by });
export const removeBlock = (id: string): SchemaEdit => ({ op: 'remove', id });

let added = 0;
/** Новый блок: id без знаков вне `[a-z0-9_-]`, как требует сервер. */
export function addBlock(label: string): SchemaEdit {
  added += 1;
  return { op: 'add', id: `own-${Date.now().toString(36)}-${added}`, label };
}

function applyEdit(blocks: readonly SchemaBlock[], edit: SchemaEdit): SchemaBlock[] {
  const index = blocks.findIndex((block) => block.id === edit.id);
  if (edit.op === 'add')
    return index < 0 ? [...blocks, { id: edit.id, label: edit.label }] : [...blocks];
  if (index < 0) return [...blocks];
  if (edit.op === 'rename') {
    return blocks.map((block) => (block.id === edit.id ? { ...block, label: edit.label } : block));
  }
  if (edit.op === 'remove') return blocks.filter((block) => block.id !== edit.id);
  const target = index + edit.by;
  if (target < 0 || target >= blocks.length) return [...blocks];
  const next = [...blocks];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Блоки схемы: из ответа, затем правки кандидата по порядку. */
export function schemaBlocks(answer: string, edits: readonly SchemaEdit[]): SchemaBlock[] {
  const fromAnswer = (extractSystemDesignSchema(answer)?.nodes ?? []).map(({ id, label }) => ({
    id,
    label,
  }));
  return edits.reduce<SchemaBlock[]>(applyEdit, fromAnswer);
}

export interface SchemaToSave {
  readonly nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: SchemaNodeKind;
  }[];
  readonly links: readonly {
    readonly from: string;
    readonly to: string;
    readonly label?: string;
  }[];
}

/** Схема целиком для сервера: блоки в порядке кандидата, связи из ответа между оставшимися. */
export function schemaToSave(answer: string, blocks: readonly SchemaBlock[]): SchemaToSave {
  const extracted: SystemDesignSchema | null = extractSystemDesignSchema(answer);
  const kindOf = new Map(extracted?.nodes.map((node) => [node.id, node.kind]) ?? []);
  const ids = new Set(blocks.map((block) => block.id));
  return {
    nodes: blocks.map((block) => ({ ...block, kind: kindOf.get(block.id) ?? 'service' })),
    links: (extracted?.links ?? [])
      .filter((link) => ids.has(link.from) && ids.has(link.to))
      .map(({ from, to, label }) => (label ? { from, to, label } : { from, to })),
  };
}

/* ---------- Разбор ---------- */

export interface ReviewEvaluation {
  readonly criteria: Readonly<
    Record<string, { readonly points: 0 | 1 | 2; readonly reason: string; readonly quote?: string }>
  >;
}

export interface ReviewRow {
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly quote: string | null;
  readonly tag: 'прозвучало' | 'частично' | 'не хватило';
  readonly ok: boolean;
}

const REVIEW_TAG = ['не хватило', 'частично', 'прозвучало'] as const;

export function reviewRows(evaluation: ReviewEvaluation): ReviewRow[] {
  return CRITERIA.flatMap(([key, title]) => {
    const criterion = evaluation.criteria[key];
    if (!criterion) return [];
    return [
      {
        key,
        title,
        sub: criterion.reason,
        quote: criterion.quote ? `Из ответа: «${shortQuote(criterion.quote)}»` : null,
        tag: REVIEW_TAG[criterion.points],
        ok: criterion.points === 2,
      },
    ];
  });
}

const COUNT_WORDS = ['ни один', 'один', 'два', 'три', 'четыре'] as const;

function closedWord(count: number): string {
  return `${COUNT_WORDS[count] ?? count} ${count === 1 ? 'закрыт' : 'закрыты'}`;
}

/** «Четыре критерия: два закрыты, два — не полностью». */
export function reviewTitle(evaluation: ReviewEvaluation): string {
  const rows = reviewRows(evaluation);
  const closed = rows.filter((row) => row.ok).length;
  const open = rows.length - closed;
  const head = `${rows.length === 4 ? 'Четыре критерия' : `Критериев: ${rows.length}`}`;
  if (open === 0) return `${head}: все закрыты`;
  if (closed === 0) return `${head}: все — не полностью`;
  return `${head}: ${closedWord(closed)}, ${COUNT_WORDS[open] ?? open} — не полностью`;
}

const BLOCK_WORDS = [
  '',
  'Один',
  'Два',
  'Три',
  'Четыре',
  'Пять',
  'Шесть',
  'Семь',
  'Восемь',
  'Девять',
  'Десять',
];

function blockNoun(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return 'блоков';
  if (ones === 1) return 'блок';
  return ones >= 2 && ones <= 4 ? 'блока' : 'блоков';
}

/** «Пять блоков» над схемой разбора. */
export function blockCountTitle(count: number): string {
  const word = BLOCK_WORDS[count];
  return `${word || count} ${blockNoun(count)}`;
}
