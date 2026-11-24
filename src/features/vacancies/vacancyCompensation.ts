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
  if (Math.max(salary.from ?? 0, salary.to ?? 0) < THOUSAND) return plainCompensation(salary);
  // Himalayas отдаёт одну сумму как from = to: «€500–500 тыс.» читается как ошибка (29.10).
  if (salary.from !== undefined && salary.from === salary.to) {
    return withCurrency(thousandsAmount(salary.from), salary.currency);
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

const THOUSAND = 1000;

/**
 * B765 (B645 23.11): ставка и суммы меньше тысячи — целыми числами, без «$0–0 тыс.»:
 * «$200–300 в час», «€115–130», «от $900».
 */
function plainCompensation(salary: NonNullable<Salary>): string {
  const amounts = formatRateAmounts(salary);
  const bound =
    salary.from !== undefined && salary.to !== undefined
      ? ''
      : salary.from !== undefined
        ? 'от '
        : 'до ';
  const period = salary.period === 'hour' ? ' в час' : '';
  return `${bound}${amounts}${period}`;
}

/** B765: почасовая ставка целыми суммами, без «тыс.»: «$250–400», «900–1 200 ₽». */
export function formatRateAmounts(salary: Salary): string {
  const plain = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const parts = [salary?.from, salary?.to].filter((value): value is number => value !== undefined);
  const amounts = [...new Set(parts)].map((value) => plain.format(value)).join('–');
  const code = currencyCode(salary?.currency);
  if (code === 'rub' || code === 'rur') return `${amounts} ₽`;
  const sign = CURRENCY_SYMBOLS[code];
  if (sign) return `${sign}${amounts}`;
  return code ? `${amounts} ${code.toUpperCase()}` : amounts;
}
