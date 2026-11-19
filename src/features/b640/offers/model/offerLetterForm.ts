import type { ParsedOfferLetter } from '../../../../../shared/offerLetterParse';
import { amount, dayText, type OfferForm } from './offerForm';

export type OfferFormKey = keyof OfferForm;

export interface LetterApplied {
  readonly form: OfferForm;
  /** Поля, которые подставлены из письма: их кандидат проверяет. */
  readonly fromLetter: ReadonlySet<OfferFormKey>;
}

/** Найденное в письме как строки формы; пустые значения не трогают введённое кандидатом. */
function letterValues(parsed: ParsedOfferLetter): Partial<OfferForm> {
  const entries: [OfferFormKey, string | undefined][] = [
    ['base', amount(parsed.baseSalary) || undefined],
    ['period', parsed.salaryPeriod],
    ['currency', parsed.currency],
    ['tax', parsed.net === true ? '0' : undefined],
    ['bonus', amount(parsed.bonus) || undefined],
    ['format', parsed.format],
    ['respondBy', parsed.respondBy ? dayText(parsed.respondBy) : undefined],
    ['probationMonths', amount(parsed.probationPeriodMonths) || undefined],
    ['probationSalary', amount(parsed.probationSalary) || undefined],
    ['benefits', parsed.benefits?.join(', ') || undefined],
    ['startDate', parsed.startDate],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

/** Подставить разбор письма в форму (B646). Дата выхода в сетке не видна и не помечается. */
export function applyLetter(form: OfferForm, parsed: ParsedOfferLetter): LetterApplied {
  const values = letterValues(parsed);
  const keys = (Object.keys(values) as OfferFormKey[]).filter((key) => key !== 'startDate');
  return { form: { ...form, ...values }, fromLetter: new Set(keys) };
}
