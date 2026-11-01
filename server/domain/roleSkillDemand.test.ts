import { describe, expect, it } from 'vitest';
import type { RoleAssessmentVacancy } from './roleSkillAssessment';
import { buildRoleSkillDemand, ROLE_SKILL_DEMAND_TOP } from './roleSkillDemand';

const vacancy = (
  id: string,
  skills: readonly string[],
  observedAt = '2026-11-01T10:00:00.000Z',
  over: Partial<RoleAssessmentVacancy> = {},
): RoleAssessmentVacancy => ({
  id,
  roleId: 'cto',
  status: 'active',
  freshness: 'fresh',
  requirements: skills.map((statement) => ({
    id: `${id}-${statement}`,
    skillId: statement.toLowerCase(),
    statement,
    sourceRefs: [{ id: `${id}-ref`, vacancyId: id, observedAt, sourceName: 'hh.ru' }],
  })),
  ...over,
});

describe('buildRoleSkillDemand', () => {
  const sample = Array.from({ length: 10 }, (_, i) =>
    vacancy(
      `v${i}`,
      i < 8 ? ['Kubernetes', 'AWS', ...(i < 3 ? ['Go'] : [])] : ['AWS'],
      `2026-10-2${i % 9}T00:00:00.000Z`,
    ),
  );

  it('ranks skills by how many vacancies require them and marks profile presence', () => {
    const demand = buildRoleSkillDemand('CTO', 'cto', sample, ['aws', 'Python'], 5);
    expect(demand).toMatchObject({
      roleTitle: 'CTO',
      sampleSize: 10,
      observedAt: '2026-10-28T00:00:00.000Z',
    });
    expect(demand?.skills).toEqual([
      { name: 'AWS', vacancies: 10, inProfile: true },
      { name: 'Kubernetes', vacancies: 8, inProfile: false },
      { name: 'Go', vacancies: 3, inProfile: false },
    ]);
  });

  it('counts a skill once per vacancy and ignores stale, closed and other-role vacancies', () => {
    const extra = [
      vacancy('dup', ['Go', 'go']),
      vacancy('stale', ['Go'], undefined, { freshness: 'stale' }),
      vacancy('closed', ['Go'], undefined, { status: 'closed' }),
      vacancy('other', ['Go'], undefined, { roleId: 'cfo' }),
    ];
    const demand = buildRoleSkillDemand('CTO', 'cto', [...sample, ...extra], [], 5);
    expect(demand?.sampleSize).toBe(11);
    expect(demand?.skills.find((s) => s.name === 'Go')?.vacancies).toBe(4);
  });

  it('is hidden below the sample threshold', () => {
    expect(buildRoleSkillDemand('CTO', 'cto', sample.slice(0, 4), [], 5)).toBeNull();
  });

  it('is hidden when no skill repeats in two vacancies', () => {
    const lone = Array.from({ length: 6 }, (_, i) => vacancy(`u${i}`, [`Skill ${i}`]));
    expect(buildRoleSkillDemand('CTO', 'cto', lone, [], 5)).toBeNull();
  });

  it('keeps only the top skills', () => {
    const wide = Array.from({ length: 6 }, (_, i) =>
      vacancy(
        `w${i}`,
        Array.from({ length: 20 }, (_, j) => `S${j}`),
      ),
    );
    expect(buildRoleSkillDemand('CTO', 'cto', wide, [], 5)?.skills).toHaveLength(
      ROLE_SKILL_DEMAND_TOP,
    );
  });
});
