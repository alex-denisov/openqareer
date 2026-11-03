import { describe, expect, it } from 'vitest';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { RouteDeps } from '../routes/deps';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import { careerRoleId } from '../../shared/roleProposals';
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
          {
            id: 'title',
            kind: 'fact',
            domain: 'role-evidence',
            statement: 'VP of Technology & Operations',
            status: 'confirmed',
            sourceMessageIds: ['m1'],
            sensitive: false,
          },
          {
            id: 'ops',
            kind: 'fact',
            domain: 'role-evidence',
            statement: 'COO owned operations',
            status: 'confirmed',
            sourceMessageIds: ['m1'],
            sensitive: false,
          },
          {
            id: 'guess',
            kind: 'hypothesis',
            domain: 'gap',
            statement: 'Chief Audit Executive по гипотезе консультанта',
            status: 'proposed',
            sourceMessageIds: ['m1'],
            sensitive: false,
          },
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
    expect(workspace.campaign?.auto?.roles.flatMap((role) => role.evidenceRefs)).not.toContain(
      'memory:guess',
    );
    expect(workspace.campaign?.auto?.model).toBe('rules');
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
        memory: [
          {
            id: 'impabcdef0123-exp-1',
            kind: 'fact',
            domain: 'role-evidence',
            statement: 'VP of Technology, 250+ people',
            status: 'proposed',
            sourceMessageIds: ['import'],
            sensitive: false,
          },
        ],
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

  it('роль, убранная кандидатом на «Карьере», не возвращается, а успешная пересборка пишется в журнал', async () => {
    let workspace: CandidateWorkspaceState = {
      resumeText: '',
      resumeSource: 'text',
      targetDirection: '',
      regions: [],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
    };
    const fact = (id: string, statement: string) => ({
      id, kind: 'fact', domain: 'role-evidence', statement, status: 'confirmed', sourceMessageIds: ['m1'], sensitive: false,
    });
    const store = {
      getCandidateWorkspace: () => workspace,
      getSnapshot: () => ({
        memory: [fact('a', 'VP of Technology & Operations'), fact('b', 'COO owned operations')],
        resume: null,
      }),
      getConsultantRejections: () => [{ proposalKey: `career-role:${careerRoleId('Chief Technology Officer')}` }],
      saveCandidateWorkspace: (_candidateId: string, next: CandidateWorkspaceState) => {
        workspace = next;
        return next;
      },
    };
    const logged: Array<[Record<string, unknown>, string]> = [];

    await rebuildCampaignRoles(
      { candidateStore: store } as unknown as Pick<RouteDeps, 'candidateStore' | 'campaignRoleModel'>,
      'candidate',
      { log: (fields, message) => logged.push([fields, message]) },
    );

    const roles = workspace.campaign?.auto?.roles ?? [];
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.some((role) => role.id === 'eng-mgmt.cto')).toBe(false);
    expect(workspace.campaign?.dismissed).toBeUndefined();
    expect(logged).toEqual([[{ builtBy: 'rules', roles: roles.length }, 'campaign-roles-rebuilt']]);
  });
});
