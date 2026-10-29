// Block A, package 3 (B4/C14): without «Стратегия» the check runs on the role of the
// vacancy campaign, so «Начать» does not stop at «Сначала выберите роль».
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PATH,
  START_PATH,
  createRig,
  headersFor,
  mutationHeaders,
  responseData,
} from './roleSkillAssessmentRouteTestRig';

const CAMPAIGN_ROLE = 'VP of Engineering';

function saveCampaignRole(
  rig: Awaited<ReturnType<typeof createRig>>,
  candidateId: string,
  roles: readonly string[],
) {
  rig.store.saveCandidateWorkspace(candidateId, {
    resumeText: '',
    resumeSource: 'text',
    targetDirection: '',
    regions: [],
    currentSituation: '',
    constraints: '',
    urgency: 'active',
    campaign: { roles: [...roles], regions: [], revision: 1, updatedAt: '2026-10-29T10:00:00Z' },
  });
}

describe('role for the skill check without «Стратегия»', () => {
  it('reads the campaign role instead of answering role_not_selected', async () => {
    const rig = await createRig();
    saveCampaignRole(rig, rig.otherCandidate.id, [CAMPAIGN_ROLE]);

    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.otherCandidate),
    });

    expect(current.statusCode).toBe(200);
    expect(responseData(current)).toMatchObject({ state: 'ready', roleTitle: CAMPAIGN_ROLE });
  });

  it('starts a run on the campaign role', async () => {
    const rig = await createRig();
    saveCampaignRole(rig, rig.otherCandidate.id, [CAMPAIGN_ROLE]);

    const started = await rig.app.inject({
      method: 'POST',
      url: START_PATH,
      headers: mutationHeaders(rig, rig.otherCandidate),
      payload: { consent: true },
    });

    expect(started.statusCode).toBe(200);
    expect(responseData(started)).toMatchObject({
      state: 'run',
      run: { roleTitle: CAMPAIGN_ROLE },
    });
  });

  it('keeps «Стратегия» ahead of the campaign role', async () => {
    const rig = await createRig();
    saveCampaignRole(rig, rig.candidate.id, [CAMPAIGN_ROLE]);

    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.candidate),
    });

    expect(responseData(current)).toMatchObject({ state: 'ready', roleTitle: 'Head of Product' });
  });

  it('still asks for a role when neither «Стратегия» nor a campaign role exists', async () => {
    const rig = await createRig();

    const current = await rig.app.inject({
      method: 'GET',
      url: CURRENT_PATH,
      headers: headersFor(rig.otherCandidate),
    });

    expect(responseData(current)).toMatchObject({ state: 'role_not_selected' });
  });
});
