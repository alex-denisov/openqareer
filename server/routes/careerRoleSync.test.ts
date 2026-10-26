import { describe, expect, it, vi } from 'vitest';
import type { ProposedRole } from '../../shared/roleProposals';
import { careerRoleId } from '../../shared/roleProposals';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import { careerRolesWithCandidateChoices, persistCareerRoles } from './careerRoleSync';
import type { RoleContext } from './vacancyRoleContext';

function role(title: string, origin: ProposedRole['origin'] = 'model'): ProposedRole {
  return {
    id: careerRoleId(title),
    title,
    origin,
    reason: origin === 'model' ? 'по профилю' : null,
    evidenceRefs: origin === 'model' ? ['memory:1'] : [],
    confirmation: { state: 'not-found' },
    family: null,
  };
}

function fakeStore(workspace: Partial<CandidateWorkspaceState> | null, rejected: string[] = []) {
  let saved = workspace as CandidateWorkspaceState | null;
  return {
    getCandidateWorkspace: () => saved,
    saveCandidateWorkspace: vi.fn((_id: string, next: CandidateWorkspaceState) => {
      saved = next;
      return next;
    }),
    getConsultantRejections: () =>
      rejected.map((id) => ({ proposalKey: `career-role:${id}`, reason: null, createdAt: '' })),
  };
}

const campaign = { roles: ['VP of Engineering'], regions: [], revision: 1, updatedAt: 'x' };

describe('роли «Карьеры» задают подбор (26.10)', () => {
  it('сохраняет показанные роли без отклонённых и уже выбранных в мастере', () => {
    const store = fakeStore({ campaign }, [careerRoleId('CTO')]);
    const prioritizeCampaign = vi.fn();
    const changed = persistCareerRoles(
      { candidateStore: store as never, matchedPoolPrecompute: { prioritizeCampaign } as never },
      'c1',
      [
        role('Head of Engineering'),
        role('CTO'),
        role('Engineering Lead', 'market'),
        role('VP of Engineering'),
      ],
    );
    expect(changed).toBe(true);
    expect(store.getCandidateWorkspace()?.campaign?.careerRoles).toEqual([
      { id: careerRoleId('Head of Engineering'), title: 'Head of Engineering' },
      { id: careerRoleId('Engineering Lead'), title: 'Engineering Lead' },
    ]);
    expect(prioritizeCampaign).toHaveBeenCalledWith('c1');
  });

  it('не пишет, когда набор ролей не изменился', () => {
    const store = fakeStore({
      campaign: { ...campaign, careerRoles: [{ id: careerRoleId('CTO'), title: 'CTO' }] },
    });
    expect(persistCareerRoles({ candidateStore: store as never }, 'c1', [role('CTO')])).toBe(false);
    expect(store.saveCandidateWorkspace).not.toHaveBeenCalled();
  });

  it('показывает на «Карьере» роль из мастера, которой нет среди названных', () => {
    const store = fakeStore({ campaign });
    const context = {
      proposals: [role('CTO')],
      matched: [],
      confirmedSkills: [],
    } as unknown as RoleContext;
    const roles = careerRolesWithCandidateChoices(
      { candidateStore: store as never },
      'c1',
      context,
    );
    expect(roles.map((r) => [r.title, r.origin])).toEqual([
      ['VP of Engineering', 'candidate'],
      ['CTO', 'model'],
    ]);
  });

  it('считает роль мастера по списку «Вакансий» (география и решения уже учтены)', () => {
    const store = fakeStore({ campaign });
    const vacancy = (title: string) => ({
      cluster: { canonicalTitle: title, firstObservedAt: '2026-10-20', skills: [], sources: [] },
      explanation: { roleMatch: 'target' },
    });
    const context = {
      proposals: [],
      matched: Array.from({ length: 12 }, () => vacancy('VP of Engineering')),
      confirmedSkills: [],
    } as unknown as RoleContext;
    const listed = Array.from({ length: 9 }, () => vacancy('VP of Engineering'));
    const [wizard] = careerRolesWithCandidateChoices(
      { candidateStore: store as never },
      'c1',
      context,
      listed as never,
    );
    expect(wizard?.confirmation.state === 'observed' && wizard.confirmation.sampleSize).toBe(9);
  });
});
