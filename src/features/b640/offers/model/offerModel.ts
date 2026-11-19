import type { B640OfferView } from '../../../../../shared/b640Offers';
import {
  convertAmount,
  sameCurrency,
  type CurrencyRates,
} from '../../../../../shared/currencyRates';
import type {
  ApplicationOfferTerms,
  StoredApplicationOffer,
} from '../../../../../server/data/sqliteApplicationOfferRepository';
import type { ApplicationView } from '../../../applications/applicationsApi';

/** Оффер на экране «Офферы»: отклик, условия и выбор кандидата (B680). */
export interface OfferCard {
  readonly applicationId: string;
  readonly company: string;
  readonly title: string;
  readonly terms: ApplicationOfferTerms;
  readonly respondBy: string | null;
  readonly view: B640OfferView;
}

/** Валюта сравнения: рубли, доллары, евро или как в вакансии. */
export type CurrencyChoice = 'RUB' | 'USD' | 'EUR' | 'ORIG';

export interface SalaryFloor {
  readonly amount: number;
  readonly currency: string;
}

export interface PayText {
  readonly text: string;
  /** Сумма до налога: в ячейке нужна ссылка «Указать налог». */
  readonly needsTax: boolean;
}

export interface ConditionRow {
  readonly label: string;
  readonly cells: readonly string[];
}

const NO_COMPANY = 'Компания не указана';
const NOT_SET = 'не указан';
const SIGNS: Readonly<Record<string, string>> = {
  RUB: '₽',
  RUR: '₽',
  '₽': '₽',
  USD: '$',
  EUR: '€',
};
const FORMATS: Readonly<Record<string, string>> = {
  remote: 'Удалённо',
  hybrid: 'Гибрид',
  office: 'Офис',
};

function sign(currency: string): string {
  return SIGNS[currency.trim().toUpperCase()] ?? currency.trim().toUpperCase();
}

function number(value: number, digits: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}

/** «520 тыс. ₽», «6,5 тыс. $», «1,25 млн €» — как в макете o06. */
export function formatMoney(amount: number, currency: string): string {
  const unit = sign(currency);
  if (amount >= 1_000_000) return `${number(amount / 1_000_000, 2)} млн ${unit}`;
  if (amount >= 1_000) {
    const thousands = amount / 1_000;
    return `${number(thousands, thousands >= 100 ? 0 : 1)} тыс. ${unit}`;
  }
  return `${number(amount, 0)} ${unit}`;
}

/** Число без сокращений: «6 700 000 ₽» в расчёте дохода. */
export function formatFullMoney(amount: number, currency: string): string {
  return `${number(Math.round(amount), 0)} ${sign(currency)}`;
}

function plural(count: number, forms: readonly [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «14 ноября» из даты `YYYY-MM-DD` (или начала ISO-строки); чужой текст — как есть. */
export function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value.trim() || null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function byDeadline(a: OfferCard, b: OfferCard): number {
  if (a.respondBy && b.respondBy && a.respondBy !== b.respondBy)
    return a.respondBy < b.respondBy ? -1 : 1;
  if (a.respondBy && !b.respondBy) return -1;
  if (!a.respondBy && b.respondBy) return 1;
  return a.company.localeCompare(b.company, 'ru');
}

/** Оффер B680 + отклик (компания, должность) + условия; первым — оффер с ближайшим сроком ответа. */
export function buildOfferCards(
  applications: readonly ApplicationView[],
  stored: readonly StoredApplicationOffer[],
  views: readonly B640OfferView[],
): OfferCard[] {
  return views
    .map((view) => {
      const application = applications.find((item) => item.id === view.applicationId);
      const offer = stored.find((item) => item.applicationId === view.applicationId);
      return {
        applicationId: view.applicationId,
        company: application?.vacancy?.company?.trim() || NO_COMPANY,
        title: application?.vacancy?.title?.trim() ?? '',
        terms: offer?.terms ?? {},
        respondBy: view.respondBy ?? offer?.respondBy ?? null,
        view,
      };
    })
    .sort(byDeadline);
}

interface MonthlyPay {
  readonly amount: number;
  readonly currency: string;
  readonly net: boolean;
}

function monthlyPay(card: OfferCard): MonthlyPay | null {
  const { gross, net } = card.view;
  const amount = net ?? gross.amount;
  if (amount === null) return null;
  return {
    amount: gross.period === 'year' ? amount / 12 : amount,
    currency: gross.currency ?? 'RUB',
    net: net !== null,
  };
}

function converted(
  pay: MonthlyPay,
  choice: CurrencyChoice,
  rates: CurrencyRates | null,
): number | undefined {
  if (choice === 'ORIG' || sameCurrency(pay.currency, choice)) return undefined;
  return convertAmount(pay.amount, pay.currency, choice, rates ?? undefined);
}

/** Ячейка «Оклад на руки»: сумма, пересчёт «≈» по курсу ЦБ и «до налога», пока налога нет. */
export function payText(
  card: OfferCard,
  choice: CurrencyChoice,
  rates: CurrencyRates | null,
): PayText {
  const pay = monthlyPay(card);
  if (!pay) return { text: NOT_SET, needsTax: false };
  const own = formatMoney(pay.amount, pay.currency);
  const other = converted(pay, choice, rates);
  const amount = other === undefined ? own : `${own} ≈ ${formatMoney(other, choice)}`;
  return { text: pay.net ? amount : `${amount} до налога`, needsTax: !pay.net };
}

/** Строка сравнения на телефоне: «Вектор Банк 520 тыс. ₽ · Гринкод ≈ 590 тыс. ₽». */
export function compareLine(
  cards: readonly OfferCard[],
  choice: CurrencyChoice,
  rates: CurrencyRates | null,
): string {
  return cards
    .map((card) => {
      const pay = monthlyPay(card);
      if (!pay) return `${card.company} ${NOT_SET}`;
      const other = converted(pay, choice, rates);
      return other === undefined
        ? `${card.company} ${formatMoney(pay.amount, pay.currency)}`
        : `${card.company} ≈ ${formatMoney(other, choice)}`;
    })
    .join(' · ');
}

function bonusText(terms: ApplicationOfferTerms): string {
  if (terms.bonus === undefined) return NOT_SET;
  if (terms.bonus === 0) return 'нет';
  const base = terms.salaryPeriod === 'year' ? undefined : terms.baseSalary;
  if (base && terms.bonus % base === 0) {
    const count = terms.bonus / base;
    return `${count} ${plural(count, ['оклад', 'оклада', 'окладов'])} в год`;
  }
  return `${formatMoney(terms.bonus, terms.currency ?? 'RUB')} в год`;
}

function riskText(terms: ApplicationOfferTerms): string {
  const months = terms.probationPeriodMonths ?? 0;
  const probation =
    months > 0
      ? [`Испытательный срок ${months} ${plural(months, ['месяц', 'месяца', 'месяцев'])}`]
      : [];
  const parts = [...probation, ...(terms.risks ?? []).map((risk) => risk.trim()).filter(Boolean)];
  return parts.length > 0 ? parts.join('; ') : 'нет';
}

/** Пять условий после оклада, по одной ячейке на оффер. */
export function conditionRows(cards: readonly OfferCard[]): ConditionRow[] {
  return [
    { label: 'Бонус', cells: cards.map((card) => bonusText(card.terms)) },
    {
      label: 'Формат',
      cells: cards.map((card) => {
        const format = card.terms.format?.trim();
        return format ? (FORMATS[format] ?? format) : NOT_SET;
      }),
    },
    { label: 'Выход', cells: cards.map((card) => formatDay(card.terms.startDate) ?? NOT_SET) },
    { label: 'Риски', cells: cards.map((card) => riskText(card.terms)) },
    { label: 'Ответить до', cells: cards.map((card) => formatDay(card.respondBy) ?? NOT_SET) },
  ];
}

function payIn(card: OfferCard, currency: string, rates: CurrencyRates | null): number | undefined {
  const pay = monthlyPay(card);
  if (!pay) return undefined;
  return convertAmount(pay.amount, pay.currency, currency, rates ?? undefined);
}

function floorTitle(
  cards: readonly OfferCard[],
  floor: SalaryFloor,
  rates: CurrencyRates | null,
): string | null {
  const amounts = cards.map((card) => payIn(card, floor.currency, rates));
  if (amounts.some((amount) => amount === undefined)) return null;
  const below = cards.find((_, index) => (amounts[index] as number) < floor.amount);
  if (below) return `${below.company} ниже вашей планки`;
  if (cards.length === 1) return 'Выше вашей планки';
  return cards.length === 2 ? 'Оба выше вашей планки' : `Все ${cards.length} выше вашей планки`;
}

/** Заголовок o06: сравнение с планкой кандидата, без неё — кто платит больше. */
export function leadTitle(
  cards: readonly OfferCard[],
  floor: SalaryFloor | null,
  rates: CurrencyRates | null,
): string {
  if (cards.length === 0) return 'Офферов пока нет';
  const byFloor = floor ? floorTitle(cards, floor, rates) : null;
  if (byFloor) return byFloor;
  if (cards.length === 1) return `Оффер: ${cards[0].company}`;
  const amounts = cards.map((card) => payIn(card, 'RUB', rates));
  if (amounts.some((amount) => amount === undefined)) return 'Сравните офферы';
  const top = amounts.indexOf(Math.max(...(amounts as number[])));
  return `${cards[top].company} платит больше`;
}
