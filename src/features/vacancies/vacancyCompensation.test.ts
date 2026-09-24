import { describe, expect, it } from 'vitest';
import { formatCompensationCompact } from './vacancyCompensation';

describe('formatCompensationCompact', () => {
  it('formats a full range compactly', () => {
    expect(formatCompensationCompact({ from: 190000, to: 240000, currency: 'usd' })).toBe(
      '$190k–$240k',
    );
  });

  it('formats a lower bound only', () => {
    expect(formatCompensationCompact({ from: 150000, currency: 'usd' })).toBe('от $150k');
  });

  it('formats an upper bound only', () => {
    expect(formatCompensationCompact({ to: 220000, currency: 'usd' })).toBe('до $220k');
  });

  it('falls back to "не указана" when neither bound is present', () => {
    expect(formatCompensationCompact(undefined)).toBe('не указана');
    expect(formatCompensationCompact({ currency: 'usd' })).toBe('не указана');
  });

  it('falls back to the raw currency code when it has no known symbol', () => {
    expect(formatCompensationCompact({ from: 5000000, to: 6000000, currency: 'jpy' })).toBe(
      'jpy5000k–jpy6000k',
    );
  });
});
