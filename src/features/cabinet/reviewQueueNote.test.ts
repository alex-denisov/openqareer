import { describe, expect, it } from 'vitest';
import { reviewQueueNote } from './CareerTodayBriefing';

/** "13 факт(ов)" is a placeholder, not a sentence a candidate should read (B166). */
describe('review queue note', () => {
  it('agrees with the number of facts awaiting review', () => {
    expect(reviewQueueNote(1)).toBe('1 факт ждёт вашей проверки в разделе «Профиль».');
    expect(reviewQueueNote(2)).toBe('2 факта ждут вашей проверки в разделе «Профиль».');
    expect(reviewQueueNote(13)).toBe('13 фактов ждут вашей проверки в разделе «Профиль».');
    expect(reviewQueueNote(21)).toBe('21 факт ждёт вашей проверки в разделе «Профиль».');
  });

  it('says nothing when there is nothing to review', () => {
    expect(reviewQueueNote(0)).toBeUndefined();
  });
});
