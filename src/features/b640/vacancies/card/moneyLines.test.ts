import { describe, expect, it } from 'vitest';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { moneyLines, targetMoneyCurrency } from './moneyLines';

function item(salary: unknown, marketSalary?: unknown): MatchedVacancyItem {
  return { cluster: { salary }, explanation: { marketSalary } } as unknown as MatchedVacancyItem;
}

const rates = { date: '2026-11-10', rubPerUnit: { USD: 91, EUR: 99 } } as unknown as CurrencyRates;

describe('B593: валюта показа сумм', () => {
  it('выбор в «Приложении» важнее валюты условий; без выбора — условия, иначе рубли', () => {
    expect(targetMoneyCurrency('USD', 'EUR')).toBe('USD');
    expect(targetMoneyCurrency(null, 'eur')).toBe('EUR');
    expect(targetMoneyCurrency(null, 'AED')).toBe('RUB');
    expect(targetMoneyCurrency(null, undefined)).toBe('RUB');
  });
});

describe('moneyLines', () => {
  it('рубли в вакансии: крупно сумма, подпись «в вакансии», пересчёта нет', () => {
    const lines = moneyLines(item({ from: 480_000, to: 580_000, currency: 'RUB' }), undefined, 'RUB')!;
    expect(lines.big).toContain('480');
    expect(lines.small).toBe('в вакансии');
    expect(lines.converted).toBeUndefined();
    expect(lines.tip).toBe('Вилка — из текста вакансии.');
  });

  it('доллары пересчитаны по курсу: исходная сумма и дата курса отдельной строкой', () => {
    const lines = moneyLines(item({ from: 5_000, to: 6_500, currency: 'USD' }), rates, 'RUB')!;
    expect(lines.big.startsWith('≈ ')).toBe(true);
    expect(lines.converted).toMatch(/^в вакансии \$5–7 тыс\., курс ЦБ на 10\.11$/u);
    expect(lines.tip).toContain('Пересчёт валют — по курсу ЦБ на 10.11.');
  });

  it('нет зарплаты, есть оценка рынка — крупно она, подпись «оценка рынка»', () => {
    const market = { low: 380_000, high: 520_000, currency: 'RUB', sampleSize: 96, basis: 'city', computedAt: '2026-11-10T00:00:00Z' };
    const lines = moneyLines(item(undefined, market), undefined, 'RUB')!;
    expect(lines.big).toContain('380–520');
    expect(lines.small).toBe('оценка рынка');
    expect(lines.tip).toContain('Рынок по роли');
    expect(lines.tip).toContain('96');
  });

  it('нет ни зарплаты, ни оценки — блока нет', () => {
    expect(moneyLines(item(undefined), undefined, 'RUB')).toBeNull();
  });
});
