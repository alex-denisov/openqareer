import { z } from 'zod';

/**
 * d01: шаги плана адаптации из поля «Что от вас ждут». Модель раскладывает
 * обязанности по 30/60/90 дням; каждый шаг обязан ссылаться на номер строки поля.
 * Ответ без ссылки, с выдуманной строкой или короче трёх шагов не принимается —
 * тогда план собирается из шаблона.
 */
export const EXPECTATION_LINES_MAX = 8;
export const ADAPTATION_STEPS_MIN = 3;
export const ADAPTATION_STEPS_MAX = 12;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 1000;

export const ADAPTATION_STEP_STAGES = ['days_1_30', 'days_31_60', 'days_61_90'] as const;
export const ADAPTATION_STEP_CATEGORIES = ['people', 'strategy', 'delivery', 'alignment'] as const;

const rawStepSchema = z.object({
  line: z.number().int(),
  title: z.string().trim().min(1),
  description: z.string().trim(),
  stage: z.enum(ADAPTATION_STEP_STAGES),
  category: z.enum(ADAPTATION_STEP_CATEGORIES),
});

export interface AdaptationStep {
  readonly title: string;
  readonly description: string;
  readonly stage: (typeof ADAPTATION_STEP_STAGES)[number];
  readonly category: (typeof ADAPTATION_STEP_CATEGORIES)[number];
  /** Строка поля, из которой шаг следует. */
  readonly basis: string;
}

const BULLET = /^\s*(?:[•·\-–—*]+|\d{1,2}[.)])\s*/u;
const key = (value: string) => value.trim().toLocaleLowerCase('ru-RU');

/** Обязанности из поля: по строке, без маркеров, повторов и пустых, не больше восьми. */
export function expectationLines(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.replace(BULLET, '').trim();
    if (!line || seen.has(key(line))) continue;
    seen.add(key(line));
    lines.push(line);
  }
  return lines.slice(0, EXPECTATION_LINES_MAX);
}

/** Проверка ответа модели: только шаги со ссылкой на настоящую строку; меньше трёх — null. */
export function acceptAdaptationSteps(answer: unknown, lines: readonly string[]): AdaptationStep[] | null {
  const list = z.object({ steps: z.array(z.unknown()) }).safeParse(answer);
  if (!list.success) return null;
  const seen = new Set<string>();
  const steps: AdaptationStep[] = [];
  for (const item of list.data.steps) {
    const parsed = rawStepSchema.safeParse(item);
    if (!parsed.success) continue;
    const { line, title, description, stage, category } = parsed.data;
    const basis = lines[line - 1];
    if (!basis || seen.has(key(title))) continue;
    seen.add(key(title));
    steps.push({
      title: title.slice(0, TITLE_MAX),
      description: description.slice(0, DESCRIPTION_MAX),
      stage,
      category,
      basis,
    });
  }
  return steps.length >= ADAPTATION_STEPS_MIN ? steps.slice(0, ADAPTATION_STEPS_MAX) : null;
}
