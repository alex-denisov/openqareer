import type {
  QuestionnaireQuestion,
  QuestionnaireSuggestion,
} from '../../shared/applicationQuestionnaire';
import { convertAmount, currencyCode, type CurrencyRates } from '../../shared/currencyRates';
import {
  MIN_SALARY_MARKET_SAMPLE,
  type SalaryMarketSnapshot,
} from '../../shared/salaryMarketSnapshot';
import { pluralRu } from '../../shared/pluralRu';
import { periodOfEvidence } from '../../shared/vacancySalaryPeriod';
import { salaryGeography } from '../salaryMarket/salaryMarketGeography';
import { classifySalaryMarketTitle } from '../salaryMarket/salaryMarketClassification';
import { salaryAsk, type SalaryAsk } from './salaryQuestion';
import type { VacancySalary } from './unifiedVacancy';

/**
 * B788: ответ на обязательный вопрос о зарплате, когда кандидат ожиданий не назвал. Сначала вилка
 * самой вакансии, затем готовый расчёт роли по рынку. Без периода, выборки и даты цифры нет.
 */
export interface SalaryVacancy {
  readonly title: string;
  readonly location: string | null;
  readonly isRemote: boolean;
  readonly salary?: VacancySalary;
  readonly sourceName?: string;
  readonly observedAt?: string;
}

export interface SalaryMarketInput {
  readonly vacancy: SalaryVacancy;
  readonly readSnapshot: (role: string) => SalaryMarketSnapshot | null;
  readonly rates?: CurrencyRates;
}

type Period = 'hour' | 'month' | 'year';
interface Figure {
  readonly amount: number;
  readonly currency: string;
  readonly period: Period | null;
  readonly basis: 'gross' | 'net' | 'unknown';
  readonly source: string;
}

const MONTHS = 12;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SIGNS: Readonly<Record<string, string>> = { RUB: '₽', USD: '$', EUR: '€', GBP: '£' };
const PERIOD_WORDS: Readonly<Record<Period, readonly [ru: string, en: string]>> = {
  hour: ['в час', 'per hour'],
  month: ['в месяц', 'per month'],
  year: ['в год', 'per year'],
};
const BASIS_WORDS = { gross: ['до вычета налогов', 'gross'], net: ['на руки', 'net'] } as const;

const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');
const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(EURO.map((code) => [code, 'EUR'])),
  RU: 'RUB',
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  PL: 'PLN',
  KZ: 'KZT',
  BY: 'BYN',
  UZ: 'UZS',
  KG: 'KGS',
};

const CODES: Readonly<Record<string, string>> = { BYR: 'BYN' };
const codeOf = (currency: string): string => {
  const code = currencyCode(currency);
  return CODES[code] ?? code;
};
const money = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
    .format(value)
    .replace(/\p{Zs}/gu, ' ');
const signOf = (currency: string): string => SIGNS[currency] ?? currency;
const round = (value: number): number =>
  value >= 10_000 ? Math.round(value / 1000) * 1000 : Math.round(value);
const dateOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });

const fresh = (iso: string, now: number): boolean => {
  const at = Date.parse(iso);
  return Number.isFinite(at) && now - at <= MAX_AGE_MS;
};

const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

/** Вилка вакансии: середина «от — до» или единственная названная граница. */
function vacancyFigure({ salary, sourceName, observedAt }: SalaryVacancy): Figure | null {
  if (!salary?.currency || !observedAt || !sourceName) return null;
  const { from, to } = salary;
  if (positive(from) && positive(to) && to < from) return null;
  const bounds = [from, to].filter(positive);
  if (bounds.length === 0) return null;
  const currency = codeOf(salary.currency);
  const period = periodOfEvidence(salary.periodEvidence) ?? null;
  const proven = period !== null && period === salary.period ? period : null;
  const [first] = bounds;
  const prefix = positive(from) ? 'от ' : 'до ';
  const span =
    bounds.length > 1 ? `${money(first!)}–${money(bounds[1]!)}` : `${prefix}${money(first!)}`;
  const per = proven ? ` ${PERIOD_WORDS[proven][0]}` : '';
  return {
    amount: round(bounds.reduce((sum, value) => sum + value, 0) / bounds.length),
    currency,
    period: proven,
    basis: salary.gross === true ? 'gross' : salary.gross === false ? 'net' : 'unknown',
    source: `Вилка вакансии ${span} ${signOf(currency)}${per}, ${sourceName}, ${dateOf(observedAt)}`,
  };
}

interface MarketGroup {
  readonly currency: string;
  readonly period: Period;
  readonly basis: 'gross' | 'net' | 'unknown';
  readonly sample: number;
  readonly amount: number;
}

function groupsOf(salary: SalaryMarketSnapshot['salary'] | undefined): readonly MarketGroup[] {
  if (salary?.status !== 'available') return [];
  return salary.groups.map((group) => ({
    currency: codeOf(group.currency),
    period: group.period,
    basis: group.taxBasis,
    sample: group.sampleSize,
    amount: round((group.lower.p50 + group.upper.p50) / 2),
  }));
}

/** Рынок вакансии: страна по её валюте; удалёнка без страны — срез удалённых вакансий. */
function marketGroups(
  snapshot: SalaryMarketSnapshot,
  grade: string,
  vacancy: SalaryVacancy,
): { readonly groups: readonly MarketGroup[]; readonly market: string } | null {
  const country = salaryGeography(vacancy.location, vacancy.isRemote).countryCode;
  if (country) {
    const currency = COUNTRY_CURRENCY[country];
    const scope =
      grade === 'unknown'
        ? snapshot.salary
        : snapshot.gradeSlices?.find((slice) => slice.grade === grade)?.salary;
    const groups = groupsOf(scope).filter((group) => group.currency === currency);
    return { groups, market: `вакансии с зарплатой в ${currency ?? ''}` };
  }
  if (!vacancy.isRemote || grade !== 'unknown') return null;
  const slice = snapshot.locationSlices?.find((item) => item.location === 'remote');
  return { groups: groupsOf(slice?.salary), market: 'удалённые вакансии' };
}

function usable(group: MarketGroup, ask: SalaryAsk): boolean {
  return (
    group.sample >= MIN_SALARY_MARKET_SAMPLE &&
    (!ask.currency || ask.currency === group.currency) &&
    (!ask.basis || ask.basis === group.basis) &&
    (!ask.period ||
      ask.period === group.period ||
      (ask.period !== 'hour' && group.period !== 'hour'))
  );
}

function marketFigure(input: SalaryMarketInput, ask: SalaryAsk, now: number): Figure | null {
  const title = classifySalaryMarketTitle(input.vacancy.title, null);
  if (title.profession.kind !== 'b267') return null;
  const snapshot = input.readSnapshot(title.role);
  if (!snapshot || !fresh(snapshot.updatedAt, now)) return null;
  const scope = marketGroups(snapshot, title.grade.grade, input.vacancy);
  // Почасовая ставка — только когда о ней спросили: иначе она встала бы вместо оклада.
  const [best] = (scope?.groups ?? [])
    .filter((group) => usable(group, ask) && (ask.period === 'hour' || group.period !== 'hour'))
    .sort((a, b) => b.sample - a.sample);
  if (!best || !scope) return null;
  const noun = pluralRu(best.sample, ['вилка', 'вилки', 'вилок']);
  return {
    ...best,
    source: `Рынок: ${title.roleLabel}, ${scope.market}, ${noun}, каталог OpenQareer, ${dateOf(snapshot.updatedAt)}`,
  };
}

function inPeriod(amount: number, from: Period | null, to: Period | undefined): number | null {
  if (!to || from === to) return amount;
  if (from === 'year' && to === 'month') return amount / MONTHS;
  if (from === 'month' && to === 'year') return amount * MONTHS;
  return null;
}

function answerText(
  figure: Figure,
  ask: SalaryAsk,
  question: QuestionnaireQuestion,
  rates: CurrencyRates | undefined,
): { readonly text: string; readonly source: string } | null {
  if (ask.basis && ask.basis !== figure.basis) return null;
  const perAsked = inPeriod(figure.amount, figure.period, ask.period);
  const currency = ask.currency ?? figure.currency;
  const converted = currency !== figure.currency;
  const amount =
    perAsked === null ? undefined : convertAmount(perAsked, figure.currency, currency, rates);
  if (!positive(amount)) return null;
  const period = ask.period ?? figure.period;
  const note = converted && rates ? `, курс ЦБ на ${dateOf(rates.date)}` : '';
  const source = `${figure.source}${note}`;
  if (question.numeric) return { text: String(round(amount)), source };
  const language = /\p{Script=Cyrillic}/u.test(question.text) ? 0 : 1;
  const basis = figure.basis === 'unknown' ? null : BASIS_WORDS[figure.basis][language];
  const text = [
    `${money(round(amount))} ${language === 0 ? signOf(currency) : currency}`,
    period ? PERIOD_WORDS[period][language] : null,
    basis,
  ];
  return { text: text.filter(Boolean).join(' '), source };
}

export function salaryMarketAnswers(
  questions: readonly QuestionnaireQuestion[],
  input: SalaryMarketInput | undefined,
  now: number = Date.now(),
): readonly QuestionnaireSuggestion[] {
  if (!input) return [];
  return questions.flatMap((question) => {
    const ask = question.required ? salaryAsk(question) : null;
    if (!ask) return [];
    const own = vacancyFigure(input.vacancy);
    const answer =
      (own && answerText(own, ask, question, input.rates)) ??
      (() => {
        const market = marketFigure(input, ask, now);
        return market && answerText(market, ask, question, input.rates);
      })();
    return answer ? [{ questionId: question.id, ...answer, live: true as const }] : [];
  });
}
