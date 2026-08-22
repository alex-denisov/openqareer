export const EVIDENCE_METHOD_VERSION = 'evidence-local-v1';
export const ROLE_METHOD_VERSION = 'role-hypotheses-local-v1';

type EvidenceKind =
  | 'result'
  | 'responsibility'
  | 'scope'
  | 'expertise';
type EvidenceStatus = 'pending' | 'confirmed' | 'rejected';

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  sourceExcerpt: string;
  statement: string;
  status: EvidenceStatus;
  userEdited: boolean;
}

export interface EvidenceExtraction {
  methodVersion: typeof EVIDENCE_METHOD_VERSION;
  items: EvidenceItem[];
  questions: string[];
}

export type RoleFitState = 'plausible' | 'adjacent' | 'needs-evidence';

export interface RoleHypothesis {
  id: string;
  title: string;
  fitState: RoleFitState;
  basis: string;
  evidenceIds: string[];
  gaps: string[];
}

export interface CandidateAnalysis {
  evidenceMethodVersion: typeof EVIDENCE_METHOD_VERSION;
  roleMethodVersion: typeof ROLE_METHOD_VERSION;
  evidenceItems: EvidenceItem[];
  questions: string[];
  roleHypotheses: RoleHypothesis[];
  reviewedAt?: string;
}

interface RoleFamily {
  id: string;
  signals: string[];
  alternatives: string[];
}

const RESULT_SIGNALS = [
  /\d/u,
  /увелич|сократ|сниз|рост|выруч|эконом|запуст|достиг|improv|increas|reduc|grew|launched/iu,
];
const SCOPE_SIGNALS =
  /команд|бюджет|p&l|подчин|регион|стра[нны]|портфел|people|team|budget|global|country/iu;
const RESPONSIBILITY_SIGNALS =
  /управля|отвечал|руковод|созда|разработ|внедр|проводил|формировал|координировал|managed|owned|led|built|developed|implemented|responsible/iu;

const ROLE_FAMILIES: RoleFamily[] = [
  {
    id: 'product',
    signals: [
      'продукт',
      'product',
      'roadmap',
      'discovery',
      'исследован',
      'метрик',
    ],
    alternatives: [
      'Product Lead / Lead Product Manager',
      'Product Operations Lead',
    ],
  },
  {
    id: 'technology',
    signals: [
      'технолог',
      'разработ',
      'engineering',
      'software',
      'архитект',
      'cto',
      'tech lead',
    ],
    alternatives: ['Engineering Manager', 'Technology Lead'],
  },
  {
    id: 'operations',
    signals: [
      'операц',
      'operations',
      'процесс',
      'delivery',
      'program',
      'проект',
    ],
    alternatives: ['Руководитель операций', 'Program Manager'],
  },
  {
    id: 'analytics',
    signals: [
      'аналит',
      'data',
      'bi ',
      'sql',
      'модел',
      'research',
      'исследован',
    ],
    alternatives: ['Analytics Lead', 'Руководитель бизнес-аналитики'],
  },
  {
    id: 'marketing',
    signals: [
      'маркет',
      'marketing',
      'бренд',
      'brand',
      'growth',
      'контент',
    ],
    alternatives: ['Marketing Lead', 'Growth Lead'],
  },
  {
    id: 'sales',
    signals: [
      'продаж',
      'sales',
      'клиент',
      'account',
      'business development',
      'партнер',
    ],
    alternatives: ['Sales Lead', 'Business Development Lead'],
  },
  {
    id: 'finance',
    signals: [
      'финанс',
      'finance',
      'бюджет',
      'p&l',
      'fp&a',
      'контроллинг',
    ],
    alternatives: ['Finance Lead', 'FP&A Lead'],
  },
  {
    id: 'people',
    signals: [
      'hr',
      'people',
      'персонал',
      'талант',
      'talent',
      'найм',
      'обучен',
    ],
    alternatives: ['People Partner', 'Talent Lead'],
  },
  {
    id: 'design',
    signals: [
      'дизайн',
      'design',
      'ux',
      'ui',
      'исследован',
      'прототип',
    ],
    alternatives: ['Design Lead', 'UX Research Lead'],
  },
];

export function extractEvidenceCandidates(
  resumeText: string,
): EvidenceExtraction {
  const excerpts = splitIntoExcerpts(resumeText);
  const items = excerpts.slice(0, 8).map((sourceExcerpt, index) => ({
    id: `ev-${String(index + 1).padStart(2, '0')}`,
    kind: classifyEvidence(sourceExcerpt),
    sourceExcerpt,
    statement: sourceExcerpt,
    status: 'pending' as const,
    userEdited: false,
  }));

  return {
    methodVersion: EVIDENCE_METHOD_VERSION,
    items,
    questions: buildEvidenceQuestions(items),
  };
}

export function updateEvidenceItem(
  item: EvidenceItem,
  update: Partial<Pick<EvidenceItem, 'statement' | 'status'>>,
): EvidenceItem {
  const nextStatement = update.statement?.trim() ?? item.statement;
  const requestedStatus = update.status ?? item.status;

  return {
    ...item,
    ...update,
    statement: nextStatement,
    status:
      requestedStatus === 'confirmed' && nextStatement.length < 10
        ? 'pending'
        : requestedStatus,
    userEdited: nextStatement !== item.sourceExcerpt,
  };
}

export function createCandidateAnalysis(resumeText: string): CandidateAnalysis {
  const extraction = extractEvidenceCandidates(resumeText);
  return {
    evidenceMethodVersion: extraction.methodVersion,
    roleMethodVersion: ROLE_METHOD_VERSION,
    evidenceItems: extraction.items,
    questions: extraction.questions,
    roleHypotheses: [],
  };
}

export function completeCandidateAnalysis(
  targetDirection: string,
  analysis: CandidateAnalysis,
  reviewedAt: string = new Date().toISOString(),
): CandidateAnalysis {
  return {
    ...analysis,
    roleHypotheses: buildRoleHypotheses(
      targetDirection,
      analysis.evidenceItems,
    ),
    reviewedAt,
  };
}

export function buildRoleHypotheses(
  targetDirection: string,
  evidence: EvidenceItem[],
): RoleHypothesis[] {
  const confirmed = evidence.filter((item) => item.status === 'confirmed');
  const confirmedIds = confirmed.map((item) => item.id);
  const hasResult = confirmed.some((item) => item.kind === 'result');
  const hasScope = confirmed.some((item) => item.kind === 'scope');
  const primaryGaps = [
    ...(!hasResult ? ['Не хватает подтверждённого результата.'] : []),
    ...(!hasScope ? ['Неясен масштаб ответственности.'] : []),
    ...(confirmed.length < 3
      ? ['Нужно подтвердить ещё несколько задач или достижений.']
      : []),
  ];

  const family = findRoleFamily(
    `${targetDirection} ${confirmed.map((item) => item.statement).join(' ')}`,
  );
  const cleanTarget = targetDirection.trim();

  if (!cleanTarget) {
    const inferredTitles = family?.alternatives.slice(0, 2) ?? [
      'Рабочая гипотеза по подтверждённым задачам',
    ];
    return inferredTitles.map((title, index) => ({
      id: family ? `role-${family.id}-${index + 1}` : 'role-unclear',
      title,
      fitState: confirmed.length > 0 ? 'adjacent' : 'needs-evidence',
      basis: family
        ? `Гипотеза выведена из ${confirmed.length} подтверждённых карьерных ${
            confirmed.length === 1 ? 'эпизода' : 'эпизодов'
          }; название и уровень нужно проверить по вакансиям.`
        : 'Текущих фактов достаточно для проверки задач, но недостаточно для честного названия роли.',
      evidenceIds: confirmedIds.slice(0, 4),
      gaps: [
        ...primaryGaps,
        'Сравнить повторяющиеся задачи и название роли в 5–10 вакансиях.',
      ],
    }));
  }

  const primary: RoleHypothesis = {
    id: 'role-target',
    title: cleanTarget,
    fitState:
      confirmed.length >= 3 && hasResult
        ? 'plausible'
        : confirmed.length > 0
          ? 'adjacent'
          : 'needs-evidence',
    basis:
      confirmed.length > 0
        ? `Опирается на ${confirmed.length} подтверждённых ${
            confirmed.length === 1 ? 'факт' : 'факта'
          } из резюме. Это гипотеза, а не решение рынка.`
        : 'Пока это заявленное направление без подтверждённых фактов.',
    evidenceIds: confirmedIds.slice(0, 4),
    gaps: primaryGaps,
  };

  if (!family) {
    return [
      primary,
      {
        id: 'role-adjacent',
        title: `Смежная роль рядом с «${targetDirection.trim()}»`,
        fitState: 'needs-evidence',
        basis:
          'Точное название нельзя вывести только из текущего резюме. Нужна проверка задач на реальных вакансиях.',
        evidenceIds: confirmedIds.slice(0, 2),
        gaps: [
          'Уточнить задачи, которые хочется выполнять регулярно.',
          'Сравнить формулировки роли на выбранном рынке.',
        ],
      },
    ];
  }

  const comparableTarget = normalizeForMatch(cleanTarget);
  const alternatives = family.alternatives
    .filter((title) => normalizeForMatch(title) !== comparableTarget)
    .slice(0, 2);

  return [
    primary,
    ...alternatives.map((title, index): RoleHypothesis => ({
      id: `role-${family.id}-${index + 1}`,
      title,
      fitState: confirmed.length >= 2 ? 'adjacent' : 'needs-evidence',
      basis:
        'Смежная гипотеза из той же группы задач. Её нужно проверить по требованиям реальных вакансий.',
      evidenceIds: selectFamilyEvidence(confirmed, family).slice(0, 3),
      gaps: [
        'Сравнить повторяющиеся задачи в 5–10 вакансиях.',
        'Проверить уровень и название роли для выбранного рынка.',
      ],
    })),
  ];
}

function splitIntoExcerpts(resumeText: string): string[] {
  const seen = new Set<string>();

  return buildContentBlocks(resumeText)
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=[А-ЯA-ZЁ])/u))
    .map((value) => value.trim())
    .filter((value) => value.length >= 30 && value.length <= 420)
    .filter((value) => !/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(value))
    .filter((value) => {
      const normalized = normalizeForMatch(value);
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function buildContentBlocks(resumeText: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  function flush() {
    if (current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
  }

  for (const rawLine of resumeText.replace(/\r\n?/gu, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || isSectionHeading(line)) {
      flush();
      continue;
    }

    if (/^[•●▪◦\-–—]\s+/u.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

function isSectionHeading(value: string): boolean {
  const words = value.split(/\s+/u);
  return (
    value.length < 42 &&
    words.length <= 5 &&
    !/[.,;:!?]/u.test(value) &&
    !/\d/u.test(value)
  );
}

function classifyEvidence(value: string): EvidenceKind {
  if (RESULT_SIGNALS.every((signal) => signal.test(value))) {
    return 'result';
  }
  if (SCOPE_SIGNALS.test(value)) {
    return 'scope';
  }
  if (RESPONSIBILITY_SIGNALS.test(value)) {
    return 'responsibility';
  }
  return 'expertise';
}

function buildEvidenceQuestions(items: EvidenceItem[]): string[] {
  if (items.length === 0) {
    return [
      'За какие задачи вам платили или доверяли ответственность?',
      'Какой результат вашей работы можно проверить?',
      'В каком масштабе вы работали: команда, бюджет, объём или география?',
    ];
  }

  const questions: string[] = [];
  if (!items.some((item) => item.kind === 'result')) {
    questions.push('Какой измеримый или наблюдаемый результат можно добавить?');
  }
  if (!items.some((item) => item.kind === 'scope')) {
    questions.push('Каков был масштаб: команда, бюджет, объём или география?');
  }
  if (!items.some((item) => item.kind === 'responsibility')) {
    questions.push('За какие решения или регулярные задачи отвечали лично вы?');
  }
  return questions;
}

function findRoleFamily(value: string): RoleFamily | undefined {
  const normalized = normalizeForMatch(value);
  return ROLE_FAMILIES.map((family) => ({
    family,
    score: family.signals.filter((signal) => normalized.includes(signal)).length,
  }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.family.id.localeCompare(right.family.id),
    )[0]?.family;
}

function selectFamilyEvidence(
  confirmed: EvidenceItem[],
  family: RoleFamily,
): string[] {
  const matching = confirmed.filter((item) => {
    const normalized = normalizeForMatch(item.statement);
    return family.signals.some((signal) => normalized.includes(signal));
  });
  const selected = matching.length > 0 ? matching : confirmed;
  return selected.map((item) => item.id);
}

function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
}
