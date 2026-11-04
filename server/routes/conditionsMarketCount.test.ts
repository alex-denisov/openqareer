import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { conditionsMarketCount } from './matchedVacancyRoutes';

const item = (roleMatch: string, isRemote = false) =>
  ({ cluster: { isRemote }, explanation: { roleMatch } }) as unknown as MatchedVacancyItem;

describe('conditionsMarketCount', () => {
  const snapshot = [item('title'), item('title', true), item('none'), item('family', true)];

  it('N — подборка после условий, M — снимок по ролям и уровню', () => {
    expect(
      conditionsMarketCount(snapshot, snapshot.slice(0, 2), ['CTO'], { remoteOnly: false }),
    ).toEqual({ withinConditions: 2, byRoles: 3 });
  });

  it('только удалёнка сужает и M, как в шапке «Вакансий»', () => {
    expect(conditionsMarketCount(snapshot, [], ['CTO'], { remoteOnly: true }).byRoles).toBe(2);
  });

  it('без ролей M — весь снимок', () => {
    expect(conditionsMarketCount(snapshot, [], [], { remoteOnly: false }).byRoles).toBe(4);
  });
});
