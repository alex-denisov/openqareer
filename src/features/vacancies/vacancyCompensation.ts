import type { MatchedVacancyItem } from '../coach/cabinetTypes';

type Salary = MatchedVacancyItem['cluster']['salary'];

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  rub: '₽',
  rur: '₽', // hh.ru still reports roubles as RUR
  gbp: '£',
};

function currencyCode(currency?: string): string {
  return (currency ?? '').trim().toLowerCase();
}

/** `450000` → `450` (тысячи). */
function thousandsAmount(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount / 1000);
}

/** «450–600 тыс. ₽», «$190–240 тыс.», «5 000 тыс. JPY» — как деньги в макете 4. */
function withCurrency(amounts: string, currency?: string): string {
  const code = currencyCode(currency);
  if (code === 'rub' || code === 'rur') return `${amounts} тыс. ₽`;
  const sign = CURRENCY_SYMBOLS[code];
  if (sign) return `${sign}${amounts} тыс.`;
  return code ? `${amounts} тыс. ${code.toUpperCase()}` : `${amounts} тыс.`;
}

/**
 * Компактная строка вилки для строки списка вакансий: «450–600 тыс. ₽»,
 * одна граница — с префиксом «от»/«до», без данных — «не указана».
 */
export function formatCompensationCompact(salary: Salary): string {
  if (!salary || (salary.from === undefined && salary.to === undefined)) {
    return 'не указана';
  }
  if (salary.from !== undefined && salary.to !== undefined) {
    return withCurrency(
      `${thousandsAmount(salary.from)}–${thousandsAmount(salary.to)}`,
      salary.currency,
    );
  }
  if (salary.from !== undefined) {
    return `от ${withCurrency(thousandsAmount(salary.from), salary.currency)}`;
  }
  return `до ${withCurrency(thousandsAmount(salary.to as number), salary.currency)}`;
}
