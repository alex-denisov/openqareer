import { describe, expect, it } from 'vitest';
import { localIsoDate, relocationDay, relocationShortDay } from './relocationDates';

describe('relocation dates', () => {
  it('keeps a calendar date and formats it as ДД.ММ.ГГГГ', () => {
    expect(relocationDay('2026-10-10')).toBe('10.10.2026');
    expect(relocationShortDay('2026-10-10')).toBe('10.10');
  });

  it('converts a UTC timestamp to the local day', () => {
    const stamp = '2026-10-21T22:30:00.000Z';
    const local = new Date(stamp);
    const expected = `${String(local.getDate()).padStart(2, '0')}.${String(local.getMonth() + 1).padStart(2, '0')}.${local.getFullYear()}`;
    expect(relocationDay(stamp)).toBe(expected);
  });

  it('says unknown for an empty value and builds today from local parts', () => {
    expect(relocationDay(null)).toBe('неизвестно');
    expect(localIsoDate(new Date(2026, 9, 22, 1, 0))).toBe('2026-10-22');
  });
});
