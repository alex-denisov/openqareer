import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';

/** B788: что именно спрашивает вопрос о деньгах — валюта, период и до или после налогов. */
export interface SalaryAsk {
  readonly currency?: string;
  readonly period?: 'hour' | 'month' | 'year';
  readonly basis?: 'gross' | 'net';
}

const SALARY_QUESTION =
  /доход|зарплат|оклад|вознагражд|компенсац|salary|compensation|pay expectation|salarial|gehalt/iu;
/** Не ожидания: нынешняя зарплата, согласие с названной вилкой, премии. */
const NOT_EXPECTED =
  /current|previous|\blast\b|history|present salary|текущ|нынешн|последн|прошл|прежн|сейчас|comfortable|does (this|that|it|the)|are you (ok|fine|aligned|open)|within|align|agree|устраива|устроит|подходит|bonus|equity|бонус|преми|benefit|total compensation|relocation|переезд/iu;

const CURRENCIES: readonly (readonly [RegExp, string])[] = [
  [/₽|руб|\bRU[BR]\b/iu, 'RUB'],
  [/€|\beur(os?)?\b|евро(?!п)/iu, 'EUR'],
  [/£|\bGBP\b|pounds/iu, 'GBP'],
  [/zł|\bPLN\b|złot/iu, 'PLN'],
  [/₸|\bKZT\b|тенге/iu, 'KZT'],
  [/\bAED\b|dirham/iu, 'AED'],
  [/\bCAD\b|C\$|CA\$/u, 'CAD'],
  [/\bUSD\b|US\$|(?<![A-Z])\$|доллар|dollars?/iu, 'USD'],
];
const PERIODS: readonly (readonly [RegExp, NonNullable<SalaryAsk['period']>])[] = [
  [/annual|yearly|per (year|annum)|\/ ?(year|yr)|годов|в год/iu, 'year'],
  [/month|в месяц|ежемесячн|месячн/iu, 'month'],
  [/hourly|per hour|\/ ?(hour|hr)|в час|почасов/iu, 'hour'],
];
const GROSS = /\bgross\b|before tax|до вычета|брутто|до налог/iu;
const NET = /\bnet\b|after tax|take.?home|на руки|нетто|после (вычета|налог)/iu;

const matches = <T>(list: readonly (readonly [RegExp, T])[], text: string): readonly T[] =>
  list.flatMap(([pattern, value]) => (pattern.test(text) ? [value] : []));

export function isSalaryExpectation(question: QuestionnaireQuestion): boolean {
  return (
    question.kind === 'text' &&
    SALARY_QUESTION.test(question.text) &&
    !NOT_EXPECTED.test(question.text)
  );
}

/** `null` — вопрос называет две валюты, два периода или обе налоговые базы: ответ за кандидатом. */
export function salaryAsk(question: QuestionnaireQuestion): SalaryAsk | null {
  if (!isSalaryExpectation(question)) return null;
  const currencies = matches(CURRENCIES, question.text);
  const periods = matches(PERIODS, question.text);
  const gross = GROSS.test(question.text);
  const net = NET.test(question.text);
  if (currencies.length > 1 || periods.length > 1 || (gross && net)) return null;
  return {
    ...(currencies[0] ? { currency: currencies[0] } : {}),
    ...(periods[0] ? { period: periods[0] } : {}),
    ...(gross ? { basis: 'gross' as const } : {}),
    ...(net ? { basis: 'net' as const } : {}),
  };
}
