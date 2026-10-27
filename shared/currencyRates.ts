/**
 * CPO 27.10: фильтр «Зарплата» сравнивал только вакансии в выбранной валюте —
 * 90 000 EUR в Берлине пропадали при пороге в рублях. Курс ЦБ (рублей за одну
 * единицу) пересчитывает порог; сама зарплата вакансии показывается как есть.
 */
export interface CurrencyRates {
  /** Дата курса ЦБ, YYYY-MM-DD. */
  readonly date: string;
  /** Рублей за одну единицу валюты, по коду ISO. */
  readonly rubPerUnit: Readonly<Record<string, number>>;
}

const RATE_ALIASES: Readonly<Record<string, string>> = {
  RUR: 'RUB',
  '₽': 'RUB',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

function rateCode(currency: string): string {
  const code = currency.trim().toUpperCase();
  return RATE_ALIASES[code] ?? code;
}

function rubles(currency: string, rates: CurrencyRates): number | undefined {
  const code = rateCode(currency);
  if (code === 'RUB') return 1;
  const rate = rates.rubPerUnit[code];
  return rate !== undefined && rate > 0 ? rate : undefined;
}

/** Сумма в другой валюте по курсу ЦБ; undefined, когда курса нет. */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: CurrencyRates | undefined,
): number | undefined {
  if (rateCode(from) === rateCode(to)) return amount;
  if (!rates) return undefined;
  const fromRub = rubles(from, rates);
  const toRub = rubles(to, rates);
  if (fromRub === undefined || toRub === undefined) return undefined;
  return (amount * fromRub) / toRub;
}
