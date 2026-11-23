import { convertAmount, type CurrencyRates } from '../../../../shared/currencyRates';
import type { VacancyFitTier } from '../../../../shared/vacancyFitPercent';
import { workFormatLabel } from '../../../../shared/vacancyWorkFormat';
import type { MatchedVacancyItem } from '../../coach/cabinetTypes';
import { compactPlaceLabel } from '../../vacancies/VacancyScreenRowCells';
import { formatCompensationCompact } from '../../vacancies/vacancyCompensation';
import { hasRemoteMark, vacancyRemoteLabel } from '../../vacancies/vacancyRemoteLabel';
import { vacancyFormat } from '../../vacancies/vacancyScreenCriteria';

/** Валюта показа денег: рубли, доллары, евро или «Как в вакансии». */
export type MoneyCurrency = 'RUB' | 'USD' | 'EUR' | 'AED' | 'ORIG';

export interface MoneyOptions {
  readonly currency: MoneyCurrency;
  readonly rates?: CurrencyRates;
}

export interface MoneyView {
  /** Полная строка: «≈ 545–636 тыс. ₽». */
  readonly text: string;
  /** Сумма без знака рубля — для ячейки, где «₽» стоит отдельным элементом. */
  readonly amount?: string;
  readonly unit?: string;
  /** Подсказка с исходной суммой и курсом — только у пересчитанных денег. */
  readonly title?: string;
}

const TIER_WORDS: Readonly<Record<VacancyFitTier, string>> = {
  hi: 'сильное',
  good: 'хорошее',
  mid: 'частичное',
  low: 'слабое',
};

export function fitTierWord(tier: VacancyFitTier): string {
  return TIER_WORDS[tier];
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (units === 1 && tens !== 11) return one;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

export function vacanciesWord(count: number): string {
  return pluralRu(count, 'вакансия', 'вакансии', 'вакансий');
}

function shortDate(date: Date, withYear: boolean): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'Europe/Moscow',
  }).format(date);
}

/** Дата по ISO-строке: «11.11», для другого года — «10.11.2025»; неверная — пусто. */
export function isoRowDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return shortDate(date, date.getUTCFullYear() !== now.getUTCFullYear());
}

/** Дата строки: «11.11», для другого года — «10.11.2025». */
export function rowDate(item: MatchedVacancyItem, now: Date = new Date()): string {
  const date = new Date(item.cluster.sources[0]?.observedAt ?? item.cluster.firstObservedAt);
  if (Number.isNaN(date.getTime())) return '';
  return shortDate(date, date.getUTCFullYear() !== now.getUTCFullYear());
}

/** Метки удалёнки макета: «Удалённо · везде», «Удалённо · только США». */
export function remoteLabel(cluster: {
  readonly canonicalLocation?: string;
  readonly isRemote: boolean;
  readonly remoteScope?: string;
}): string {
  const label = vacancyRemoteLabel(cluster);
  if (label === 'Удалённо из любой страны') return 'Удалённо · везде';
  return label.replace(/^Удалённо[,:]\s*/u, 'Удалённо · ');
}

export function rowGeo(item: MatchedVacancyItem): string {
  const { cluster } = item;
  if (cluster.isRemote && vacancyFormat(item) === 'remote') return remoteLabel(cluster);
  // B764: «Remote» в месте — подпись удалёнки по-русски, даже если формат указан иначе.
  if (hasRemoteMark(cluster.canonicalLocation)) return remoteLabel(cluster);
  if (cluster.canonicalLocation) return compactPlaceLabel(cluster.canonicalLocation);
  return cluster.isRemote ? 'Удалённо' : 'Не указана';
}

export function rowFormat(item: MatchedVacancyItem): string {
  return workFormatLabel(vacancyFormat(item)) ?? '';
}

function isRouble(currency: string | undefined): boolean {
  const code = (currency ?? '').trim().toUpperCase();
  return code === 'RUB' || code === 'RUR' || code === '₽';
}

function splitRouble(text: string): MoneyView {
  return text.endsWith(' ₽') ? { text, amount: text.slice(0, -2), unit: '₽' } : { text };
}

const RATE_SIGN: Readonly<Record<string, string>> = { USD: '$', EUR: '€', AED: 'AED' };

/** Курс ЦБ к рублю: доллар и евро всегда, дирхам — когда в нём показываем. */
function ratesNote(rates: CurrencyRates, target: MoneyCurrency): string {
  const [, month, day] = rates.date.split('-');
  const codes = target === 'AED' ? ['USD', 'EUR', 'AED'] : ['USD', 'EUR'];
  const pairs = codes
    .filter((code) => rates.rubPerUnit[code] !== undefined)
    .map((code) => {
      const rate = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(
        rates.rubPerUnit[code],
      );
      return `1 ${RATE_SIGN[code]} = ${rate} ₽`;
    });
  return `курс ЦБ на ${day}.${month}${pairs.length > 0 ? `: ${pairs.join(', ')}` : ''}`;
}

/** Деньги строки и карточки: в выбранной валюте по курсу ЦБ, без курса — как в вакансии. */
export function moneyView(item: MatchedVacancyItem, options: MoneyOptions): MoneyView {
  const salary = item.cluster.salary;
  const original = formatCompensationCompact(salary);
  if (!salary || (salary.from === undefined && salary.to === undefined)) return { text: original };
  const target = options.currency;
  const source = salary.currency ?? '';
  if (target === 'ORIG' || !source) return splitRouble(original);
  if (target === 'RUB' && isRouble(source)) return splitRouble(original);
  const from =
    salary.from === undefined ? undefined : convertAmount(salary.from, source, target, options.rates);
  const to =
    salary.to === undefined ? undefined : convertAmount(salary.to, source, target, options.rates);
  const missing =
    (salary.from !== undefined && from === undefined) ||
    (salary.to !== undefined && to === undefined);
  if (missing || !options.rates) return splitRouble(original);
  const converted = formatCompensationCompact({ ...salary, from, to, currency: target });
  if (converted === original) return splitRouble(original);
  return {
    ...splitRouble(`≈ ${converted}`),
    title: `В вакансии ${original}; ${ratesNote(options.rates, target)}`,
  };
}

/** Внешний адрес вакансии: в ссылку и буфер идут только http и https. */
export function safeHttpUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
