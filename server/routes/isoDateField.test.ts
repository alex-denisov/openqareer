import { describe, expect, it } from 'vitest';
import { isoDateField } from './isoDateField';

describe('isoDateField', () => {
  it.each([
    '2026-02-01',
    '2026-02-01T10:00:00Z',
    '2026-09-30T10:00:00.000Z',
    '2026-09-30T10:00:00+03:00',
  ])('accepts ISO date or date-time %s', (value) => {
    expect(isoDateField.safeParse(value).success).toBe(true);
  });

  it.each([
    '',
    'tomorrow',
    '2026-13-01',
    '2026-02-01T10:00:00',
    'x'.repeat(41),
    `2026-02-01${' '.repeat(50)}`,
  ])('rejects %j', (value) => {
    expect(isoDateField.safeParse(value).success).toBe(false);
  });
});
