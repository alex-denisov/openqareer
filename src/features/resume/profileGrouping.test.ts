import { describe, expect, it } from 'vitest';
import { categorizeSkills, groupExperienceByEmployer } from './profileGrouping';
import type { ResumeExperienceInput, ResumeSkillInput } from './resumeTypes';

function exp(overrides: Partial<ResumeExperienceInput>): ResumeExperienceInput {
  return {
    id: 'exp-1',
    chronologyMemoryId: 'mem-exp-1',
    current: false,
    bulletMemoryIds: [],
    ...overrides,
  };
}

describe('groupExperienceByEmployer', () => {
  it('groups consecutive roles at the same employer under one heading', () => {
    const groups = groupExperienceByEmployer([
      exp({ id: 'e1', employer: 'FinNova Bank', title: 'VP of Engineering' }),
      exp({ id: 'e2', employer: 'FinNova Bank', title: 'Director of Engineering' }),
      exp({ id: 'e3', employer: 'Quantel Systems', title: 'Engineering Manager' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].employer).toBe('FinNova Bank');
    expect(groups[0].positions).toHaveLength(2);
    expect(groups[1].employer).toBe('Quantel Systems');
    expect(groups[1].positions).toHaveLength(1);
  });

  it('prefers an explicit employerGroupKey over the employer name', () => {
    const groups = groupExperienceByEmployer([
      exp({ id: 'e1', employer: 'FinNova GmbH', employerGroupKey: 'finnova' }),
      exp({ id: 'e2', employer: 'FinNova Bank AG', employerGroupKey: 'finnova' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].positions).toHaveLength(2);
  });

  it('gives every entry with a missing employer its own group instead of merging them', () => {
    const groups = groupExperienceByEmployer([exp({ id: 'e1' }), exp({ id: 'e2' })]);
    expect(groups).toHaveLength(2);
    expect(groups[0].employer).toBe('');
  });

  it('returns no groups for an empty experience list', () => {
    expect(groupExperienceByEmployer([])).toEqual([]);
  });
});

function skill(name: string): ResumeSkillInput {
  return { id: name, name };
}

describe('categorizeSkills', () => {
  it('places known skills into their deterministic category', () => {
    const groups = categorizeSkills([
      skill('Kubernetes'),
      skill('Roadmapping'),
      skill('TypeScript'),
      skill('PCI DSS'),
    ]);
    const byLabel = new Map(groups.map((g) => [g.label, g.skills.map((s) => s.name)]));
    expect(byLabel.get('Управление и стратегия')).toEqual(['Roadmapping']);
    expect(byLabel.get('Платформа и инфраструктура')).toEqual(['Kubernetes']);
    expect(byLabel.get('Языки и фреймворки')).toEqual(['TypeScript']);
    expect(byLabel.get('Продукт и комплаенс')).toEqual(['PCI DSS']);
  });

  it('files an unrecognized skill under "Другое" instead of dropping it', () => {
    const groups = categorizeSkills([skill('Underwater Basket Weaving')]);
    const other = groups.find((g) => g.label === 'Другое');
    expect(other?.skills.map((s) => s.name)).toEqual(['Underwater Basket Weaving']);
  });

  it('omits empty categories', () => {
    const groups = categorizeSkills([skill('Go')]);
    expect(groups.map((g) => g.label)).toEqual(['Языки и фреймворки']);
  });

  it('returns no groups for an empty skill list', () => {
    expect(categorizeSkills([])).toEqual([]);
  });
});
