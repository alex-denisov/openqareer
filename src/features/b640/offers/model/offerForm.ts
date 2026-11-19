import { B640_TAX_PERCENT_MAX } from '../../../../../shared/b640Offers';
import type { ApplicationOfferTerms } from '../../../../../server/data/sqliteApplicationOfferRepository';
import type { OfferCard } from './offerModel';

/** Поля формы O6a как их видит кандидат: строки, без преобразований. */
export interface OfferForm {
  readonly company: string;
  readonly title: string;
  readonly base: string;
  readonly period: 'month' | 'year';
  readonly currency: string;
  readonly bonus: string;
  readonly format: string;
  readonly respondBy: string;
  readonly probationMonths: string;
  readonly probationSalary: string;
  readonly tax: string;
  readonly benefits: string;
  readonly risks: string;
  readonly source: string;
}

export type OfferFormErrors = Partial<Record<keyof OfferForm, string>>;

export type ParsedOfferForm =
  | {
      readonly ok: true;
      readonly company: string;
      readonly title: string;
      readonly terms: ApplicationOfferTerms;
      readonly respondBy: string | null;
      readonly tax: number | null;
    }
  | { readonly ok: false; readonly errors: OfferFormErrors };

const NOT_A_NUMBER = 'Введите число';

export function emptyOfferForm(): OfferForm {
  return {
    company: '',
    title: '',
    base: '',
    period: 'month',
    currency: 'RUB',
    bonus: '',
    format: '',
    respondBy: '',
    probationMonths: '',
    probationSalary: '',
    tax: '',
    benefits: '',
    risks: '',
    source: '',
  };
}

function amount(value: number | null | undefined): string {
  if (value === undefined || value === null) return '';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
    .format(value)
    .replace(/\s/g, ' ');
}

function dayText(iso: string | null): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

/** Форма из сохранённого оффера; без оффера — пустая форма нового. */
export function formFromCard(card: OfferCard | null): OfferForm {
  if (!card) return emptyOfferForm();
  const { terms } = card;
  return {
    ...emptyOfferForm(),
    base: amount(terms.baseSalary),
    period: terms.salaryPeriod ?? 'month',
    currency: terms.currency ?? 'RUB',
    bonus: amount(terms.bonus),
    format: terms.format ?? '',
    respondBy: dayText(card.respondBy),
    probationMonths: amount(terms.probationPeriodMonths),
    probationSalary: amount(terms.probationSalary),
    tax: amount(card.view.taxPercent),
    benefits: (terms.benefits ?? []).join(', '),
    risks: (terms.risks ?? []).join(', '),
    source: terms.sourceNote ?? '',
  };
}

type Parsed<T> = { readonly value: T | undefined } | { readonly error: string };

function parseNumber(
  text: string,
  max = Number.MAX_SAFE_INTEGER,
  error = NOT_A_NUMBER,
): Parsed<number> {
  const clean = text.replace(/[\s ]/g, '').replace(',', '.');
  if (clean === '') return { value: undefined };
  const value = Number(clean);
  if (!/^\d+(\.\d+)?$/.test(clean) || value > max) return { error };
  return { value };
}

function parseDay(text: string): Parsed<string> {
  const clean = text.trim();
  if (clean === '') return { value: undefined };
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(clean);
  const error = { error: 'Дата в виде дд.мм.гггг' };
  if (!match) return error;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return error;
  return { value: date.toISOString().slice(0, 10) };
}

function list(text: string): readonly string[] | undefined {
  const items = text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function text(value: string): string | undefined {
  return value.trim() || undefined;
}

/** Без `undefined`-ключей: сервер хранит только то, что кандидат ввёл. */
function compact(terms: Record<string, unknown>): ApplicationOfferTerms {
  return Object.fromEntries(
    Object.entries(terms).filter(([, value]) => value !== undefined),
  ) as ApplicationOfferTerms;
}

function value<T>(parsed: Parsed<T>): T | undefined {
  return 'value' in parsed ? parsed.value : undefined;
}

/** Проверка формы: ошибки по полям или условия для `PUT /applications/:id/offer`. */
export function parseOfferForm(form: OfferForm, isNew: boolean): ParsedOfferForm {
  const numbers = {
    base: parseNumber(form.base),
    bonus: parseNumber(form.bonus),
    probationMonths: parseNumber(form.probationMonths, 12, 'От 0 до 12 месяцев'),
    probationSalary: parseNumber(form.probationSalary),
    tax: parseNumber(form.tax, B640_TAX_PERCENT_MAX, `Налог от 0 до ${B640_TAX_PERCENT_MAX} %`),
  };
  const respondBy = parseDay(form.respondBy);
  const errors: Record<string, string> = {};
  if (isNew && !form.company.trim()) errors.company = 'Укажите компанию';
  if (isNew && !form.title.trim()) errors.title = 'Укажите должность';
  for (const [key, parsed] of Object.entries({ ...numbers, respondBy })) {
    if ('error' in parsed) errors[key] = parsed.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    company: form.company.trim(),
    title: form.title.trim(),
    respondBy: value(respondBy) ?? null,
    tax: value(numbers.tax) ?? null,
    terms: compact({
      baseSalary: value(numbers.base),
      salaryPeriod: form.base.trim() ? form.period : undefined,
      currency: form.base.trim() ? form.currency : undefined,
      bonus: value(numbers.bonus),
      format: text(form.format),
      probationPeriodMonths: value(numbers.probationMonths),
      probationSalary: value(numbers.probationSalary),
      benefits: list(form.benefits),
      risks: list(form.risks),
      sourceNote: text(form.source),
    }),
  };
}

/** Условия для расчёта справа: ошибочное поле просто не учитывается, пока кандидат его правит. */
export function previewTerms(form: OfferForm): ApplicationOfferTerms {
  return compact({
    baseSalary: value(parseNumber(form.base)),
    salaryPeriod: form.period,
    currency: form.currency,
    bonus: value(parseNumber(form.bonus)),
    probationPeriodMonths: value(parseNumber(form.probationMonths, 12)),
    probationSalary: value(parseNumber(form.probationSalary)),
  });
}
