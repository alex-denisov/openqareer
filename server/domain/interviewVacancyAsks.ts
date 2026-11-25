import { INTERVIEW_ASK_MAX_CHARS, type InterviewAsk } from '../../shared/interviewAsks';
import { vacancyDutyIds } from './vacancyRequirementDuty';
import { isCompensationLine } from './vacancyRequirementKind';
import {
  extractVacancyRequirements,
  vacancySourceText,
  type RequirementKind,
  type VacancyRequirement,
} from './vacancyRequirements';

export const MAX_INTERVIEW_ASKS = 6;

/** Условие (офис, виза, диплом) — не повод для вопроса об опыте. */
const ASKABLE: ReadonlySet<RequirementKind> = new Set<RequirementKind>(['experience', 'other']);
const MIN_REQUIREMENT_CHARS = 3;
const MIN_SENTENCE_CHARS = 30;
const MAX_SENTENCE_CHARS = 400;
const BULLET = /^\s*(?:[-–—*•▪·]+|\d+[.)])\s*/u;
const SENTENCE_END = /(?<=[.!?;])\s+(?=[\p{Lu}\d«"“•–—-])/u;
const BOILERPLATE =
  /equal opportunit|regardless of|race|religion|disabilit|accommodation|benefits|salary|compensation|insurance|perks|privacy|cookie|apply now|мы предлагаем|зарплат|оклад|дмс|отпуск|откликайт|присоединяйт|join us|apply today|ignore (?:all |previous )?instructions|system prompt|игнорируй.*инструкц/iu;
/** Предложение о работе в роли, а не о компании. */
const DUTY_SENTENCE =
  /\byou(?:(?:'|’)ll| will)\b|\bresponsible for\b|\byour (?:team|role|mission)\b|^(?:lead|build|own|drive|design|develop|manage|define|partner|deliver|hire|mentor|scale|operate)\b|вы будете|вам предстоит|предстоит|отвечать за|будете/iu;
const EXPERIENCE_SENTENCE = /\b(?:experience|years|expertise|knowledge)\b|опыт|знани|умени|навык/iu;
/** Рассказ компании о себе и образ кандидата — не повод для вопроса. */
const COMPANY_SENTENCE =
  /^at \p{L}|\byour role isn(?:'|’)t\b|\b(?:(?:we are|we're)(?! (?:looking|seeking|hiring))|we look for|you don(?:'|’)t just|our (?:mission|culture|values))\b|мы —|наша компания|компани\p{L}* —/iu;
/** «OUR IDEAL CANDIDATE WILL HAVE: 10+ years…» — заголовок перед строкой. */
const INLINE_HEADING = /^[\p{Lu}\s'’,&-]{8,}[:：]\s*(?=\S)/u;

function tidy(text: string): string {
  const value = text
    .replace(BULLET, '')
    .replace(INLINE_HEADING, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\s.;,:]+$/u, '');
  if (value.length <= INTERVIEW_ASK_MAX_CHARS) return value;
  const cut = value.slice(0, INTERVIEW_ASK_MAX_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.;,:–—-]+$/u, '')}…`;
}

/** «Предстоит:», «Ключевые цели:» — задачи; разметка процента этих заголовков не меняется. */
const DUTY_LINE =
  /^[ \t]*(?:(?:вам )?предстоит|(?:ключевые |основные )?цели|вы будете)[ \t]*:[ \t]*$/gimu;
const withDutyHeadings = (text: string): string =>
  vacancySourceText(text).replace(DUTY_LINE, 'Обязанности:');

/** Снимок отклика бывает одной строкой: правила требований читают его по предложениям. */
function sentenceLines(description: string): readonly string[] {
  return vacancySourceText(description)
    .split('\n')
    .flatMap((line) => line.split(SENTENCE_END))
    .map((line) => line.trim())
    .filter(Boolean);
}

function askableRequirement(requirement: VacancyRequirement): boolean {
  const text = requirement.text.trim();
  return (
    requirement.origin !== 'inferred' &&
    ASKABLE.has(requirement.kind) &&
    text.length >= MIN_REQUIREMENT_CHARS &&
    !isCompensationLine(text) &&
    !BOILERPLATE.test(text)
  );
}

function sentenceAsks(lines: readonly string[]): readonly InterviewAsk[] {
  const usable = lines.filter(
    (line) =>
      line.length >= MIN_SENTENCE_CHARS &&
      line.length <= MAX_SENTENCE_CHARS &&
      !/[:：?]$/u.test(line) &&
      !BOILERPLATE.test(line) &&
      !COMPANY_SENTENCE.test(line.replace(BULLET, '')) &&
      !isCompensationLine(line),
  );
  const rank = (line: string): number => {
    const body = line.replace(BULLET, '');
    if (DUTY_SENTENCE.test(body)) return 0;
    return EXPERIENCE_SENTENCE.test(body) ? 1 : 2;
  };
  return [...usable]
    .sort((left, right) => rank(left) - rank(right))
    .map((line): InterviewAsk => ({ kind: 'text', text: tidy(line) }));
}

/** Задачи и требования вперемежку: вопросы не об одном списке. */
function interleave(
  first: readonly InterviewAsk[],
  second: readonly InterviewAsk[],
): readonly InterviewAsk[] {
  const length = Math.max(first.length, second.length);
  return Array.from({ length }, (_, index) => [first[index], second[index]])
    .flat()
    .filter((ask): ask is InterviewAsk => ask !== undefined);
}

/** Повтор — тот же текст или его часть: «более 3 лет управляет командой» уже есть в требовании целиком. */
function distinct(asks: readonly InterviewAsk[]): readonly InterviewAsk[] {
  return asks.reduce<readonly InterviewAsk[]>((kept, ask) => {
    const key = ask.text.toLocaleLowerCase('ru-RU');
    const repeated = kept.some((item) => {
      const other = item.text.toLocaleLowerCase('ru-RU');
      return other.includes(key) || (ask.kind === 'text' && key.includes(other));
    });
    return repeated || !key ? kept : [...kept, ask];
  }, []);
}

/**
 * B635: о чём вакансия спросит кандидата — её же словами. Требования, извлечённые моделью и
 * сверенные с текстом (B510, кэш по хешу описания), если они есть; иначе правила по тому же тексту.
 * Чего не хватает — строки описания. Описания нет — пусто, и вопросы остаются общими.
 */
export function interviewVacancyAsks(
  description: string,
  extracted: readonly VacancyRequirement[] = [],
): readonly InterviewAsk[] {
  if (!description.trim()) return [];
  const lines = sentenceLines(description);
  const text = lines.join('\n');
  const askable = extracted.filter(askableRequirement);
  const fromModel = askable.length > 0;
  const requirements = fromModel
    ? askable
    : extractVacancyRequirements({ vacancyId: 'interview', description: text }).requirements.filter(
        askableRequirement,
      );
  const dutyIds = vacancyDutyIds(withDutyHeadings(fromModel ? description : text), requirements);
  const ofKind = (kind: 'duty' | 'req') =>
    requirements
      .filter((item) => dutyIds.has(item.id) === (kind === 'duty'))
      .map((item): InterviewAsk => ({ kind, text: tidy(item.text) }));
  const named = interleave(ofKind('duty'), ofKind('req'));
  return distinct([...named, ...sentenceAsks(lines)]).slice(0, MAX_INTERVIEW_ASKS);
}
