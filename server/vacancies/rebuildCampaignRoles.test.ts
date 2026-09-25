import { describe, expect, it } from 'vitest';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { RouteDeps } from '../routes/deps';
import { rebuildCampaignRoles } from './rebuildCampaignRoles';

describe('rebuildCampaignRoles (B267 S5)', () => {
  it('пи пересборке не трогает explicit и не возвращает dismissed', async () => {
    let workspace: CandidateWorkspaceState = {
      resumeText: 'resume', resumeSource: 'text', targetDirection: 'VP of Technology & Operations',
      regions: [], currentSituation: '', constraints: '', urgency: 'active',
      campaign: {
        roles: ['My explicit role'], regions: [], revision: 3,
        updatedAt: '2026-09-25T00:00:00.000Z', dismissed: ['eng-mgmt.cto'],
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

    await rebuildCampaignRoles({ candidateStore: store } as unknown as Pick<RouteDeps, 'candidateStore' | 'campaignRoleModel'>, 'candidate');

    expect(workspace.campaign?.roles).toEqual(['My explicit role']);
    expect(workspace.campaign?.revision).toBe(3);
    expect(workspace.campaign?.auto?.roles.some((role) => role.id === 'eng-mgmt.cto')).toBe(false);
    expect(workspace.campaign?.auto?.roles.length).toBeLessThanOrEqual(10);
  });
});
