import { describe, expect, it } from 'vitest';
import {
  annotateRoleHypotheses,
  resolveCampaign,
  ROLE_HYPOTHESIS_THRESHOLD,
  type CampaignMemoryFact,
} from './campaign';

function fact(partial: Partial<CampaignMemoryFact> & { statement: string }): CampaignMemoryFact {
  return {
    domain: 'other',
    kind: 'fact',
    status: 'confirmed',
    ...partial,
  };
}

describe('resolveCampaign (B247, срез 1)', () => {
  it('без явного выбора берёт подтверждённую роль профиля раньше гипотезы и резюме', () => {
    const resolution = resolveCampaign({
      memory: [
        fact({ statement: 'Head of Growth', domain: 'role-evidence', status: 'confirmed' }),
        fact({ statement: 'CPO', kind: 'hypothesis', status: 'confirmed' }),
      ],
      resumeTargetRole: 'VP Tech',
      profileRegions: ['mena'],
      explicit: null,
    });

    expect(resolution.roles).toEqual({
      value: ['Head of Growth', 'CPO', 'VP Tech'],
      origin: 'profile',
    });
    expect(resolution.regions).toEqual({ value: ['mena'], origin: 'profile' });
    expect(resolution.divergence.roles).toBeNull();
    expect(resolution.divergence.regions).toBeNull();
  });

  it('не задаёт подбор ролями, предложенными моделью и не принятыми кандидатом', () => {
    const resolution = resolveCampaign({
      memory: [
        fact({ statement: 'Product Manager', domain: 'role-evidence', status: 'proposed' }),
        fact({ statement: 'CPO', kind: 'hypothesis', status: 'proposed' }),
      ],
      resumeTargetRole: null,
      profileRegions: [],
      explicit: null,
    });

    expect(resolution.roles).toEqual({ value: [], origin: 'default' });
    expect(resolution.regions).toEqual({ value: [], origin: 'default' });
  });

  it('без профиля и без явного выбора честно возвращает пусто, а не последний случайный запрос', () => {
    const resolution = resolveCampaign({
      memory: [],
      resumeTargetRole: null,
      profileRegions: [],
      explicit: null,
    });

    expect(resolution.roles).toEqual({ value: [], origin: 'default' });
  });

  it('явный выбор побеждает профиль и указывает на расхождение с конкретными значениями', () => {
    const resolution = resolveCampaign({
      memory: [fact({ statement: 'VP Tech', domain: 'role-evidence', status: 'confirmed' })],
      resumeTargetRole: null,
      profileRegions: ['mena'],
      explicit: {
        roles: ['Product Manager'],
        regions: ['us'],
        revision: 1,
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    });

    expect(resolution.roles).toEqual({ value: ['Product Manager'], origin: 'explicit' });
    expect(resolution.regions).toEqual({ value: ['us'], origin: 'explicit' });
    expect(resolution.divergence.roles).toEqual({
      campaign: ['Product Manager'],
      profile: ['VP Tech'],
    });
    expect(resolution.divergence.regions).toEqual({
      campaign: ['us'],
      profile: ['mena'],
    });
  });

  it('явный выбор, совпадающий с профилем, не считается расхождением', () => {
    const resolution = resolveCampaign({
      memory: [fact({ statement: 'VP Tech', domain: 'role-evidence', status: 'confirmed' })],
      resumeTargetRole: null,
      profileRegions: ['mena'],
      explicit: {
        roles: ['VP Tech'],
        regions: ['mena'],
        revision: 1,
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    });

    expect(resolution.divergence.roles).toBeNull();
    expect(resolution.divergence.regions).toBeNull();
  });

  it('без счёта вакансий по ролям не размечает гипотезы вовсе', () => {
    const resolution = resolveCampaign({
      memory: [fact({ statement: 'VP Tech', domain: 'role-evidence', status: 'confirmed' })],
      resumeTargetRole: null,
      profileRegions: [],
      explicit: null,
    });

    expect(resolution.roleHypotheses).toBeUndefined();
  });

  it('роль с числом вакансий ниже порога помечается гипотезой', () => {
    const resolution = resolveCampaign({
      memory: [
        fact({ statement: 'VP Tech', domain: 'role-evidence', status: 'confirmed' }),
        fact({ statement: 'CPO', kind: 'hypothesis', status: 'confirmed' }),
      ],
      resumeTargetRole: null,
      profileRegions: [],
      explicit: null,
      vacancyCountsByRole: { 'VP Tech': 12, CPO: 3 },
    });

    expect(resolution.roleHypotheses).toEqual([
      { role: 'VP Tech', vacancyCount: 12, isHypothesis: false },
      { role: 'CPO', vacancyCount: 3, isHypothesis: true },
    ]);
  });

  it('роль без записи в счётчике считается нулём вакансий и тоже гипотезой', () => {
    const resolution = resolveCampaign({
      memory: [fact({ statement: 'VP Tech', domain: 'role-evidence', status: 'confirmed' })],
      resumeTargetRole: null,
      profileRegions: [],
      explicit: null,
      vacancyCountsByRole: {},
    });

    expect(resolution.roleHypotheses).toEqual([
      { role: 'VP Tech', vacancyCount: 0, isHypothesis: true },
    ]);
  });
});

describe('annotateRoleHypotheses (B247, срез 2)', () => {
  it('использует порог значимости по умолчанию — 8 вакансий', () => {
    expect(ROLE_HYPOTHESIS_THRESHOLD).toBe(8);
    expect(annotateRoleHypotheses(['Role A'], { 'Role A': 7 })).toEqual([
      { role: 'Role A', vacancyCount: 7, isHypothesis: true },
    ]);
    expect(annotateRoleHypotheses(['Role A'], { 'Role A': 8 })).toEqual([
      { role: 'Role A', vacancyCount: 8, isHypothesis: false },
    ]);
  });

  it('принимает собственный порог', () => {
    expect(annotateRoleHypotheses(['Role A'], { 'Role A': 5 }, 3)).toEqual([
      { role: 'Role A', vacancyCount: 5, isHypothesis: false },
    ]);
  });
});
