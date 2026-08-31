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

const RESULT_SIGNALS = [
  /\d/u,
  /увелич|сократ|сниз|рост|выруч|эконом|запуст|достиг|improv|increas|reduc|grew|launched/iu,
];
const SCOPE_SIGNALS =
  /команд|бюджет|p&l|подчин|регион|стра[нны]|портфел|people|team|budget|global|country/iu;
const RESPONSIBILITY_SIGNALS =
  /управля|отвечал|руковод|созда|разработ|внедр|проводил|формировал|координировал|managed|owned|led|built|developed|implemented|responsible/iu;

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

/**
 * Роль называет только источник: направление, которое кандидат назвал сам, и
 * `career_strategist` в кабинете. Прежняя таблица «ключевое слово → две
 * должности» выдавала руководящие роли кандидату без единого управленческого
 * эпизода и спорила со стратегом на одном экране (B178, находка 2). Нет
 * названного направления — нет роли, а не подстановка из словаря.
 */
export function buildRoleHypotheses(
  targetDirection: string,
  evidence: EvidenceItem[],
): RoleHypothesis[] {
  const cleanTarget = targetDirection.trim();
  if (!cleanTarget) return [];

  const confirmed = evidence.filter((item) => item.status === 'confirmed');
  const confirmedIds = confirmed.map((item) => item.id);
  const hasResult = confirmed.some((item) => item.kind === 'result');
  const hasScope = confirmed.some((item) => item.kind === 'scope');

  return [
    {
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
      gaps: [
        ...(!hasResult ? ['Не хватает подтверждённого результата.'] : []),
        ...(!hasScope ? ['Неясен масштаб ответственности.'] : []),
        ...(confirmed.length < 3
          ? ['Нужно подтвердить ещё несколько задач или достижений.']
          : []),
      ],
    },
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

function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
}
