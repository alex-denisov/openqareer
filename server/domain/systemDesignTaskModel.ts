import { z } from 'zod';
import {
  taskFromSpec,
  taskTopic,
  type SystemDesignTask,
  type SystemDesignTaskInput,
} from './systemDesignTask';
import type { TaskSpec } from './systemDesignTaskSpecs';

/**
 * B750: задачу System Design пишет модель по вакансии — названию, тексту и требованиям,
 * уже извлечённым из него. Ответ строго по схеме; не прошёл проверку — шаблон по области
 * вакансии или семье роли (`buildSystemDesignTask`). Данных кандидата во входе нет.
 */
export const SYSTEM_DESIGN_TASK_PROMPT_VERSION = 1;

const DESCRIPTION_CHARS = 4000;
const REQUIREMENTS_MAX = 12;
const REQUIREMENT_CHARS = 200;
const POINTS = 4;

export interface SystemDesignModelInput extends SystemDesignTaskInput {
  /** Требования из текста вакансии (B510), если уже извлечены. */
  readonly requirements?: readonly string[];
}

export const SYSTEM_DESIGN_TASK_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'service',
    'scope',
    'points',
    'requirements',
    'components',
    'tradeoff',
    'operations',
  ],
  properties: {
    title: { type: 'string' },
    service: { type: 'string' },
    scope: { type: 'string' },
    points: { type: 'array', minItems: POINTS, maxItems: POINTS, items: { type: 'string' } },
    requirements: { type: 'string' },
    components: { type: 'string' },
    tradeoff: { type: 'string' },
    operations: { type: 'string' },
  },
} as const;

export function systemDesignTaskInstructions(): string {
  return [
    'Ты — интервьюер на техническом собеседовании. Составь одну задачу System Design на 45 минут под эту вакансию.',
    'Задача о системе, которую кандидат строил бы в этой роли и этой компании: возьми предметную область, нагрузку и технологии из текста вакансии и её требований.',
    'Не давай общих задач вроде «основной API продукта», «URL-сокращатель» или «чат», если вакансия не о них.',
    'Всё по-русски, без markdown. Поля:',
    '- title — заголовок задачи, до 70 знаков, с цифрой нагрузки, если она уместна («Приём платежей на 2 000 в секунду»);',
    '- service — что спроектировать, винительный падеж с маленькой буквы, до 90 знаков («сервис приёма платежей»);',
    '- scope — что система делает, одна фраза до 200 знаков, без точки в конце;',
    '- points — ровно 4 коротких пункта «что важно в задаче», каждый до 80 знаков, без точки в конце, разные по смыслу;',
    '- requirements, components, tradeoff, operations — тезисы сильного ответа: требования и нагрузка, компоненты, один компромисс с причиной, эксплуатация (мониторинг, отказы, откат); каждое до 240 знаков.',
  ].join('\n');
}

export function systemDesignTaskUserMessage(input: SystemDesignModelInput): string {
  const requirements = (input.requirements ?? [])
    .map((text) => text.trim().slice(0, REQUIREMENT_CHARS))
    .filter(Boolean)
    .slice(0, REQUIREMENTS_MAX);
  return [
    `Вакансия: ${input.vacancyTitle.trim()}`,
    input.company?.trim() ? `Компания: ${input.company.trim()}` : null,
    requirements.length
      ? `Требования:\n${requirements.map((text) => `- ${text}`).join('\n')}`
      : null,
    input.description?.trim()
      ? `Текст вакансии:\n${input.description.trim().slice(0, DESCRIPTION_CHARS)}`
      : 'Текста вакансии нет: опирайся на название роли.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const CYRILLIC = /[а-яё]/iu;
const GENERIC_TITLE = /основн\p{L}* api/iu;

const text = (max: number) =>
  z
    .string()
    .transform((value) =>
      value
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/[.;]+$/u, ''),
    )
    .pipe(z.string().min(3).max(max).regex(CYRILLIC));

const modelSchema = z.object({
  title: text(70),
  service: text(90),
  scope: text(200),
  points: z.array(text(80)).length(POINTS),
  requirements: text(240),
  components: text(240),
  tradeoff: text(240),
  operations: text(240),
});

/** «Сервис платежей» → «сервис платежей»; аббревиатуры («API заказов») не трогаем. */
function lowerFirst(value: string): string {
  return /^\p{Lu}\p{Ll}/u.test(value)
    ? value.charAt(0).toLocaleLowerCase('ru-RU') + value.slice(1)
    : value;
}

/** `null` — ответ не по схеме: не четыре пункта, не по-русски, повторы или общая задача. */
export function parseSystemDesignTask(
  raw: unknown,
  input: SystemDesignModelInput,
): SystemDesignTask | null {
  const parsed = modelSchema.safeParse(raw);
  if (!parsed.success) return null;
  const answer = parsed.data;
  const distinct = new Set(answer.points.map((point) => point.toLocaleLowerCase('ru-RU')));
  if (distinct.size !== POINTS || GENERIC_TITLE.test(answer.title)) return null;
  const spec: TaskSpec = {
    ...answer,
    service: lowerFirst(answer.service),
    points: [answer.points[0]!, answer.points[1]!, answer.points[2]!, answer.points[3]!],
  };
  return taskFromSpec(input, spec, {
    basis: input.description?.trim() ? 'vacancy' : 'role',
    domain: taskTopic(input),
    origin: 'model',
  });
}
