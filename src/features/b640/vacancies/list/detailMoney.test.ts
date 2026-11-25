import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { detailMoneyText, expectationCaption, expectationMark } from './detailMoney';

const market = {
  low: 380_000,
  high: 520_000,
  currency: 'RUB',
  period: 'month',
  sampleSize: 9,
  basis: 'country',
  computedAt: '2026-11-25T00:00:00Z',
};
const item = (salary?: unknown, estimate: unknown = market) =>
  ({
    cluster: { salary },
    explanation: { marketSalary: estimate },
  }) as unknown as MatchedVacancyItem;
const fork = { from: 480_000, to: 580_000, currency: 'RUB', period: 'month' };
const me = (amount: number) => ({ amount, currency: 'RUB' });

describe('B801 v06b: деньги сводки', () => {
  it('без зарплаты — оценка рынка числом, без оценки — «не указаны»', () => {
    expect(detailMoneyText(item(), { currency: 'RUB' })).toMatch(/380.520/u);
    expect(detailMoneyText(item(undefined, undefined), { currency: 'RUB' })).not.toContain('NaN');
    expect(detailMoneyText(item(fork), { currency: 'RUB' })).toMatch(/480.580/u);
  });

  it('ожидания сравниваются с вилкой, без неё — с оценкой; нет ожиданий — нет подписи', () => {
    expect(expectationCaption(item(fork), undefined, me(500_000))).toBe('ожидания внутри вилки');
    expect(expectationCaption(item(fork), undefined, me(700_000))).toBe('ожидания выше вилки');
    expect(expectationCaption(item(), undefined, me(300_000))).toBe('ожидания ниже оценки');
    expect(expectationCaption(item(fork), undefined, undefined)).toBeUndefined();
  });

  it('метка стоит на оси полосы и не выходит за край', () => {
    const axis = { top: 1_000_000, currency: 'RUB' };
    expect(expectationMark(axis, undefined, me(500_000))).toBe(50);
    expect(expectationMark(axis, undefined, me(2_000_000))).toBe(100);
    expect(expectationMark(axis, undefined, { amount: 5, currency: 'USD' })).toBeUndefined();
  });
});
