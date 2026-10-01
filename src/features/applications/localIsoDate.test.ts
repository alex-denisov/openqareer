import { describe, expect, it } from 'vitest';
import { localIsoDate } from './localIsoDate';

describe('localIsoDate (B341)', () => {
  it('returns the Moscow date just after midnight, not the UTC one', () => {
    expect(localIsoDate(new Date('2026-09-30T22:00:00.000Z'), 'Europe/Moscow')).toBe('2026-10-01');
  });

  it('returns the UTC date for a UTC candidate', () => {
    expect(localIsoDate(new Date('2026-09-30T22:00:00.000Z'), 'UTC')).toBe('2026-09-30');
  });
});
