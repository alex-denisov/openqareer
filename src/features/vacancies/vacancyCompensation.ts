import type { MatchedVacancyItem } from '../coach/cabinetTypes';

type Salary = MatchedVacancyItem['cluster']['salary'];

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  rub: '₽',
  gbp: '£',
};

function currencySymbol(currency?: string): string {
  if (!currency) return '';
  const key = currency.trim().toLowerCase();
  return CURRENCY_SYMBOLS[key] ?? currency;
}

/** `190000` → `190k`; sums under 1000 are shown as-is. */
function compactAmount(amount: number): string {
  if (Math.abs(amount) < 1000) return String(amount);
  const thousands = amount / 1000;
  const rounded = Number.isInteger(thousands) ? thousands : Math.round(thousands * 10) / 10;
  return `${rounded}k`;
}

/**
 * Компактная строка вилки для строки списка вакансий (приёмка B250):
 * `$190k–$240k`, одна граница — с префиксом «от»/«до», без данных — «не
 * указана». Число целиком в отдельной строке было бы вернее, но не влезает
 * в компактную колонку списка.
 */
export function formatCompensationCompact(salary: Salary): string {
  if (!salary || (salary.from === undefined && salary.to === undefined)) {
    return 'не указана';
  }
  const symbol = currencySymbol(salary.currency);
  if (salary.from !== undefined && salary.to !== undefined) {
    return `${symbol}${compactAmount(salary.from)}–${symbol}${compactAmount(salary.to)}`;
  }
  if (salary.from !== undefined) {
    return `от ${symbol}${compactAmount(salary.from)}`;
  }
  return `до ${symbol}${compactAmount(salary.to as number)}`;
}
