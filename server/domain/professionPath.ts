import type { CurrencyRates } from '../../shared/currencyRates';
import { monthlyRubSalary } from '../../shared/monthlyRubSalary';
import { MAX_VACANCY_AGE_DAYS } from '../vacancies/vacancyPoolQuery';
import { rulesParse } from '../vacancies/titleParse/rulesParse';

/**
 * B669: путь в новую профессию для «Меняю профессию». Вилка дохода и отклики
 * по целевой профессии считаются из того, что уже есть: подборки по роли и
 * откликов кандидата. Нового расчёта рынка здесь нет.
 */

/** Меньше вакансий с зарплатой — вилку не показываем, только «мало данных». */
export const MIN_PROFESSION_WAGE_SAMPLE = 8;
export const LOWER_INCOME_ANSWERS = ['yes', 'no', 'depends'] as const;
export type LowerIncomeAnswer = (typeof LOWER_INCOME_ANSWERS)[number];

export interface WageVacancy {
  readonly roleMatch: string;
  readonly status: string;
  readonly observedAt: readonly string[];
  readonly salary?: {
    readonly from?: number;
    readonly to?: number;
    readonly currency?: string;
    readonly period?: 'hour' | 'month' | 'year';
  };
}

export type ProfessionWage =
  | {
      readonly state: 'ready';
      readonly min: number;
      readonly max: number;
      readonly sampleSize: number;
      readonly observedAt: string;
    }
  | { readonly state: 'thin'; readonly sampleSize: number };

const DAY_MS = 86_400_000;

function freshObservation(item: WageVacancy, now: Date): string | undefined {
  const cutoff = now.getTime() - MAX_VACANCY_AGE_DAYS * DAY_MS;
  return item.observedAt
    .filter((at) => {
      const time = Date.parse(at);
      return Number.isFinite(time) && time >= cutoff && time <= now.getTime();
    })
    .sort()
    .at(-1);
}

/** Вилка профессии: нижний квартиль нижних границ и верхний квартиль верхних, ₽ в месяц. */
export function professionWage(
  items: readonly WageVacancy[],
  now: Date,
  rates: CurrencyRates | undefined,
): ProfessionWage {
  const paid = items.flatMap((item) => {
    if (item.roleMatch !== 'target' || item.status !== 'active' || !item.salary) return [];
    const observedAt = freshObservation(item, now);
    const monthly = observedAt ? monthlyRubSalary(item.salary, rates) : undefined;
    const low = monthly?.from ?? monthly?.to;
    const high = monthly?.to ?? monthly?.from;
    return low && high && observedAt ? [{ low, high, observedAt }] : [];
  });
  if (paid.length < MIN_PROFESSION_WAGE_SAMPLE) return { state: 'thin', sampleSize: paid.length };
  const lows = paid.map((entry) => entry.low).sort((a, b) => a - b);
  const highs = paid.map((entry) => entry.high).sort((a, b) => a - b);
  const last = paid.length - 1;
  return {
    state: 'ready',
    min: lows[Math.floor(last * 0.25)]!,
    max: highs[Math.ceil(last * 0.75)]!,
    sampleSize: paid.length,
    observedAt: paid
      .map((entry) => entry.observedAt)
      .sort()
      .at(-1)!,
  };
}

export interface ResponseView {
  readonly vacancyTitle: string | undefined;
  readonly stage: string;
  /** Отклик отправляли: не просто сохранённая вакансия. */
  readonly applied: boolean;
}

const INVITED = new Set(['interview', 'offer']);

function functionOf(title: string | undefined): string | null {
  if (!title?.trim()) return null;
  const [code] = rulesParse(title).functions;
  return code && code !== 'other' ? code : null;
}

/** Отклики в целевой профессии: та же функция по названию вакансии, что у профессии. */
export function professionResponses(
  views: readonly ResponseView[],
  target: string,
): { readonly sent: number; readonly invited: number } {
  const code = functionOf(target);
  if (!code) return { sent: 0, invited: 0 };
  const mine = views.filter((view) => view.applied && functionOf(view.vacancyTitle) === code);
  return { sent: mine.length, invited: mine.filter((view) => INVITED.has(view.stage)).length };
}
