import type { FastifyRequest } from 'fastify';
import {
  checkGeneratedTextFacts,
  type GeneratedClaimCheck,
  type GeneratedTextFactCheck,
} from '../domain/generatedTextFactGate';
import {
  reviewLetterBody,
  type LetterGateSources,
  type LetterGateViolation,
} from '../domain/letterModelGate';
import type { PitchFactRankingContext } from '../domain/pitchFactRanking';
import {
  filterUsablePitchFacts,
  letterCareer,
  letterFactPlaces,
  letterModelFacts,
  type PitchLanguage,
  type PitchTone,
  type PitchWorkplace,
  type VacancyPitchInputFact,
} from '../domain/vacancyPitchService';
import {
  COVER_LETTER_BUDGET_MS,
  withinTimeBudget,
  type CoverLetterWriteInput,
  type CoverLetterWriter,
} from '../providers/coverLetterWriter';

export interface LetterWritingRequest {
  readonly vacancy: {
    title: string;
    company?: string;
    description?: string;
    requiredSkills: readonly string[];
    recipient?: { name?: string; role?: string };
  };
  /** Факты с переведёнными формулировками: письмо и проверка видят один текст. */
  readonly facts: readonly VacancyPitchInputFact[];
  readonly workplaces: readonly PitchWorkplace[];
  readonly language: PitchLanguage;
  readonly tone: PitchTone;
  readonly rankingContext: PitchFactRankingContext | undefined;
  /** B422: кандидат отметил компанию вакансии «Хочу в эту компанию». */
  readonly targetCompany: boolean;
  readonly contextMs: number;
}

export interface WrittenLetterBody {
  readonly body?: string;
  readonly stage?: string;
  readonly factCheck?: GeneratedTextFactCheck;
}

/**
 * Раскладка времени письма на составляющие: сборка контекста (снимок
 * кандидата + разбор роли кампании) отдельно от ожидания провайдера. Только
 * числа и имя ступени — ни текста письма, ни фактов кандидата (C46).
 */
function logPitchTiming(entry: {
  readonly contextMs: number;
  readonly providerMs: number;
  readonly totalMs: number;
  readonly stage?: string;
}): void {
  console.info(JSON.stringify({ event: 'vacancy-pitch-timing', ...entry }));
}

const MODEL_LETTER_NOTICE: Readonly<Record<PitchLanguage, string>> = {
  ru: 'Черновик написала модель. Прочитайте его перед отправкой.',
  en: 'This draft was written by a model. Please read it before sending.',
};

/** Проверка письма не оценивает смысл пересказа, поэтому экран обещает не проверку, а чтение. */
export function modelLetterNotice(language: PitchLanguage): string {
  return MODEL_LETTER_NOTICE[language];
}

function letterGateSources(request: LetterWritingRequest): LetterGateSources {
  const { vacancy, facts, workplaces, language } = request;
  const usable = filterUsablePitchFacts(facts);
  const places = letterFactPlaces(workplaces, language).map(({ employer, factIds }) => ({
    employer,
    statements: usable.filter((fact) => factIds.includes(fact.id)).map((fact) => fact.statement),
  }));
  return {
    language,
    candidate: usable.map((fact) => fact.statement),
    places,
    career: letterCareer(workplaces, language).map((place) =>
      [place.title, place.employer, place.years].filter(Boolean).join(' '),
    ),
    vacancy: [
      vacancy.title,
      vacancy.company,
      vacancy.description,
      vacancy.recipient?.name,
      vacancy.recipient?.role,
      ...vacancy.requiredSkills,
    ].flatMap((part) => (part ? [part] : [])),
  };
}

/** Сводка для кандидата: прежний разбор утверждений и всё, что остановила проверка письма. */
function letterFactCheck(
  body: string,
  facts: readonly VacancyPitchInputFact[],
  violations: readonly LetterGateViolation[],
): GeneratedTextFactCheck {
  const check = checkGeneratedTextFacts(body, facts);
  if (violations.length === 0) return { ...check, status: 'checked' };
  const known = new Set(check.claims.map((claim) => claim.text));
  const added = [...new Set(violations.map((violation) => violation.sentence))]
    .filter((sentence) => !known.has(sentence))
    .map((text): GeneratedClaimCheck => ({
      text,
      status: 'not_in_profile',
      evidenceIds: [],
      action: 'ask_candidate',
    }));
  return { ...check, status: 'needs_confirmation', claims: [...check.claims, ...added] };
}

function writerInput(
  letter: LetterWritingRequest,
  review: (body: string) => readonly string[],
): CoverLetterWriteInput {
  const { vacancy, facts, workplaces, language, tone, rankingContext, targetCompany } = letter;
  const places = letterFactPlaces(workplaces, language);
  return {
    facts: letterModelFacts(facts, workplaces, language).map((fact) => ({
      ref: fact.id,
      workplace: places.find((place) => place.factIds.includes(fact.id))?.employer ?? null,
      statement: fact.statement,
      domain: fact.domain,
      createdAt: fact.createdAt,
      updatedAt: fact.updatedAt,
      status: fact.status,
    })),
    career: letterCareer(workplaces, language),
    vacancy: {
      title: vacancy.title,
      ...(vacancy.company ? { company: vacancy.company } : {}),
      ...(vacancy.description ? { description: vacancy.description } : {}),
      requirements: vacancy.requiredSkills,
      ...(rankingContext ? { rankingContext } : {}),
      ...(vacancy.recipient ? { recipient: vacancy.recipient } : {}),
      ...(targetCompany ? { targetCompany: true as const } : {}),
    },
    language,
    tone,
    review,
  };
}

/** Model writing is bounded; the deterministic template remains the fallback. */
export async function writeCoverLetterBody(
  writer: CoverLetterWriter | undefined,
  request: FastifyRequest,
  letter: LetterWritingRequest,
): Promise<WrittenLetterBody> {
  if (!writer) return {};
  const sources = letterGateSources(letter);
  let refused: GeneratedTextFactCheck | undefined;
  const review = (body: string): string[] => {
    const violations = reviewLetterBody(body, sources);
    if (violations.length > 0) refused = letterFactCheck(body, letter.facts, violations);
    return violations.map((violation) => violation.rule);
  };
  const providerStart = Date.now();
  const outcome = await withinTimeBudget(
    writer.writeCoverLetter(writerInput(letter, review)),
    COVER_LETTER_BUDGET_MS,
  );
  const providerMs = Date.now() - providerStart;
  if (outcome.failure) request.log.warn(outcome.failure, 'cover-letter-stage-failed');
  const stage = outcome.stage ?? outcome.failure?.stage;
  logPitchTiming({
    contextMs: letter.contextMs,
    providerMs,
    totalMs: letter.contextMs + providerMs,
    ...(stage ? { stage } : {}),
  });
  if (!outcome.body) return refused ? { factCheck: refused } : {};
  // A writer outside the queue answers here: nothing unchecked reaches the candidate.
  const violations = reviewLetterBody(outcome.body, sources);
  const factCheck = letterFactCheck(outcome.body, letter.facts, violations);
  return violations.length === 0
    ? { body: outcome.body, stage: outcome.stage, factCheck }
    : { factCheck };
}
