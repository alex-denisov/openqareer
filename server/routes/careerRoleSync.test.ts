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
    const store = fakeStore({ campaign }, [careerRoleId('CIO')]);
    const prioritizeCampaign = vi.fn();
    const changed = persistCareerRoles(
      { candidateStore: store as never, matchedPoolPrecompute: { prioritizeCampaign } as never },
      'c1',
      [
        role('Head of Product'),
        role('CIO'),
        role('Engineering Lead', 'market'),
        role('VP of Engineering'),
      ],
    );
    expect(changed).toBe(true);
    expect(store.getCandidateWorkspace()?.campaign?.careerRoles).toEqual([
      { id: careerRoleId('Head of Product'), title: 'Head of Product' },
      { id: careerRoleId('Engineering Lead'), title: 'Engineering Lead' },
    ]);
    expect(prioritizeCampaign).toHaveBeenCalledWith('c1');
  });

  it('не пишет, когда набор ролей не изменился', () => {
    const store = fakeStore({
      campaign: { ...campaign, careerRoles: [{ id: careerRoleId('CIO'), title: 'CIO' }] },
    });
    expect(persistCareerRoles({ candidateStore: store as never }, 'c1', [role('CIO')])).toBe(false);
    expect(store.saveCandidateWorkspace).not.toHaveBeenCalled();
  });

  it('показывает на «Карьере» роль из мастера, которой нет среди названных', () => {
    const store = fakeStore({ campaign });
    const context = {
      proposals: [role('CIO')],
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
      ['CIO', 'model'],
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

describe('одна роль под разными названиями — одна строка (26.10)', () => {
  it('роль рынка той же функции и уровня, что роль мастера, не дублирует её', () => {
    const store = fakeStore({ campaign: { ...campaign, roles: ['Технический директор'] } });
    const context = {
      proposals: [role('Технический директор (CTO)', 'market'), role('Head of AI')],
      matched: [],
      confirmedSkills: [],
    } as unknown as RoleContext;
    const roles = careerRolesWithCandidateChoices(
      { candidateStore: store as never },
      'c1',
      context,
    );
    expect(roles.map((r) => r.title)).toEqual(['Технический директор', 'Head of AI']);
  });

  it('в подбор не пишется второе название роли мастера', () => {
    const store = fakeStore({ campaign: { ...campaign, roles: ['Операционный директор (COO)'] } });
    persistCareerRoles({ candidateStore: store as never }, 'c1', [
      role('Chief Operating Officer', 'market'),
      role('Head of Support'),
    ]);
    expect(store.getCandidateWorkspace()?.campaign?.careerRoles).toEqual([
      { id: careerRoleId('Head of Support'), title: 'Head of Support' },
    ]);
  });

  it('держит в подборе больше десяти ролей, подтверждённых опытом', () => {
    const store = fakeStore({ campaign: { ...campaign, roles: [] } });
    const titles = Array.from({ length: 14 }, (_, index) => `Role number${'x'.repeat(index + 1)}`);
    persistCareerRoles(
      { candidateStore: store as never },
      'c1',
      titles.map((title) => role(title)),
    );
    expect(store.getCandidateWorkspace()?.campaign?.careerRoles).toHaveLength(14);
  });
});

describe('роли «Карьеры» задают сбор вакансий (27.10)', () => {
  it('отдаёт роли кандидата, включая роль мастера, в спрос площадок', () => {
    const store = fakeStore({ campaign: { ...campaign, roles: ['Head of AI'] } });
    const record = vi.fn();
    persistCareerRoles(
      { candidateStore: store as never, vacancyDemand: { record, recentTerms: () => [] } },
      'c1',
      [role('Head of AI', 'candidate'), role('Руководитель службы поддержки')],
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toEqual([
      'head of ai',
      'head of customer support',
      'руководитель службы поддержки',
    ]);
  });
});

describe('роли рынка — только в направлениях опыта кандидата (27.10)', () => {
  it('убирает роль рынка чужой функции, когда роли по опыту известны', () => {
    const store = fakeStore({ campaign: { ...campaign, roles: ['VP of Engineering'] } });
    const context = {
      proposals: [
        role('Head of AI'),
        role('Руководитель автосервиса', 'market'),
        role('Head of Data', 'market'),
      ],
      matched: [],
      confirmedSkills: [],
    } as unknown as RoleContext;
    const roles = careerRolesWithCandidateChoices(
      { candidateStore: store as never },
      'c1',
      context,
    );
    expect(roles.map((r) => r.title)).toEqual(['VP of Engineering', 'Head of AI']);
  });

  it('без ролей по опыту роли рынка остаются', () => {
    const store = fakeStore({ campaign: { ...campaign, roles: [] } });
    const context = {
      proposals: [role('Chief of Staff', 'market')],
      matched: [],
      confirmedSkills: [],
    } as unknown as RoleContext;
    const roles = careerRolesWithCandidateChoices(
      { candidateStore: store as never },
      'c1',
      context,
    );
    expect(roles.map((r) => r.title)).toEqual(['Chief of Staff']);
  });

  it('роли рынка не становятся запросами к площадкам', () => {
    const store = fakeStore({ campaign: { ...campaign, roles: [] } });
    const record = vi.fn();
    persistCareerRoles(
      { candidateStore: store as never, vacancyDemand: { record, recentTerms: () => [] } },
      'c1',
      [role('Head of AI'), role('Logistics Manager', 'market')],
    );
    expect(record.mock.calls[0]?.[0]).toEqual(['head of ai']);
  });
});
