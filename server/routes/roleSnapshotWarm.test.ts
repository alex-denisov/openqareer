import { describe, expect, it, vi } from 'vitest';
import { RoleWarmMemo, ROLE_REWARM_MS, warmRoleSnapshots } from './roleSnapshotWarm';
import { createRig, CURRENT_PATH, headersFor, ROLE_TITLE } from './roleSkillAssessmentRouteTestRig';

/**
 * B645 s09 (prod 19.11): «Карьера» reads a snapshot per search role; none was built ahead, so
 * 8 of 11 roles of adenisov.test answered `source_unavailable` after 15 s.
 */
describe('warmRoleSnapshots', () => {
  it('builds the snapshot a role read looks for, so the read does not touch the pool', async () => {
    const rig = await createRig();
    const { deps } = rig;

    await warmRoleSnapshots(deps, rig.candidate.id, undefined);
    expect(rig.getMatchedVacanciesAsync).toHaveBeenCalledTimes(1);
    expect(rig.getMatchedVacanciesAsync.mock.calls[0]?.[0]).toMatchObject({
      targetRoles: [ROLE_TITLE],
    });

    const response = await rig.app.inject({
      method: 'GET',
      url: `${CURRENT_PATH}?role=${encodeURIComponent(ROLE_TITLE)}`,
      headers: headersFor(rig.candidate),
    });
    expect(response.statusCode).toBe(200);
    expect(rig.getMatchedVacanciesAsync).toHaveBeenCalledTimes(1);
  });

  it('a candidate without roles reads nothing', async () => {
    const rig = await createRig();
    const { deps } = rig;

    await warmRoleSnapshots(deps, rig.otherCandidate.id, undefined);

    expect(rig.getMatchedVacanciesAsync).not.toHaveBeenCalled();
  });

  it('B775: a second pass with the same inputs reads nothing; after the rewarm interval it warms again', async () => {
    const rig = await createRig();
    const memo = new RoleWarmMemo();
    const info = vi.fn();
    await warmRoleSnapshots(rig.deps, rig.candidate.id, { info }, { memo, now: 0 });
    await warmRoleSnapshots(rig.deps, rig.candidate.id, { info }, { memo, now: ROLE_REWARM_MS - 1 });
    expect(rig.getMatchedVacanciesAsync).toHaveBeenCalledTimes(1);
    await warmRoleSnapshots(rig.deps, rig.candidate.id, { info }, { memo, now: ROLE_REWARM_MS });
    expect(info.mock.calls.map(([fields]) => fields.skipped)).toEqual([0, 1, 0]);
  });
});

describe('B775: RoleWarmMemo', () => {
  it('warms a role once per inputs; new inputs or an old warm warm again', () => {
    const memo = new RoleWarmMemo();
    expect(memo.due('c1', 'cto', 'skills:a', 0)).toBe(true);
    memo.remember('c1', 'cto', 'skills:a', 0);
    expect(memo.due('c1', 'cto', 'skills:a', 60_000)).toBe(false);
    expect(memo.due('c1', 'cto', 'skills:a,b', 60_000)).toBe(true);
    expect(memo.due('c1', 'coo', 'skills:a', 60_000)).toBe(true);
    expect(memo.due('c2', 'cto', 'skills:a', 60_000)).toBe(true);
    expect(memo.due('c1', 'cto', 'skills:a', ROLE_REWARM_MS)).toBe(true);
  });
});
