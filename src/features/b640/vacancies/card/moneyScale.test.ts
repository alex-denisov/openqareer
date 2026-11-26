import { describe, expect, it } from 'vitest';
import { moneyScale } from './moneyScale';

const market = {
  low: 380_000,
  high: 520_000,
  currency: 'RUB',
  period: 'month',
  tax: 'unknown',
  computedAt: '2026-11-10T00:00:00Z',
} as const;

describe('moneyScale', () => {
  it('рынок и вилка — доли шкалы с запасом по краям', () => {
    const scale = moneyScale(market, { from: 480_000, to: 580_000, currency: 'RUB' }, undefined);
    expect(scale).not.toBeNull();
    // Ось 340–620 тыс. (запас 40): рынок 40 + 140 из 280, вилка 140 + 100 из 280.
    expect(scale!.market!.start).toBeCloseTo(14.3, 0);
    expect(scale!.market!.size).toBeCloseTo(50, 0);
    expect(scale!.fork?.start).toBeCloseTo(50, 0);
    expect(scale!.fork?.size).toBeCloseTo(35.7, 0);
  });

  it('без вилки вакансии шкала с одним рынком', () => {
    const scale = moneyScale(market, undefined, undefined);
    expect(scale!.fork).toBeUndefined();
    expect(scale!.market!.size).toBeGreaterThan(0);
  });

  it('вилка в другой валюте без курса — только рынок', () => {
    const scale = moneyScale(market, { from: 5_000, to: 6_500, currency: 'USD' }, undefined);
    expect(scale!.fork).toBeUndefined();
  });

  it('нет ни рынка, ни вилки — шкалы нет', () => {
    expect(moneyScale(undefined, undefined, undefined)).toBeNull();
  });

  it('все доли в пределах 0–100', () => {
    const scale = moneyScale(
      market,
      { from: 10_000_000, to: 12_000_000, currency: '₽' },
      undefined,
    )!;
    for (const part of [scale.market!, scale.fork!]) {
      expect(part.start).toBeGreaterThanOrEqual(0);
      expect(part.start + part.size).toBeLessThanOrEqual(100.0001);
    }
  });

  it('ожидания внутри вилки — точка на шкале и вердикт «внутри»', () => {
    const scale = moneyScale(market, { from: 480_000, to: 580_000, currency: 'RUB' }, undefined, {
      amount: 500_000,
      currency: 'RUB',
    });
    expect(scale).toMatchObject({ verdict: 'inside', verdictAgainst: 'fork' });
    expect(scale!.me).toBeGreaterThan(scale!.fork!.start);
    expect(scale!.me).toBeLessThan(scale!.fork!.start + scale!.fork!.size);
  });

  it('вилки в вакансии нет — ожидания сверяются с рынком', () => {
    const scale = moneyScale(market, undefined, undefined, { amount: 600_000, currency: 'RUB' });
    expect(scale).toMatchObject({ verdict: 'above', verdictAgainst: 'market' });
    expect(scale!.fork).toBeUndefined();
  });

  it('ожидания в рублях, рынок в долларах без курса — точки нет', () => {
    const scale = moneyScale({ ...market, currency: 'USD' }, undefined, undefined, {
      amount: 500_000,
      currency: 'RUB',
    });
    expect(scale!.me).toBeUndefined();
  });

  it('нет рынка, но есть вилка — шкала из вилки', () => {
    const scale = moneyScale(undefined, { from: 1, to: 2, currency: 'RUB' }, undefined);
    expect(scale!.market).toBeUndefined();
    expect(scale!.fork).toBeDefined();
  });
});
