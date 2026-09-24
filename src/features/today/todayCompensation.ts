import type { TodaySalary } from './todayApi';

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
 * Компактная строка вилки для строки очереди дня (B251 S5, тот же формат,
 * что и в списке вакансий — `vacancyCompensation.ts`): `$190k–$240k`, одна
 * граница — с префиксом «от»/«до», без данных — `null` (место в строке
 * освобождается под локацию или «Ждём вас»).
 */
export function formatTodaySalary(salary: TodaySalary | undefined): string | null {
  if (!salary || (salary.from === undefined && salary.to === undefined)) return null;
  const symbol = currencySymbol(salary.currency);
  if (salary.from !== undefined && salary.to !== undefined) {
    return `${symbol}${compactAmount(salary.from)}–${symbol}${compactAmount(salary.to)}`;
  }
  if (salary.from !== undefined) return `от ${symbol}${compactAmount(salary.from)}`;
  return `до ${symbol}${compactAmount(salary.to as number)}`;
}
