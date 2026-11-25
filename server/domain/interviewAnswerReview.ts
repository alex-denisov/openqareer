/**
 * B681: разбор ответа тренировки для нового кабинета. Баллы и причины те же,
 * что у `scoreInterviewAnswer`, к каждому набравшему баллы критерию
 * добавляется цитата из ответа кандидата. Сохранённая оценка старых маршрутов
 * не меняется: этот разбор считается на чтении и нигде не записывается.
 */
import {
  CASE_CRITERIA,
  RUBRIC_CRITERIA,
  scoreInterviewAnswer,
  type InterviewAnswerEvaluation,
  type InterviewQuestionType,
} from './interviewSimulator';
import {
  isResumeEvidenceEligible,
  type ResumeEvidenceCandidate,
} from './resumeEvidenceEligibility';
import type { TrainingCase } from './trainingCase';

export const QUOTE_LIMIT = 200;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/gu;

export interface QuotedCriterion {
  readonly points: 0 | 1 | 2;
  readonly reason: string;
  readonly quote?: string;
}

export interface QuotedAnswerEvaluation extends Omit<InterviewAnswerEvaluation, 'criteria'> {
  readonly criteria: Readonly<Record<string, QuotedCriterion>>;
}

export interface AnswerNumberCheck {
  readonly value: string;
  readonly matchedFactId: string | null;
  readonly matchedFactStatement: string | null;
}

function sentencesOf(answer: string): string[] {
  return answer
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function capQuote(sentence: string): string {
  return sentence.length <= QUOTE_LIMIT
    ? sentence
    : `${sentence.slice(0, QUOTE_LIMIT - 1).trimEnd()}…`;
}

/** Предложение ответа (в исходном регистре) с первым найденным признаком или null. */
export function quoteFor(answer: string, cues: readonly (string | RegExp)[]): string | null {
  const sentences = sentencesOf(answer);
  for (const cue of cues) {
    const found = sentences.find((sentence) =>
      typeof cue === 'string'
        ? `${sentence.toLocaleLowerCase('ru-RU')} `.includes(cue)
        : cue.test(sentence),
    );
    if (found) return capQuote(found);
  }
  return null;
}

export function scoreInterviewAnswerWithQuotes(
  answer: string,
  type: InterviewQuestionType,
  caseKind: TrainingCase = 'system',
): QuotedAnswerEvaluation {
  const definitions =
    type === 'system_design' && caseKind !== 'system' ? CASE_CRITERIA : RUBRIC_CRITERIA[type];
  const plain = scoreInterviewAnswer(answer, type, definitions);
  const cuesOf = new Map<string, readonly (string | RegExp)[]>(
    definitions.map(([name, cues, details]) => [name, [...cues, ...details]]),
  );
  const criteria = Object.fromEntries(
    Object.entries(plain.criteria).map(([name, criterion]) => {
      if (criterion.points === 0) return [name, criterion];
      const cues = [...(cuesOf.get(name) ?? []), /\d/u];
      const quote = quoteFor(answer, cues);
      return [name, quote ? { ...criterion, quote } : criterion];
    }),
  );
  return { ...plain, criteria };
}

function normalizeNumber(value: string): string {
  return value.replace(',', '.');
}

function numbersIn(text: string): string[] {
  return text.match(NUMBER_PATTERN) ?? [];
}

/** Числа из ответа и подтверждённый факт профиля, где стоит то же число. */
export function checkAnswerNumbers(
  answer: string,
  facts: readonly ResumeEvidenceCandidate[],
): AnswerNumberCheck[] {
  const confirmed = facts
    .filter(isResumeEvidenceEligible)
    .map((fact) => ({ fact, numbers: new Set(numbersIn(fact.statement).map(normalizeNumber)) }));
  const seen = new Set<string>();
  return numbersIn(answer).flatMap((value) => {
    const normalized = normalizeNumber(value);
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    const match = confirmed.find((entry) => entry.numbers.has(normalized))?.fact ?? null;
    return [
      { value, matchedFactId: match?.id ?? null, matchedFactStatement: match?.statement ?? null },
    ];
  });
}
