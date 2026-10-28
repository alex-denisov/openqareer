import { describe, expect, it } from 'vitest';
import { displayMonth, displayYear, monthOrder } from './experienceDate';

describe('experienceDate', () => {
  it('shows months as MM.YYYY like the approved Profile mockup', () => {
    expect(displayMonth('2021-03')).toBe('03.2021');
    expect(displayMonth('2021-03-15')).toBe('03.2021');
    expect(displayMonth('Nov 2025')).toBe('11.2025');
    expect(displayMonth('September 2017')).toBe('09.2017');
    expect(displayMonth('сен 2017')).toBe('09.2017');
  });

  it('keeps a bare year and unknown text as they are', () => {
    expect(displayMonth('2005')).toBe('2005');
    expect(displayMonth('весной')).toBe('весной');
  });

  it('shows education periods as years only', () => {
    expect(displayYear('2008-09')).toBe('2008');
    expect(displayYear('Oct 2021')).toBe('2021');
    expect(displayYear('2010')).toBe('2010');
    expect(displayYear('')).toBe('');
  });

  it('orders English LinkedIn months', () => {
    expect(monthOrder('Apr 2023')).toBe(202304);
  });
});
