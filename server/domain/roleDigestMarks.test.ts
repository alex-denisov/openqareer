import { describe, expect, it } from 'vitest';
import {
  digestCount,
  digestSalaryNote,
  mergeDigestMarks,
  ROLE_DIGEST_SOURCE_TYPE,
  salaryAboveFloor,
} from './roleDigestMarks';

const FLOOR = { amount: 450_000, currency: 'RUB' } as const;
const vacancy = (id: string, aboveFloor: boolean) => ({ id, aboveFloor });

describe('digest salary note (B671, n01b)', () => {
  it('says «выше 450 тыс. ₽» when every vacancy of the day is above the floor', () => {
    const stored = mergeDigestMarks('', [vacancy('a', true), vacancy('b', true)], FLOOR);
    expect(digestCount(ROLE_DIGEST_SOURCE_TYPE, stored)).toBe(2);
    expect(digestSalaryNote(ROLE_DIGEST_SOURCE_TYPE, stored)).toBe('выше 450 тыс. ₽');
  });

  it('counts the ones above when not all of them are', () => {
    const stored = mergeDigestMarks('', [vacancy('a', true), vacancy('b', false)], FLOOR);
    expect(digestSalaryNote(ROLE_DIGEST_SOURCE_TYPE, stored)).toBe('1 выше 450 тыс. ₽');
  });

  it('has no note without a floor, with none above it, or when the floor changed during the day', () => {
    expect(
      digestSalaryNote(ROLE_DIGEST_SOURCE_TYPE, mergeDigestMarks('', [vacancy('a', true)])),
    ).toBeNull();
    expect(
      digestSalaryNote(ROLE_DIGEST_SOURCE_TYPE, mergeDigestMarks('', [vacancy('a', false)], FLOOR)),
    ).toBeNull();
    const first = mergeDigestMarks('', [vacancy('a', true)], FLOOR);
    const changed = mergeDigestMarks(first, [vacancy('b', true)], {
      amount: 300_000,
      currency: 'RUB',
    });
    expect(digestCount(ROLE_DIGEST_SOURCE_TYPE, changed)).toBe(2);
    expect(digestSalaryNote(ROLE_DIGEST_SOURCE_TYPE, changed)).toBeNull();
  });

  it('keeps the stored value when nothing new arrived', () => {
    const stored = mergeDigestMarks('', [vacancy('a', true)], FLOOR);
    expect(mergeDigestMarks(stored, [vacancy('a', false)], FLOOR)).toBe(stored);
  });

  it('labels foreign currency floors', () => {
    const stored = mergeDigestMarks('', [vacancy('a', true)], { amount: 5_000, currency: 'USD' });
    expect(digestSalaryNote(ROLE_DIGEST_SOURCE_TYPE, stored)).toBe('выше $5 тыс.');
  });
});

describe('salaryAboveFloor', () => {
  it('takes the upper bound and needs a known amount', () => {
    expect(
      salaryAboveFloor({ from: 400_000, to: 500_000, currency: 'RUB' }, FLOOR, undefined),
    ).toBe(true);
    expect(
      salaryAboveFloor({ from: 300_000, to: 400_000, currency: 'RUB' }, FLOOR, undefined),
    ).toBe(false);
    expect(salaryAboveFloor({ from: 460_000, currency: 'RUB' }, FLOOR, undefined)).toBe(true);
    expect(salaryAboveFloor(undefined, FLOOR, undefined)).toBe(false);
    expect(salaryAboveFloor({ currency: 'RUB' }, FLOOR, undefined)).toBe(false);
  });
});
