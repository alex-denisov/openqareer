import {
  CORE_API,
  DOMAINS,
  FAMILIES,
  type RoleFamily,
  type TaskSpec,
  type VacancyDomain,
} from './systemDesignTaskSpecs';

/**
 * B681: задача System Design под вакансию без модели. Сначала предметная область по
 * описанию вакансии из отклика (B635), затем семья роли по её названию (B750), и только
 * если нет ни того, ни другого — общий «Основной API продукта». Технологии — до трёх,
 * названных в тексте. Модель (B750) строит задачу раньше этих правил: `systemDesignTaskModel`.
 */

export const SYSTEM_DESIGN_TIME_LIMIT_MINUTES = 45;

export type SystemDesignDomain = VacancyDomain | RoleFamily | 'core_api';

export interface SystemDesignTaskInput {
  readonly vacancyTitle: string;
  readonly company?: string;
  readonly description?: string;
}

export interface SystemDesignTask {
  /** Короткое название задачи для заголовка экрана: что проектируем. */
  readonly title: string;
  readonly prompt: string;
  /** «Что важно в задаче» (I3a): четыре пункта, как в макете. */
  readonly points: readonly string[];
  readonly hint: string;
  readonly timeLimitMinutes: number;
  readonly exampleAnswer: string;
  readonly basis: 'vacancy' | 'role';
  readonly domain: SystemDesignDomain;
  readonly stack: readonly string[];
  /** `model` — задачу написала модель по вакансии; `rules` — шаблон. */
  readonly origin: 'model' | 'rules';
}

const STACK_TERMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Kubernetes', /\b(?:kubernetes|k8s)\b/i],
  ['Kafka', /\bkafka\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['Redis', /\bredis\b/i],
  ['ClickHouse', /\bclickhouse\b/i],
  ['Go', /\b(?:Go|Golang|golang)\b/],
  ['Java', /\bjava\b(?!script)/i],
  ['Python', /\bpython\b/i],
  ['RabbitMQ', /\brabbitmq\b/i],
  ['MongoDB', /\bmongo(?:db)?\b/i],
  ['Elasticsearch', /\belasticsearch\b/i],
  ['gRPC', /\bgrpc\b/i],
];

const word = (body: string) => new RegExp(`(?<![\\p{L}\\d])(?:${body})(?![\\p{L}\\d])`, 'iu');

/** Семья роли по названию; порядок важен: «Data Scientist» — ML, а не данные. */
const FAMILY_PATTERNS: ReadonlyArray<readonly [RoleFamily, RegExp]> = [
  [
    'ml_genai',
    word(
      'ml|ai|genai|gen ai|llm|nlp|mlops|machine learning|data scien\\p{L}*|ии|машинн\\p{L}*|нейросет\\p{L}*|computer vision',
    ),
  ],
  ['data', word('data|dwh|bi|etl|данных|big data')],
  [
    'frontend',
    word('front\\p{L}*|фронт\\p{L}*|react|vue|angular|ios|android|mobile|мобильн\\p{L}*|flutter'),
  ],
  [
    'infra',
    word(
      'devops|sre|platform|платформ\\p{L}*|инфраструктур\\p{L}*|kubernetes|cloud|облачн\\p{L}*|site reliability',
    ),
  ],
  [
    'management',
    word(
      'cto|cio|vp|head|руководител\\p{L}*|директор\\p{L}*|lead|тимлид|manager|architect|архитектор',
    ),
  ],
  [
    'backend',
    word(
      'backend|back-end|бэкенд|бекенд|developer|разработчик|engineer|инженер|программист|go|golang|java|python|php|node\\.js|\\.net',
    ),
  ],
];

export function roleFamily(title: string): RoleFamily | null {
  return FAMILY_PATTERNS.find(([, pattern]) => pattern.test(title))?.[0] ?? null;
}

function detectDomain(text: string): VacancyDomain | null {
  const lower = text.toLocaleLowerCase('ru-RU');
  let best: { id: VacancyDomain; hits: number } | null = null;
  for (const [id, spec] of Object.entries(DOMAINS) as Array<
    [VacancyDomain, (typeof DOMAINS)[VacancyDomain]]
  >) {
    const hits = spec.keywords.reduce((sum, keyword) => sum + lower.split(keyword).length - 1, 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { id, hits };
  }
  return best?.id ?? null;
}

/** До трёх технологий в порядке появления в тексте. */
export function detectStack(text: string): string[] {
  return STACK_TERMS.map(([name, pattern]) => ({ name, at: text.search(pattern) }))
    .filter((term) => term.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
    .map((term) => term.name);
}

function exampleAnswerFor(spec: TaskSpec): string {
  return [
    `Требования: ${spec.requirements}; нагрузка и SLO по задержке фиксирую до выбора решения.`,
    `Компоненты: ${spec.components}.`,
    `Компромисс: ${spec.tradeoff}.`,
    `Эксплуатация: мониторинг, метрики и алерты на ошибки; ${spec.operations}.`,
  ].join(' ');
}

interface SpecPick {
  readonly id: SystemDesignDomain;
  readonly spec: TaskSpec;
  readonly basis: SystemDesignTask['basis'];
}

function pickSpec(input: SystemDesignTaskInput, description: string): SpecPick {
  const domain = description ? detectDomain(description) : null;
  if (domain) return { id: domain, spec: DOMAINS[domain], basis: 'vacancy' };
  const family = roleFamily(input.vacancyTitle);
  if (family) return { id: family, spec: FAMILIES[family], basis: 'role' };
  return { id: 'core_api', spec: CORE_API, basis: 'role' };
}

/** Условие из шаблона или из ответа модели: один вид текста, образец ответа по критериям разбора. */
export function taskFromSpec(
  input: SystemDesignTaskInput,
  spec: TaskSpec,
  meta: Pick<SystemDesignTask, 'basis' | 'domain' | 'origin'>,
): SystemDesignTask {
  const description = input.description?.trim() ?? '';
  const stack = description ? detectStack(description) : [];
  const company = input.company?.trim() ? ` в «${input.company.trim()}»` : '';
  const stackLine = stack.length ? ` Используйте стек из вакансии: ${stack.join(', ')}.` : '';
  return {
    title: spec.title,
    prompt: `Спроектируйте ${spec.service} для «${input.vacancyTitle}»${company}: ${spec.scope}.${stackLine} Начните с требований и ограничений.`,
    points: [...spec.points],
    hint: `Начните с вопросов о нагрузке: ${spec.requirements}.`,
    timeLimitMinutes: SYSTEM_DESIGN_TIME_LIMIT_MINUTES,
    exampleAnswer: exampleAnswerFor(spec),
    stack,
    ...meta,
  };
}

/** Тема задачи для журнала и шаблона: область вакансии, иначе семья роли, иначе общая. */
export function taskTopic(input: SystemDesignTaskInput): SystemDesignDomain {
  const description = input.description?.trim() ?? '';
  return (
    (description ? detectDomain(description) : null) ?? roleFamily(input.vacancyTitle) ?? 'core_api'
  );
}

export function buildSystemDesignTask(input: SystemDesignTaskInput): SystemDesignTask {
  const { id, spec, basis } = pickSpec(input, input.description?.trim() ?? '');
  return taskFromSpec(input, spec, { basis, domain: id, origin: 'rules' });
}
