import { describe, expect, it } from 'vitest';
import { formatTodaySalary } from './todayCompensation';

describe('formatTodaySalary (B251 S5)', () => {
  it('formats a full range compactly', () => {
    expect(formatTodaySalary({ from: 190000, to: 240000, currency: 'usd' })).toBe('$190k–$240k');
  });

  it('prefixes an open lower bound with "от"', () => {
    expect(formatTodaySalary({ from: 176000, currency: 'usd' })).toBe('от $176k');
  });

  it('prefixes an open upper bound with "до"', () => {
    expect(formatTodaySalary({ to: 210000, currency: 'usd' })).toBe('до $210k');
  });

  it('returns null when no salary data is present', () => {
    expect(formatTodaySalary(undefined)).toBeNull();
  });
});
