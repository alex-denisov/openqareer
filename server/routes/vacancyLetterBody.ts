import type { FastifyRequest } from 'fastify';
import { checkGeneratedTextFacts, type GeneratedTextFactCheck } from '../domain/generatedTextFactGate';
import { reviewLetterBody, type LetterGateSources } from '../domain/letterModelGate';
import {
  filterUsablePitchFacts,
  type PitchLanguage,
  type VacancyPitchInputFact,
} from '../domain/vacancyPitchService';
import type { LetterGender } from '../domain/coverLetterWriting';
import {
  COVER_LETTER_BUDGET_MS,
  hasLetterInput,
  withinTimeBudget,
  type CoverLetterWriteInput,
  type CoverLetterWriter,
} from '../providers/coverLetterWriter';

export interface LetterWritingRequest {
  readonly vacancy: {
    title: string;
    company?: string;
    location?: string;
    /** Полный текст вакансии, а не сводка кластера. */
    description?: string;
    responsibilities?: readonly string[];
    requiredSkills: readonly string[];
    recipient?: { name?: string; role?: string };
  };
  /** Весь мастер-профиль обычным текстом. */
  readonly profile: string;
  /** Факты с переведёнными формулировками: проверка знает и их. */
  readonly facts: readonly VacancyPitchInputFact[];
  readonly language: PitchLanguage;
  /** Только когда кандидат выбрал язык сам. */
  readonly chosenLanguage?: PitchLanguage;
  /** По имени из профиля; если определить нельзя, род в письме не виден. */
  readonly gender?: LetterGender;
  /** Есть ли резюме для приложения: без него письмо не говорит, что резюме приложено. */
  readonly resumeAttached: boolean;
  readonly contextMs: number;
}

export interface WrittenLetterBody {
  readonly body?: string;
  readonly stage?: string;
  readonly factCheck?: GeneratedTextFactCheck;
  /** Модель спросили, письма нет. Пустой профиль — не отказ: спрашивать было не о чем. */
  readonly refused?: true;
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
  const { vacancy, profile, facts, language, resumeAttached } = request;
  return {
    language,
    resumeAttached,
    candidate: [...profile.split('\n'), ...filterUsablePitchFacts(facts).map((fact) => fact.statement)],
    vacancy: [
      vacancy.title,
      vacancy.company,
      vacancy.location,
      vacancy.recipient?.name,
      vacancy.recipient?.role,
      vacancy.description,
      ...(vacancy.responsibilities ?? []),
      ...vacancy.requiredSkills,
    ].flatMap((part) => (part ? [part] : [])),
  };
}

function writerInput(
  letter: LetterWritingRequest,
  review: (body: string) => readonly string[],
): CoverLetterWriteInput {
  const { vacancy, profile, chosenLanguage, gender, resumeAttached } = letter;
  return {
    profile,
    vacancy: {
      title: vacancy.title,
      ...(vacancy.company ? { company: vacancy.company } : {}),
      ...(vacancy.location ? { location: vacancy.location } : {}),
      ...(vacancy.description ? { description: vacancy.description } : {}),
      ...(vacancy.responsibilities?.length ? { responsibilities: vacancy.responsibilities } : {}),
      requirements: vacancy.requiredSkills,
      ...(vacancy.recipient ? { recipient: vacancy.recipient } : {}),
    },
    ...(chosenLanguage ? { chosenLanguage } : {}),
    ...(gender ? { gender } : {}),
    ...(resumeAttached ? {} : { resumeAttached: false }),
    review,
  };
}

/** Model writing is bounded. `refused` means the whole chain refused: the route answers with an error. */
export async function writeCoverLetterBody(
  writer: CoverLetterWriter | undefined,
  request: FastifyRequest,
  letter: LetterWritingRequest,
): Promise<WrittenLetterBody> {
  if (!writer) return {};
  const sources = letterGateSources(letter);
  const review = (body: string): string[] => reviewLetterBody(body, sources).map((violation) => violation.rule);
  const input = writerInput(letter, review);
  if (!hasLetterInput(input)) return {};
  const providerStart = Date.now();
  const outcome = await withinTimeBudget(
    writer.writeCoverLetter(input),
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
  if (!outcome.body) return { refused: true };
  // A writer outside the queue answers here: nothing unchecked reaches the candidate.
  if (reviewLetterBody(outcome.body, sources).length > 0) return { refused: true };
  const factCheck = { ...checkGeneratedTextFacts(outcome.body, letter.facts), status: 'checked' as const };
  return { body: outcome.body, stage: outcome.stage, factCheck };
}
