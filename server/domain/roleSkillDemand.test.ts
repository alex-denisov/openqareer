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

  describe('profile presence', () => {
    const presence = (required: string, profile: readonly string[]) => {
      const demand = buildRoleSkillDemand(
        'CTO',
        'cto',
        Array.from({ length: 5 }, (_, i) => vacancy(`p${i}`, [required])),
        profile,
        5,
      );
      return demand?.skills[0].inProfile;
    };

    it.each([
      ['AWS', 'Amazon Web Services (AWS)'],
      ['AI', 'Artificial Intelligence (AI)'],
      ['ML', 'Machine Learning (ML)'],
      ['ИИ', 'Искусственный интеллект (ИИ)'],
      ['AWS', 'AWS (Amazon Web Services)'],
      ['Amazon Web Services', 'Amazon Web Services (AWS)'],
      ['Amazon Web Services (AWS)', 'AWS'],
      ['Amazon Web Services (AWS)', 'Amazon Web Services'],
      ['Amazon Web Services (AWS)', 'Amazon Web Services (AWS)'],
    ])('%s is covered by the profile skill %s', (required, profile) => {
      expect(presence(required, [profile])).toBe(true);
    });

    it.each([
      // A short name is compared whole, never as a piece of a longer word.
      ['AI', 'Email Marketing'],
      ['AI', 'Airflow'],
      ['Go', 'Google Analytics'],
      // Brackets that are not an abbreviation of the name say nothing about it.
      ['VBA', 'Excel (VBA)'],
      ['B2', 'English (B2)'],
      // One abbreviation, two different skills.
      ['Project Management (PM)', 'Product Management (PM)'],
      // Punctuation is the whole difference between these names.
      ['C++', 'C#'],
    ])('%s is not covered by the profile skill %s', (required, profile) => {
      expect(presence(required, [profile])).toBe(false);
    });

    it('recognizes a dictionary skill inside a longer profile wording', () => {
      expect(presence('Управление проектами', ['Agile-управление проектами в финтехе'])).toBe(true);
    });
  });

  it('never lists a job title as a skill, and the freed places go to real skills', () => {
    const titles = ['CTO', 'VP-Of-Engineering', 'Director-of-Engineering', 'Head-Of-AI'];
    const named = Array.from({ length: 12 }, (_, j) => `Tool${String(j).padStart(2, '0')}`);
    const demand = buildRoleSkillDemand(
      'CTO',
      'cto',
      Array.from({ length: 6 }, (_, i) => vacancy(`t${i}`, [...titles, ...named])),
      [],
      5,
    );
    expect(demand?.skills.map((skill) => skill.name)).toEqual(named);
  });

  it('never lists a personal quality: a resume shows those through achievements', () => {
    const demand = buildRoleSkillDemand(
      'CTO',
      'cto',
      Array.from({ length: 6 }, (_, i) =>
        vacancy(`q${i}`, [
          'Communication skills',
          'Деловая коммуникация',
          'Problem solving',
          'Kafka',
        ]),
      ),
      [],
      5,
    );
    expect(demand?.skills.map((skill) => skill.name)).toEqual(['Kafka']);
  });

  it('is hidden when only job titles repeat', () => {
    const titles = Array.from({ length: 6 }, (_, i) => vacancy(`o${i}`, ['CTO']));
    expect(buildRoleSkillDemand('CTO', 'cto', titles, [], 5)).toBeNull();
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
