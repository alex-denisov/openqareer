import { describe, expect, it } from 'vitest';
import { warmRoleSnapshots } from './roleSnapshotWarm';
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
});
