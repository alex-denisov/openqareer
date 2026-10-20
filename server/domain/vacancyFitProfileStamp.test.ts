import { describe, expect, it } from 'vitest';
import { vacancyFitProfileStamp } from './vacancyFitProfileStamp';

const snapshot = { memory: [{ id: 'f1', statement: 'Built payments' }], resume: null } as never;
function workspace(visit: string, roles = ['Head of Engineering']) {
  return { lastVisitedAt: visit, previousVisitedAt: visit, campaign: { roles } } as never;
}

describe('vacancyFitProfileStamp', () => {
  it('stays the same across visits to «Сегодня», so cached fits are not recomputed', () => {
    expect(vacancyFitProfileStamp(snapshot, workspace('2026-10-20T01:00:00.000Z'))).toBe(
      vacancyFitProfileStamp(snapshot, workspace('2026-10-20T02:00:00.000Z')),
    );
  });

  it('changes when what the match depends on changes', () => {
    expect(vacancyFitProfileStamp(snapshot, workspace('2026-10-20T01:00:00.000Z'))).not.toBe(
      vacancyFitProfileStamp(snapshot, workspace('2026-10-20T01:00:00.000Z', ['CTO'])),
    );
  });
});
