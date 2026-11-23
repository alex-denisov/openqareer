import { z } from 'zod';

/**
 * B744: две подсказки формы цели «Дневника».
 * - d02c «Целей нет» — три примера целей под роль кандидата, словами, без чисел (п. 54 макета).
 * - d02b «Новая цель» — значение «Сейчас» для показателя из записей кандидата, с цитатой.
 * Модели верим только в том, что можно проверить: пример без цифр, цитата дословно в той
 * записи, на которую модель сослалась. Остальное отсекается здесь.
 */
export const GOAL_HINTS_PROMPT_REVISION = 'goal-hints-v1';
export const GOAL_ROLE_MAX = 120;
export const GOAL_INDICATOR_MAX = 240;
const EXAMPLES = 3;
const EXAMPLE_TITLE_MAX = 70;
const EXAMPLE_MEASURE_MAX = 60;
const QUOTE_MAX = 200;

export interface GoalExample {
  readonly title: string;
  readonly measure: string;
}

export interface BaselineEntry {
  readonly id: string;
  readonly date: string;
  readonly text: string;
}

export interface GoalBaseline {
  readonly value: number;
  readonly quote: string;
  /** `ГГГГ-ММ-ДД` записи, из которой взята цитата. */
  readonly entryDate: string;
}

export const GOAL_EXAMPLES_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['examples'],
  properties: {
    examples: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'measure'],
        properties: { title: { type: 'string' }, measure: { type: 'string' } },
      },
    },
  },
} as const;

export const GOAL_BASELINE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'entryId', 'quote'],
  properties: {
    value: { type: ['number', 'null'] },
    entryId: { type: ['string', 'null'] },
    quote: { type: ['string', 'null'] },
  },
} as const;

export function goalExamplesInstructions(): string {
  return [
    'Ты карьерный консультант. Кандидат вышел на новую работу и ставит цели на первый квартал.',
    `Дай ровно ${EXAMPLES} типичные цели для его роли: как их обычно ставит руководитель.`,
    `title — цель глаголом, по-русски, до ${EXAMPLE_TITLE_MAX} символов. measure — чем её меряют, со строчной, до ${EXAMPLE_MEASURE_MAX} символов.`,
    'Без цифр, процентов с числами, сроков в числах и названий компаний: это пример формы, а не план.',
    'Цели разные по смыслу и подходят именно этой роли, а не любой.',
  ].join('\n');
}

export const goalExamplesUserMessage = (role: string): string => `Роль: ${role}`;

export function goalBaselineInstructions(): string {
  return [
    'Кандидат ставит цель и вписывает показатель. Найди в его записях дневника текущее значение этого показателя.',
    'value — одно число в единицах показателя (переведи «полтора дня» в часы, если показатель в часах).',
    'entryId — id записи, где это сказано. quote — дословный кусок этой записи, из которого видно значение, до 200 символов.',
    'Если в записях нет значения именно этого показателя — все три поля null. Не угадывай и не считай средних.',
  ].join('\n');
}

export function goalBaselineUserMessage(
  indicator: string,
  entries: readonly BaselineEntry[],
): string {
  const lines = entries.map((entry) => `[${entry.id}] ${entry.date}: ${entry.text}`);
  return [`Показатель: ${indicator}`, 'Записи:', ...lines].join('\n');
}

const examplesSchema = z.object({
  examples: z.array(z.object({ title: z.string(), measure: z.string() })),
});

const clean = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** Три примера без цифр и повторов; иначе — `null`, экран покажет общие примеры. */
export function parseGoalExamples(raw: unknown): readonly GoalExample[] | null {
  const parsed = examplesSchema.safeParse(raw);
  if (!parsed.success) return null;
  const items = parsed.data.examples
    .map((item) => ({ title: clean(item.title), measure: clean(item.measure) }))
    .filter(
      (item) =>
        item.title !== '' &&
        item.measure !== '' &&
        item.title.length <= EXAMPLE_TITLE_MAX &&
        item.measure.length <= EXAMPLE_MEASURE_MAX &&
        !/\d/u.test(`${item.title} ${item.measure}`),
    );
  const unique = items.filter(
    (item, index) =>
      items.findIndex((other) => other.title.toLowerCase() === item.title.toLowerCase()) === index,
  );
  return unique.length >= EXAMPLES ? unique.slice(0, EXAMPLES) : null;
}

const baselineSchema = z.object({
  value: z.number().finite().nullable(),
  entryId: z.string().nullable(),
  quote: z.string().nullable(),
});

const comparable = (text: string): string =>
  clean(text)
    .toLowerCase()
    .replace(/[«»"„“”]/gu, '');

/**
 * Значение из записей: только если цитата дословно стоит в названной записи. Модель сослалась
 * на запись, которой нет, или пересказала её — значения нет: кандидату не показываем выдумку.
 */
export function groundBaseline(
  raw: unknown,
  entries: readonly BaselineEntry[],
): GoalBaseline | null {
  const parsed = baselineSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { value, entryId, quote } = parsed.data;
  if (value === null || entryId === null || quote === null) return null;
  const entry = entries.find((item) => item.id === entryId);
  const cited = clean(quote).replace(/^[«"]+|[»"]+$/gu, '');
  if (!entry || cited === '' || cited.length > QUOTE_MAX) return null;
  if (!comparable(entry.text).includes(comparable(cited))) return null;
  return { value, quote: cited, entryDate: entry.date };
}
