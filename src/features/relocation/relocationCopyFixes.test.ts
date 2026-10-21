import { describe, expect, it } from 'vitest';
import { missingFactLabel } from './CountryComparisonPanel';
import { thresholdBasis } from './relocationCountryData';

describe('relocation comparison copy', () => {
  it('asks for the salary when only the salary is missing', () => {
    expect(missingFactLabel('Укажите годовую зарплату для расчёта налога.')).toBe(
      'укажите зарплату',
    );
    expect(missingFactLabel('Для этой страны нет проверенной налоговой шкалы.')).toBe('нет данных');
    expect(missingFactLabel(undefined)).toBe('нет данных');
  });

  it('does not repeat the period a threshold label already names', () => {
    expect(thresholdBasis('Минимальная годовая зарплата', 'annual')).toBe(
      'Минимальная годовая зарплата',
    );
    expect(thresholdBasis('Минимальная зарплата', 'annual')).toBe('Минимальная зарплата, в год');
    expect(thresholdBasis('Средства на счёте', 'monthly')).toBe('Средства на счёте, в месяц');
  });
});
