import { describe, expect, it } from 'vitest';
import { getExecutiveJobMatches } from '../jobMatching';

describe('getExecutiveJobMatches', () => {
  it('returns a fresh, structurally complete fixture list', () => {
    const first = getExecutiveJobMatches();
    const second = getExecutiveJobMatches();

    expect(first).toHaveLength(3);
    expect(first).not.toBe(second);
    expect(first.map((job) => job.id)).toEqual(['1', '2', '3']);
    expect(
      first.every(
        (job) =>
          job.matchScore >= 0 &&
          job.matchScore <= 100 &&
          job.matchedPillars.length > 0,
      ),
    ).toBe(true);
  });
});

