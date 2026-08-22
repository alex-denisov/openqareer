import type { EvidenceItem } from '../evidence/evidenceEngine';

export const OPPORTUNITY_METHOD_VERSION = 'opportunity-local-v1';

type OpportunityItemKind = 'task' | 'requirement' | 'condition';
export type HardConstraintAssessment = 'clear' | 'conflict' | 'unknown';
export type OpportunityChoice = 'apply' | 'network' | 'watch' | 'skip';

export interface OpportunityInput {
  title: string;
  company: string;
  text: string;
  sourceLabel: string;
  sourceUrl?: string;
}

export interface OpportunityItem {
  id: string;
  kind: OpportunityItemKind;
  sourceExcerpt: string;
}

export interface ParsedOpportunity {
  methodVersion: typeof OPPORTUNITY_METHOD_VERSION;
  items: OpportunityItem[];
  unknowns: string[];
}

interface OpportunityMatch {
  opportunityItemId: string;
  evidenceIds: string[];
  sharedSignals: string[];
}

export interface OpportunityAnalysis {
  hardConstraintAssessment: HardConstraintAssessment;
  recommendation: OpportunityChoice;
  reasonCodes: string[];
  matches: OpportunityMatch[];
  gapItemIds: string[];
  unknowns: string[];
}

export interface OpportunityDecision {
  choice: OpportunityChoice;
  reason: string;
  decidedAt: string;
  overridesRecommendation: boolean;
}

export interface OpportunityRecord extends OpportunityInput {
  id: string;
  capturedAt: string;
  parsed: ParsedOpportunity;
  analysis?: OpportunityAnalysis;
  decision?: OpportunityDecision;
}

export type OpportunityInputErrors = Partial<
  Record<'title' | 'text' | 'sourceUrl', string>
>;

const HEADING_KINDS: Record<string, OpportunityItemKind> = {
  задачи: 'task',
  обязанности: 'task',
  'что делать': 'task',
  responsibilities: 'task',
  requirements: 'requirement',
  требования: 'requirement',
  'мы ожидаем': 'requirement',
  условия: 'condition',
  conditions: 'condition',
  benefits: 'condition',
  'что предлагаем': 'condition',
};

const CONDITION_SIGNALS =
  /удал[её]н|офис|гибрид|зарплат|компенсац|занятост|график|релокац|remote|hybrid|office|salary|compensation|employment/iu;
const REQUIREMENT_SIGNALS =
  /треб|опыт|знан|умени|владен|готовност|must|required|experience|knowledge|proficien/iu;
const TASK_SIGNALS =
  /отвеч|управ|формир|разработ|созда|провод|координир|анализир|запуска|build|lead|manage|own|develop|research|analy/iu;

const STOP_WORDS = new Set([
  'будет',
  'вашей',
  'вашего',
  'который',
  'которые',
  'работа',
  'работы',
  'опыт',
  'задачи',
  'требования',
  'условия',
  'через',
  'после',
  'перед',
  'этого',
  'этими',
  'their',
  'with',
  'from',
  'that',
  'this',
  'role',
  'work',
  'years',
]);

export function validateOpportunityInput(
  input: OpportunityInput,
): OpportunityInputErrors {
  const errors: OpportunityInputErrors = {};
  if (input.title.trim().length < 2) {
    errors.title = 'Укажите название роли из вакансии.';
  }
  if (input.text.trim().length < 120) {
    errors.text = 'Добавьте полный текст вакансии — минимум 120 знаков.';
  }
  if (input.sourceUrl && !isHttpUrl(input.sourceUrl)) {
    errors.sourceUrl = 'Укажите ссылку, начинающуюся с http:// или https://.';
  }
  return errors;
}

export function createOpportunityRecord(
  input: OpportunityInput,
  capturedAt: string = new Date().toISOString(),
): OpportunityRecord {
  const normalizedInput = {
    title: input.title.trim(),
    company: input.company.trim(),
    text: input.text.trim(),
    sourceLabel: input.sourceLabel.trim() || 'Ручной ввод',
    sourceUrl: input.sourceUrl?.trim() || undefined,
  };

  return {
    ...normalizedInput,
    id: `opportunity-${capturedAt}`,
    capturedAt,
    parsed: parseOpportunity(normalizedInput.text),
  };
}

export function parseOpportunity(text: string): ParsedOpportunity {
  const items: OpportunityItem[] = [];
  const counters: Record<OpportunityItemKind, number> = {
    task: 0,
    requirement: 0,
    condition: 0,
  };
  let currentKind: OpportunityItemKind | undefined;

  for (const rawLine of text.replace(/\r\n?/gu, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const heading = normalizeHeading(line);
    if (HEADING_KINDS[heading]) {
      currentKind = HEADING_KINDS[heading];
      continue;
    }

    for (const sourceExcerpt of splitVacancyLine(line)) {
      if (sourceExcerpt.length < 24) {
        continue;
      }
      const kind = currentKind ?? classifyOpportunityItem(sourceExcerpt);
      if (!kind) {
        continue;
      }
      counters[kind] += 1;
      items.push({
        id: `vac-${kind.slice(0, 3)}-${String(counters[kind]).padStart(2, '0')}`,
        kind,
        sourceExcerpt,
      });
    }
  }

  return {
    methodVersion: OPPORTUNITY_METHOD_VERSION,
    items: items.slice(0, 18),
    unknowns: buildUnknowns(text),
  };
}

export function analyzeOpportunity(
  record: OpportunityRecord,
  evidence: EvidenceItem[],
  hardConstraintAssessment: HardConstraintAssessment,
): OpportunityAnalysis {
  const confirmed = evidence.filter((item) => item.status === 'confirmed');
  const comparableItems = record.parsed.items.filter(
    (item) => item.kind === 'task' || item.kind === 'requirement',
  );
  const matches = comparableItems.flatMap((item) => {
    const itemSignals = extractSignals(item.sourceExcerpt);
    const matchingEvidence = confirmed
      .map((candidate) => ({
        candidate,
        sharedSignals: intersect(
          itemSignals,
          extractSignals(candidate.statement),
        ),
      }))
      .filter(({ sharedSignals }) =>
        hasSufficientSharedSignals(sharedSignals),
      );

    if (matchingEvidence.length === 0) {
      return [];
    }

    return [
      {
        opportunityItemId: item.id,
        evidenceIds: matchingEvidence.map(({ candidate }) => candidate.id),
        sharedSignals: [
          ...new Set(
            matchingEvidence.flatMap(({ sharedSignals }) => sharedSignals),
          ),
        ].slice(0, 4),
      },
    ];
  });
  const matchedItemIds = new Set(
    matches.map((match) => match.opportunityItemId),
  );
  const gapItemIds = record.parsed.items
    .filter(
      (item) =>
        item.kind === 'requirement' && !matchedItemIds.has(item.id),
    )
    .map((item) => item.id);
  const { recommendation, reasonCodes } = recommendOpportunity(
    hardConstraintAssessment,
    record.parsed.items.filter((item) => item.kind === 'requirement').length,
    matches.length,
    gapItemIds.length,
  );

  return {
    hardConstraintAssessment,
    recommendation,
    reasonCodes,
    matches,
    gapItemIds,
    unknowns: record.parsed.unknowns,
  };
}

export function recordOpportunityDecision(
  record: OpportunityRecord & { analysis: OpportunityAnalysis },
  choice: OpportunityChoice,
  reason: string,
  decidedAt: string = new Date().toISOString(),
): OpportunityRecord {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 10) {
    throw new Error('Добавьте короткую причину решения.');
  }

  return {
    ...record,
    decision: {
      choice,
      reason: normalizedReason,
      decidedAt,
      overridesRecommendation: choice !== record.analysis.recommendation,
    },
  };
}

function recommendOpportunity(
  hardConstraintAssessment: HardConstraintAssessment,
  requirementCount: number,
  matchCount: number,
  gapCount: number,
): Pick<OpportunityAnalysis, 'recommendation' | 'reasonCodes'> {
  if (hardConstraintAssessment === 'conflict') {
    return {
      recommendation: 'skip',
      reasonCodes: ['hard-constraint-conflict'],
    };
  }
  if (hardConstraintAssessment === 'unknown') {
    return {
      recommendation: matchCount > 0 ? 'network' : 'watch',
      reasonCodes: ['hard-constraints-unverified'],
    };
  }
  if (requirementCount > 0 && gapCount === 0 && matchCount >= 2) {
    return {
      recommendation: 'apply',
      reasonCodes: ['requirements-covered-by-confirmed-evidence'],
    };
  }
  if (matchCount > 0) {
    return {
      recommendation: 'network',
      reasonCodes: ['partial-evidence-needs-role-context'],
    };
  }
  return {
    recommendation: 'watch',
    reasonCodes: ['insufficient-confirmed-evidence'],
  };
}

function buildUnknowns(text: string): string[] {
  const unknowns = ['Дата публикации и актуальность не подтверждены.'];
  if (!/(?:₽|руб|rur|usd|eur|\$|€)|\b\d{2,3}(?:[ .]\d{3})\b/iu.test(text)) {
    unknowns.push('Компенсация не указана.');
  }
  if (!/удал[её]н|офис|гибрид|remote|hybrid|office|локац|город/iu.test(text)) {
    unknowns.push('Формат и локация не указаны.');
  }
  if (!/полная занятост|частичная занятост|full[- ]time|part[- ]time|контракт/iu.test(text)) {
    unknowns.push('Тип занятости не указан.');
  }
  return unknowns;
}

function splitVacancyLine(line: string): string[] {
  const withoutBullet = line.replace(/^[•●▪◦\-–—]\s*/u, '');
  return withoutBullet
    .split(/(?<=[.!?])\s+(?=[А-ЯA-ZЁ])/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function classifyOpportunityItem(
  value: string,
): OpportunityItemKind | undefined {
  if (CONDITION_SIGNALS.test(value)) {
    return 'condition';
  }
  if (REQUIREMENT_SIGNALS.test(value)) {
    return 'requirement';
  }
  if (TASK_SIGNALS.test(value)) {
    return 'task';
  }
  return undefined;
}

function normalizeHeading(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/[:.]/gu, '')
    .trim();
}

function extractSignals(value: string): string[] {
  return [
    ...new Set(
      value
        .toLocaleLowerCase('ru-RU')
        .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
        .split(/\s+/u)
        .filter((token) => token.length >= 4 || token === 'sql')
        .filter((token) => !STOP_WORDS.has(token))
        .map(canonicalSignal),
    ),
  ];
}

function canonicalSignal(token: string): string {
  if (token === 'sql') return token;
  if (token.startsWith('запус')) return 'запуск';
  return token.slice(0, 6);
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function hasSufficientSharedSignals(sharedSignals: string[]): boolean {
  return sharedSignals.length >= 2 || sharedSignals.includes('sql');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
