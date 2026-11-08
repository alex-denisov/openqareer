/**
 * SEO P2 (08.11): model-written intros of city × role lists are published only
 * after this gate. The model saw salary labels without their period, so every
 * sentence about money is dropped here and salary is printed by code from
 * period-proven ranges instead (one line per currency and period, never mixed).
 * Whatever number survives must exist in the list facts, or the intro is not
 * published at all.
 */

export type IntroSalaryPeriod = 'hour' | 'month' | 'year';

export interface IntroSalaryRange {
  readonly currency: string;
  readonly period: IntroSalaryPeriod;
  /** Vacancies with a closed range and a provider-proven period in this group. */
  readonly sample: number;
  /** Median of the lower ends and median of the upper ends. */
  readonly medianLow: number;
  readonly medianHigh: number;
}

export interface ListingIntro {
  readonly place: string;
  readonly role: string;
  /** ISO date of the data slice the text was written from. */
  readonly date: string;
  /** Vacancies of the list on that date. */
  readonly sample: number;
  readonly paragraphs: readonly string[];
  readonly salary: readonly IntroSalaryRange[];
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «2026-11-08» → «8 ноября 2026 года»; the model often left the ISO form. */
export function humanDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year} года`;
}

const MONEY =
  /зарплат|заработн|вилк|доход|оплат|\bплат[яиуеё]|плата|компенсац|финансов\S* услови|сколько платят|ставк|оклад|₽|\$|€|£|₸|\b(?:USD|EUR|RUB|KZT|BYR|BYN|CAD|KGS|UZS|GBP)\b|граница|деньг|диапазон|руб\./iu;

function sentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«(0-9])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Numbers as written, with thin/regular spaces inside thousands removed. */
export function numbersIn(text: string): string[] {
  return (
    text.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/gu, '$1').match(/\d+(?:[.,]\d+)?/gu) ?? []
  ).map((n) => n.replace(',', '.'));
}

export interface IntroGateResult {
  readonly paragraphs: readonly string[];
  /** Numbers left in the text that the facts do not contain. */
  readonly unknownNumbers: readonly string[];
  readonly words: number;
}

/**
 * Drops money sentences, rewrites ISO dates and lists numbers the facts cannot
 * back. `facts` is the list record the model was given, salary removed.
 */
export function gateIntro(intro: string, facts: unknown, date: string): IntroGateResult {
  const iso = new RegExp(date, 'gu');
  const paragraphs = intro
    .replace(iso, humanDate(date))
    .split(/\n{2,}/u)
    .map((paragraph) =>
      sentences(paragraph)
        .filter((sentence) => !MONEY.test(sentence))
        .join(' '),
    )
    .filter((paragraph) => paragraph.length > 0);
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  for (const part of humanDate(date).match(/\d+/gu) ?? []) allowed.add(part);
  allowed.add(`${date.slice(8)}.${date.slice(5, 7)}`);
  const unknownNumbers = paragraphs.flatMap(numbersIn).filter((n) => !allowed.has(n));
  const words = paragraphs.join(' ').split(/\s+/u).filter(Boolean).length;
  return { paragraphs, unknownNumbers, words };
}
