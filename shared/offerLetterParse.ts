/**
 * B646: разбор текста письма с оффером на устройстве кандидата.
 * Без модели и без сервера: текст письма никуда не уходит. Разбор
 * осторожный — заполняет поле, только когда в письме нет двусмысленности
 * (вилка зарплаты, разовый бонус при подписании и т. п. пропускаются).
 */

export type ParsedOfferCurrency = 'RUB' | 'USD' | 'EUR';
export type ParsedOfferFormat = 'remote' | 'hybrid' | 'office';

export interface ParsedOfferLetter {
  readonly baseSalary?: number;
  readonly salaryPeriod?: 'month' | 'year';
  readonly currency?: ParsedOfferCurrency;
  readonly net?: boolean;
  readonly probationPeriodMonths?: number;
  readonly probationSalary?: number;
  readonly bonus?: number;
  readonly format?: ParsedOfferFormat;
  readonly benefits?: readonly string[];
  readonly startDate?: string;
  readonly respondBy?: string;
}

interface Money {
  readonly amount: number;
  readonly currency: ParsedOfferCurrency;
  readonly index: number;
}

interface Base {
  readonly amount: number;
  readonly period: 'month' | 'year';
  readonly currency: ParsedOfferCurrency;
  readonly net?: boolean;
}

const NUM = String.raw`\d{1,3}(?:[ \u00a0\u202f,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?`;
const MULT = String.raw`\s*(?<mult>k|K|тыс\.?|млн\.?|million|mln)(?![a-zа-яё])`;
const CUR_AFTER = String.raw`\s*(?<post>₽|руб(?:\.|л[а-яё]*)?|RUB|USD|EUR|евро|долл[а-яё]*|\$|€)`;
const MONEY_RE = new RegExp(
  String.raw`(?:(?<pre>\$|€|₽|USD|EUR|RUB)\s*)?(?<num>${NUM})(?:${MULT})?(?:${CUR_AFTER})?`,
  'giu',
);

const BONUS_RE = /прем|бонус|bonus/iu;
const ONE_TIME_RE = /sign-on|signing|welcome|one-time|разов|приветствен|подъ[её]мн/iu;
const PROBATION_RE = /испытательн|probation/iu;
const RANGE_RE =
  /(?:^|\s)от\s+\d[\d\s]*.{0,20}?\sдо\s+\d|вилк|\brange\b|\bbetween\b|\d\s*[–—]\s*\d/iu;
const YEAR_RE = /в год|годов|\bper year\b|\bannual|\bannually\b|\/year|\bp\.a\./iu;
const NET_RE = /на руки|чистыми|после (?:вычета|налог)|\bnet\b/iu;
const GROSS_RE = /до (?:вычета|налог|уплаты)|\bgross\b|брутто/iu;
const START_RE = /выход|приступ|начало работы|\bstart|first day/iu;
const RESPOND_RE = /ответ|\brespond|\breply|let us know|\bconfirm|\bdecision|срок ответа/iu;
const BENEFIT_RE =
  /дмс|страхов|спорт|фитнес|обучени|пенси|компенсац|benefit|insurance|\bgym\b|401\(k\)|pension|wellness/iu;

const WORD_MONTHS: Readonly<Record<string, number>> = {
  один: 1,
  одного: 1,
  два: 2,
  двух: 2,
  три: 3,
  трёх: 3,
  трех: 3,
  четыре: 4,
  четырёх: 4,
  пять: 5,
  шесть: 6,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

function toNumber(raw: string): number {
  if (/^\d{1,3}(?:[ \u00a0\u202f,]\d{3})+$/u.test(raw)) return Number(raw.replace(/\D/gu, ''));
  return Number(raw.replace(',', '.'));
}

function currencyOf(symbol: string | undefined): ParsedOfferCurrency | null {
  if (!symbol) return null;
  const value = symbol.toLowerCase();
  if (value === '$' || value === 'usd' || value.startsWith('долл')) return 'USD';
  if (value === '€' || value === 'eur' || value === 'евро') return 'EUR';
  return 'RUB';
}

function multiplierOf(mult: string | undefined): number {
  if (!mult) return 1;
  return /^(?:млн|million|mln)/iu.test(mult) ? 1_000_000 : 1_000;
}

/** Суммы с валютой или множителем («тыс.», «млн», «k»). Голое число деньгами не считается. */
function findMoney(sentence: string): Money[] {
  const found: Money[] = [];
  for (const match of sentence.matchAll(MONEY_RE)) {
    const groups = match.groups ?? {};
    const currency = currencyOf(groups.pre ?? groups.post);
    if (!currency && !groups.mult) continue;
    if (!currency && !/[а-яё]/iu.test(sentence)) continue;
    const amount = Math.round(toNumber(groups.num ?? '') * multiplierOf(groups.mult));
    if (Number.isFinite(amount) && amount > 0) {
      found.push({ amount, currency: currency ?? 'RUB', index: match.index ?? 0 });
    }
  }
  return found;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ0-9$€₽])/u)
    .map((part) => part.trim().replace(/[.!?]+$/u, ''))
    .filter(Boolean);
}

function bonusIndex(sentence: string): number {
  const match = BONUS_RE.exec(sentence);
  return match ? match.index : sentence.length;
}

function findBase(sentences: readonly string[]): Base | null {
  for (const sentence of sentences) {
    if (PROBATION_RE.test(sentence) || RANGE_RE.test(sentence)) continue;
    const cut = bonusIndex(sentence);
    const money = findMoney(sentence).find((item) => item.index < cut);
    if (!money) continue;
    const segment = sentence.slice(0, cut);
    const net = NET_RE.test(segment) ? true : GROSS_RE.test(segment) ? false : undefined;
    const period = YEAR_RE.test(segment) ? 'year' : 'month';
    return {
      amount: money.amount,
      period,
      currency: money.currency,
      ...(net === undefined ? {} : { net }),
    };
  }
  return null;
}

function bonusFrom(segment: string, base: Base | null): number | undefined {
  const monthly = base ? (base.period === 'year' ? base.amount / 12 : base.amount) : null;
  const percent = /(\d+(?:[.,]\d+)?)\s*%/u.exec(segment);
  if (percent)
    return monthly === null
      ? undefined
      : Math.round((monthly * 12 * toNumber(percent[1] ?? '')) / 100);
  const salaries = /(\d+(?:[.,]\d+)?)\s*(?:оклад|monthly salar|salaries)/iu.exec(segment);
  if (salaries)
    return monthly === null ? undefined : Math.round(monthly * toNumber(salaries[1] ?? ''));
  return findMoney(segment)[0]?.amount;
}

function findBonus(sentences: readonly string[], base: Base | null): number | undefined {
  for (const sentence of sentences) {
    if (!BONUS_RE.test(sentence) || ONE_TIME_RE.test(sentence) || RANGE_RE.test(sentence)) continue;
    const value = bonusFrom(sentence.slice(bonusIndex(sentence)), base);
    if (value !== undefined) return value;
  }
  return undefined;
}

function probationMonths(sentence: string): number | undefined {
  const match = /(\d{1,2}|[а-яёa-z]+)[\s-]*(?:месяц|мес\.|month)/iu.exec(sentence);
  if (!match?.[1]) return undefined;
  const raw = match[1].toLowerCase();
  const months = /^\d+$/u.test(raw) ? Number(raw) : WORD_MONTHS[raw];
  return months !== undefined && months >= 1 && months <= 12 ? months : undefined;
}

function findProbation(
  sentences: readonly string[],
): Pick<ParsedOfferLetter, 'probationPeriodMonths' | 'probationSalary'> {
  const sentence = sentences.find((item) => PROBATION_RE.test(item));
  if (!sentence) return {};
  const months = probationMonths(sentence);
  const salary = RANGE_RE.test(sentence) ? undefined : findMoney(sentence)[0]?.amount;
  return {
    ...(months === undefined ? {} : { probationPeriodMonths: months }),
    ...(salary === undefined ? {} : { probationSalary: salary }),
  };
}

function findFormat(text: string): ParsedOfferFormat | undefined {
  if (/гибрид|hybrid/iu.test(text)) return 'hybrid';
  if (/удал[её]нн|удал[её]нк|удал[её]нно|дистанц|\bremote\b|из дома/iu.test(text)) return 'remote';
  if (/офис|\bon-?site\b|\bin[- ]office\b|\boffice\b/iu.test(text)) return 'office';
  return undefined;
}

const RU_MONTH_RE =
  /(\d{1,2})\s+(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*(?:\s+(\d{4}))?/iu;
const RU_MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'ма',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];
const EN_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const EN_MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const EN_MD_RE = new RegExp(
  String.raw`\b${EN_MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`,
  'iu',
);
const EN_DM_RE = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${EN_MONTH}(?:,?\s+(\d{4}))?`,
  'iu',
);
const NUMERIC_DATE_RE = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/u;

function isoDate(day: number, month: number, year: number | null, now: Date): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let resolved = year ?? now.getUTCFullYear();
  if (year === null && Date.UTC(resolved, month - 1, day) < today) resolved += 1;
  const date = new Date(Date.UTC(resolved, month - 1, day));
  if (date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

function findDate(sentence: string, now: Date): string | undefined {
  const year = (raw: string | undefined) => (raw ? Number(raw) : null);
  const ru = RU_MONTH_RE.exec(sentence);
  if (ru) {
    const month =
      RU_MONTHS.findIndex((prefix) => (ru[2] ?? '').toLowerCase().startsWith(prefix)) + 1;
    return isoDate(Number(ru[1]), month, year(ru[3]), now);
  }
  const md = EN_MD_RE.exec(sentence);
  if (md)
    return isoDate(
      Number(md[2]),
      EN_MONTHS.indexOf((md[1] ?? '').toLowerCase()) + 1,
      year(md[3]),
      now,
    );
  const dm = EN_DM_RE.exec(sentence);
  if (dm)
    return isoDate(
      Number(dm[1]),
      EN_MONTHS.indexOf((dm[2] ?? '').toLowerCase()) + 1,
      year(dm[3]),
      now,
    );
  const numeric = NUMERIC_DATE_RE.exec(sentence);
  if (numeric) return isoDate(Number(numeric[1]), Number(numeric[2]), year(numeric[3]), now);
  return undefined;
}

function findDates(
  sentences: readonly string[],
  now: Date,
): Pick<ParsedOfferLetter, 'startDate' | 'respondBy'> {
  let startDate: string | undefined;
  let respondBy: string | undefined;
  for (const sentence of sentences) {
    if (!startDate && START_RE.test(sentence)) startDate = findDate(sentence, now);
    else if (!respondBy && RESPOND_RE.test(sentence)) respondBy = findDate(sentence, now);
  }
  return { ...(startDate ? { startDate } : {}), ...(respondBy ? { respondBy } : {}) };
}

function findBenefits(sentences: readonly string[]): readonly string[] {
  const items: string[] = [];
  for (const sentence of sentences) {
    const listed = /^(?:benefits|perks|бенефиты|льготы|соцпакет)\s*[:—-]\s*(.+)$/iu.exec(sentence);
    const body = listed?.[1] ?? (BENEFIT_RE.test(sentence) ? sentence : null);
    if (!body || findMoney(body).length > 0 || PROBATION_RE.test(body) || BONUS_RE.test(body))
      continue;
    const parts = body.split(/\s*[,;]\s*(?:and\s+)?|\s+(?:и|and)\s+/iu).map((part) => part.trim());
    items.push(...parts.filter(Boolean));
  }
  return items;
}

/** Условия оффера из текста письма; поле без уверенного значения не заполняется. */
export function parseOfferLetter(text: string, now: Date): ParsedOfferLetter {
  const sentences = splitSentences(text);
  const base = findBase(sentences);
  const bonus = findBonus(sentences, base);
  const format = findFormat(text);
  const benefits = findBenefits(sentences);
  return {
    ...(base
      ? {
          baseSalary: base.amount,
          salaryPeriod: base.period,
          currency: base.currency,
          ...(base.net === undefined ? {} : { net: base.net }),
        }
      : {}),
    ...findProbation(sentences),
    ...(bonus === undefined ? {} : { bonus }),
    ...(format ? { format } : {}),
    ...(benefits.length > 0 ? { benefits } : {}),
    ...findDates(sentences, now),
  };
}
