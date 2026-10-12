import { describe, expect, it } from 'vitest';
import { currentCareerDiaryWeek } from './careerDiaryWeek';

describe('currentCareerDiaryWeek', () => {
  it('uses the Monday containing the API date and counts from the workplace start', () => {
    expect(currentCareerDiaryWeek('2026-10-10', '2026-09-07')).toEqual({
      weekStart: '2026-10-05',
      weekEnd: '2026-10-11',
      number: 5,
    });
  });

  it('does not invent a numbered week when the diary has no workplace start date', () => {
    expect(currentCareerDiaryWeek('2026-10-11', null)).toEqual({
      weekStart: '2026-10-05',
      weekEnd: '2026-10-11',
      number: null,
    });
  });
});
