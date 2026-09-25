import { describe, expect, it } from 'vitest';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { RouteDeps } from '../routes/deps';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import { rebuildCampaignRoles } from './rebuildCampaignRoles';

describe('rebuildCampaignRoles (B267 S5)', () => {
  it('при пересборке не трогает explicit и не возвращает dismissed', async () => {
    let workspace: CandidateWorkspaceState = {
      resumeText: 'resume',
      resumeSource: 'text',
      targetDirection: 'VP of Technology & Operations',
      regions: [],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
      campaign: {
        roles: ['My explicit role'],
        regions: [],
        revision: 3,
        updatedAt: '2026-09-25T00:00:00.000Z',
        dismissed: ['eng-mgmt.cto'],
      },
    };
    const store = {
      getCandidateWorkspace: () => workspace,
      getSnapshot: () => ({
        memory: [
          { id: 'title', statement: 'VP of Technology & Operations', status: 'confirmed' },
          { id: 'ops', statement: 'COO owned operations', status: 'confirmed' },
        ],
        resume: null,
      }),
      saveCandidateWorkspace: (_candidateId: string, next: CandidateWorkspaceState) => {
        workspace = next;
        return next;
      },
    };

    await rebuildCampaignRoles(
      { candidateStore: store } as unknown as Pick<
        RouteDeps,
        'candidateStore' | 'campaignRoleModel'
      >,
      'candidate',
    );

    expect(workspace.campaign?.roles).toEqual(['My explicit role']);
    expect(workspace.campaign?.revision).toBe(3);
    expect(workspace.campaign?.auto?.roles.some((role) => role.id === 'eng-mgmt.cto')).toBe(false);
    expect(workspace.campaign?.auto?.roles.length).toBeLessThanOrEqual(10);
  });

  it('берёт заголовок профиля, а не устаревший ответ мастера, и не выдумывает явные регионы', async () => {
    let workspace: CandidateWorkspaceState = {
      resumeText: '',
      resumeSource: 'text',
      targetDirection: 'Product Manager',
      regions: ['us'],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
    };
    const store = {
      getCandidateWorkspace: () => workspace,
      getSnapshot: () => ({
        memory: [{ id: 'exp', statement: 'VP of Technology, 250+ people', status: 'proposed' }],
        resume: {
          draft: { candidate: { headline: 'VP of Technology & Operations | Ex-Co-Founder' } },
        },
      }),
      saveCandidateWorkspace: (_candidateId: string, next: CandidateWorkspaceState) => {
        workspace = next;
        return next;
      },
    };

    await rebuildCampaignRoles(
      { candidateStore: store } as unknown as Pick<
        RouteDeps,
        'candidateStore' | 'campaignRoleModel'
      >,
      'candidate',
    );

    const functions = new Set(workspace.campaign?.auto?.roles.flatMap((role) => role.functions));
    expect(functions.has('product')).toBe(false);
    expect(functions.has('eng-mgmt')).toBe(true);
    expect(workspace.campaign?.regions).toEqual([]);
    expect(workspace.campaign?.roles).toEqual([]);
    // Прод 26.09: запись без прежней кампании падала на схеме (revision 0).
    expect(candidateWorkspaceSchema.safeParse(workspace).success).toBe(true);
  });
});
