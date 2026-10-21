import { describe, expect, it } from 'vitest';
import { formatCompensationCompact } from './vacancyCompensation';

describe('formatCompensationCompact (B446-g4: thousands, ₽ at the end)', () => {
  it('formats a rouble range as «450–600 тыс. ₽»', () => {
    expect(formatCompensationCompact({ from: 450000, to: 600000, currency: 'RUR' })).toBe(
      '450–600 тыс. ₽',
    );
  });

  it('formats a full dollar range with the sign in front', () => {
    expect(formatCompensationCompact({ from: 190000, to: 240000, currency: 'usd' })).toBe(
      '$190–240 тыс.',
    );
  });

  it('formats a lower bound only', () => {
    expect(formatCompensationCompact({ from: 150000, currency: 'rub' })).toBe('от 150 тыс. ₽');
  });

  it('formats an upper bound only', () => {
    expect(formatCompensationCompact({ to: 220000, currency: 'usd' })).toBe('до $220 тыс.');
  });

  it('falls back to "не указана" when neither bound is present', () => {
    expect(formatCompensationCompact(undefined)).toBe('не указана');
    expect(formatCompensationCompact({ currency: 'usd' })).toBe('не указана');
  });

  it('puts an unknown currency code after the amount', () => {
    expect(formatCompensationCompact({ from: 5000000, to: 6000000, currency: 'jpy' })).toBe(
      '5 000–6 000 тыс. JPY',
    );
  });
});
