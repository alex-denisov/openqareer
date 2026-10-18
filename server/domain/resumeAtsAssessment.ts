import type {
  ResumeDocument,
  ResumeExperience,
} from './resumeStudioTypes';

export type AtsRequirementSource =
  | {
      readonly kind: 'candidate_input';
      readonly label: string;
      readonly capturedAt: string;
    }
  | {
      readonly kind: 'saved_vacancy';
      readonly sourceId: string;
      readonly label: string;
      readonly capturedAt: string;
    };

export interface AtsKeywordEvidence {
  readonly requirement: string;
  readonly matches: readonly { readonly field: string; readonly text: string }[];
}

export interface ResumeAtsDimension {
  readonly score: number | null;
  readonly maximum: number;
  readonly status: 'measured' | 'unknown';
  readonly source: string;
  readonly sampleSize: number;
  readonly summary: string;
  readonly matched?: number;
  readonly required?: number;
  readonly matchedRequirements?: readonly string[];
  readonly unmatchedRequirements?: readonly string[];
  readonly evidence?: readonly AtsKeywordEvidence[];
  readonly passedRules?: number;
  readonly checkedRules?: number;
}

export interface ResumeAtsAssessment {
  readonly total: {
    readonly score: number | null;
    readonly maximum: 100;
    readonly status: 'measured' | 'partial' | 'unknown';
  };
  readonly dimensions: {
    readonly structure: ResumeAtsDimension;
    readonly keywords: ResumeAtsDimension;
    readonly dates: ResumeAtsDimension;
    readonly format: ResumeAtsDimension;
  };
  readonly context: {
    readonly resumeUpdatedAt: string | null;
    readonly resumeSourceRevision: string | null;
    readonly requirementSource: AtsRequirementSource | null;
  };
  readonly evaluatedAt: string;
  readonly disclaimer: string;
}

export interface BuildResumeAtsAssessmentInput {
  readonly document: ResumeDocument;
  readonly atsText: string;
  readonly requirements: readonly string[];
  readonly requirementSource: AtsRequirementSource | null;
  readonly resumeUpdatedAt: string | null;
  readonly resumeSourceRevision?: string | null;
  readonly evaluatedAt: string;
}

const MAXIMUM = {
  structure: 25,
  keywords: 30,
  dates: 20,
  format: 25,
} as const;

const UNKNOWN_KEYWORD_SOURCE = 'Нет проверенных требований вакансии';
const MAX_ATS_LINE_CHARACTERS = 120;

export function buildResumeAtsAssessment(
  input: BuildResumeAtsAssessmentInput,
): ResumeAtsAssessment {
  const requirements = normalizeRequirements(input.requirements);
  const requirementSource = isValidRequirementSource(input.requirementSource)
    ? input.requirementSource
    : null;
  const dimensions = {
    structure: structureDimension(input.document),
    keywords: keywordDimension(input.document, requirements, requirementSource),
    dates: dateDimension(input.document.experience),
    format: formatDimension(input.document, input.atsText),
  };
  const scores = Object.values(dimensions).map((dimension) => dimension.score);
  const allMeasured = scores.every((score): score is number => score !== null);
  const anyMeasured = scores.some((score) => score !== null);

  return {
    total: {
      score: allMeasured ? scores.reduce((sum, score) => sum + score, 0) : null,
      maximum: 100,
      status: allMeasured ? 'measured' : anyMeasured ? 'partial' : 'unknown',
    },
    dimensions,
    context: {
      resumeUpdatedAt: validTimestamp(input.resumeUpdatedAt) ? input.resumeUpdatedAt : null,
      resumeSourceRevision: input.resumeSourceRevision ?? null,
      requirementSource,
    },
    evaluatedAt: validTimestamp(input.evaluatedAt)
      ? input.evaluatedAt
      : new Date(0).toISOString(),
    disclaimer:
      'Это проверка по правилам на данных резюме и указанном контексте; она не гарантирует прохождение отбора.',
  };
}

function structureDimension(document: ResumeDocument): ResumeAtsDimension {
  const checks = [
    Boolean(document.contact.fullName?.trim()),
    Boolean(
      document.contact.email?.trim() ||
        document.contact.phone?.trim() ||
        document.contact.telegram?.trim() ||
        document.contact.links.some((link) => link.trim()),
    ),
    document.experience.length > 0,
    document.education.length > 0,
    Boolean((document.skills?.length ?? 0) + document.languages.length),
  ];
  const passedRules = checks.filter(Boolean).length;
  return {
    score: passedRules * 5,
    maximum: MAXIMUM.structure,
    status: 'measured',
    source: 'Мастер-резюме',
    sampleSize: checks.length,
    summary: 'Проверены имя, контакт, опыт, образование и навыки или языки.',
    passedRules,
    checkedRules: checks.length,
  };
}

function keywordEvidenceForRequirement(
  requirement: string,
  factSources: readonly { readonly field: string; readonly text: string }[],
): AtsKeywordEvidence {
  const normalizedRequirement = normalizeText(requirement);
  const seen = new Set<string>();
  const matches = factSources.flatMap((fact) => {
    const normalizedFact = normalizeText(fact.text);
    const boundaryFact = ` ${normalizedFact} `;
    const boundaryRequirement = ` ${normalizedRequirement} `;
    const identity = `${fact.field}${String.fromCharCode(0)}${fact.text}`;
    if (!normalizedFact.includes(normalizedRequirement) || seen.has(identity)) return [];
    if (!boundaryFact.includes(boundaryRequirement)) return [];
    seen.add(identity);
    return [{ field: fact.field, text: evidenceText(fact.text) }];
  });
  return { requirement, matches };
}

function keywordDimension(
  document: ResumeDocument,
  requirements: readonly string[],
  requirementSource: AtsRequirementSource | null,
): ResumeAtsDimension {
  if (!requirements.length || !requirementSource) {
    return {
      score: null,
      maximum: MAXIMUM.keywords,
      status: 'unknown',
      source: UNKNOWN_KEYWORD_SOURCE,
      sampleSize: 0,
      summary: 'Добавьте требования вакансии с указанным источником.',
      matched: 0,
      required: 0,
      matchedRequirements: [],
      unmatchedRequirements: [],
      evidence: [],
    };
  }

  const factSources = documentFactSources(document);
  const evidence = requirements.map((requirement) =>
    keywordEvidenceForRequirement(requirement, factSources),
  );
  const matchedRequirements = evidence
    .filter((item) => item.matches.length > 0)
    .map((item) => item.requirement);
  const unmatchedRequirements = evidence
    .filter((item) => item.matches.length === 0)
    .map((item) => item.requirement);
  const matched = matchedRequirements.length;
  return {
    score: Math.round((MAXIMUM.keywords * matched) / requirements.length),
    maximum: MAXIMUM.keywords,
    status: 'measured',
    source: requirementSource.label,
    sampleSize: requirements.length,
    summary: 'Сопоставлены точные текстовые совпадения, без синонимов.',
    matched,
    required: requirements.length,
    matchedRequirements,
    unmatchedRequirements,
    evidence,
  };
}

function dateDimension(experience: readonly ResumeExperience[]): ResumeAtsDimension {
  if (!experience.length) {
    return {
      score: null,
      maximum: MAXIMUM.dates,
      status: 'unknown',
      source: 'Опыт: сохранённые даты',
      sampleSize: 0,
      summary: 'Нет мест работы для проверки дат.',
    };
  }

  const validCount = experience.filter(hasValidExperienceDates).length;
  return {
    score: Math.round((MAXIMUM.dates * validCount) / experience.length),
    maximum: MAXIMUM.dates,
    status: 'measured',
    source: 'Опыт: сохранённые даты',
    sampleSize: experience.length,
    summary: 'Проверены даты начала и окончания каждого места работы.',
    passedRules: validCount,
    checkedRules: experience.length,
  };
}

function containsForbiddenControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

function formatDimension(document: ResumeDocument, atsText: string): ResumeAtsDimension {
  const text = atsText.trim();
  if (!text) {
    return {
      score: null,
      maximum: MAXIMUM.format,
      status: 'unknown',
      source: 'Экспорт ATS Plain Text',
      sampleSize: 0,
      summary: 'Нет текстового экспорта для проверки формата.',
    };
  }

  const lines = text.split(/\r?\n/u);
  const firstLine = lines.find((line) => line.trim())?.trim() ?? '';
  const name = document.contact.fullName?.trim() ?? '';
  const checks = [
    text.length > 0,
    Boolean(name) && firstLine === name.toLocaleUpperCase(),
    lines.some((line) => /^=== [A-Z][A-Z ]* ===$/u.test(line.trim())),
    !containsForbiddenControlCharacters(text),
    lines.every((line) => [...line].length <= MAX_ATS_LINE_CHARACTERS),
  ];
  const passedRules = checks.filter(Boolean).length;
  return {
    score: passedRules * 5,
    maximum: MAXIMUM.format,
    status: 'measured',
    source: 'Экспорт ATS Plain Text',
    sampleSize: lines.filter((line) => line.trim()).length,
    summary: 'Проверены заголовок, разделы, управляющие символы и длина строк экспорта.',
    passedRules,
    checkedRules: checks.length,
  };
}

function hasValidExperienceDates(experience: ResumeExperience): boolean {
  const start = dateTime(experience.startDate?.value);
  if (start === null) return false;
  if (experience.current.value) return true;
  const end = dateTime(experience.endDate?.value);
  return end !== null && end >= start;
}

function dateTime(value: string | boolean | undefined): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function documentFactSources(
  document: ResumeDocument,
): { readonly field: string; readonly text: string }[] {
  const candidates = [
    { field: 'Контакты', text: document.contact.fullName },
    { field: 'Контакты', text: document.contact.email },
    { field: 'Контакты', text: document.contact.phone },
    { field: 'Контакты', text: document.contact.telegram },
    { field: 'Контакты', text: document.contact.location },
    ...document.contact.links.map((text) => ({ field: 'Контакты', text })),
    { field: 'Обо мне', text: document.about },
    ...document.experience.flatMap((role) => [
      { field: 'Опыт: должность или компания', text: role.title?.value },
      { field: 'Опыт: должность или компания', text: role.employer?.value },
      { field: 'Опыт: место', text: role.location?.value },
      ...role.bullets.map((bullet) => ({ field: 'Опыт: пункт', text: bullet.value })),
    ]),
    ...(document.skills ?? []).map((skill) => ({ field: 'Навыки', text: skill.name })),
    ...document.education.flatMap((item) => [
      { field: 'Образование', text: item.institution?.value },
      { field: 'Образование', text: item.qualification?.value },
    ]),
    ...document.languages.flatMap((language) =>
      language.name ? [{ field: 'Языки', text: language.name.value }] : [],
    ),
    ...(document.projects ?? []).flatMap((project) => [
      { field: 'Проекты', text: project.name.value },
      { field: 'Проекты', text: project.description?.value },
      { field: 'Проекты', text: project.employer?.value },
      ...project.skills.map((skill) => ({ field: 'Проекты: навыки', text: skill.value })),
    ]),
  ];
  return candidates.filter(
    (candidate): candidate is { field: string; text: string } =>
      typeof candidate.text === 'string' && Boolean(candidate.text.trim()),
  );
}

function evidenceText(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 240 ? normalized : normalized.slice(0, 237) + '…';
}

function normalizeRequirements(requirements: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const requirement of requirements) {
    const value = normalizeText(requirement);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(requirement.trim());
  }
  return normalized;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function isValidRequirementSource(
  source: AtsRequirementSource | null,
): source is AtsRequirementSource {
  if (!source || !source.label.trim() || !validTimestamp(source.capturedAt)) return false;
  return source.kind !== 'saved_vacancy' || Boolean(source.sourceId.trim());
}

function validTimestamp(value: string | null): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}
