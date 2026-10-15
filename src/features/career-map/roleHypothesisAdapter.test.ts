import { describe, expect, it } from 'vitest';
import type { ProposedRole } from '../../../shared/roleProposals';
import { mapProposedRoleToCareerRole } from './roleHypothesisAdapter';

describe('roleHypothesisAdapter', () => {
  it('maps an observed role with sufficient sample size to an active career role model', () => {
    const proposed: ProposedRole = {
      id: 'role-cto',
      title: 'CTO в финтехе',
      origin: 'model',
      reason: 'Платёжные системы в опыте совпадают с требованиями к CTO в финтехе.',
      evidenceRefs: ['m-resp-1'],
      confirmation: {
        state: 'observed',
        sampleSize: 41,
        observedFrom: '2026-09-01',
        observedTo: '2026-10-05',
        sources: [{ source: 'hh.ru', count: 41 }],
        repeatedRequirements: ['Опыт совета директоров', 'Регуляторика ЦБ'],
        matchedRequirements: 1,
      },
      family: 'СП',
    };

    const mapped = mapProposedRoleToCareerRole(proposed);

    expect(mapped.id).toBe('role-cto');
    expect(mapped.title).toBe('CTO в финтехе');
    expect(mapped.status).toBe('skills_checked');
    expect(mapped.vacancyCount).toBe(41);
    expect(mapped.isWageCalculated).toBe(true);
    expect(mapped.sampleNote).toContain('41');
    expect(mapped.nextAction.action).toBe('check_skills');
    expect(mapped.missingItems).toHaveLength(1);
    expect(mapped.missingItems[0].text).toBe('Регуляторика ЦБ');
  });

  it('maps a role with too few observations to hypothesis with suppressed wage fork', () => {
    const proposed: ProposedRole = {
      id: 'role-vp',
      title: 'VP Engineering',
      origin: 'model',
      reason: 'Управление крупными инженерными командами.',
      evidenceRefs: ['m-exp-1'],
      confirmation: {
        state: 'too-few',
        sampleSize: 4,
      },
      family: 'СП',
    };

    const mapped = mapProposedRoleToCareerRole(proposed);

    expect(mapped.id).toBe('role-vp');
    expect(mapped.title).toBe('VP Engineering');
    expect(mapped.status).toBe('hypothesis');
    expect(mapped.vacancyCount).toBe(4);
    expect(mapped.isWageCalculated).toBe(false);
    expect(mapped.wageDisplay).toBe('вилка не считается');
    expect(mapped.nextAction.action).toBe('fill_with_consultant');
  });

  it('maps a role with not-found confirmation to hypothesis with few_data action', () => {
    const proposed: ProposedRole = {
      id: 'role-arch',
      title: 'Principal Architect',
      origin: 'model',
      reason: null,
      evidenceRefs: [],
      confirmation: {
        state: 'not-found',
      },
      family: null,
    };

    const mapped = mapProposedRoleToCareerRole(proposed);

    expect(mapped.id).toBe('role-arch');
    expect(mapped.title).toBe('Principal Architect');
    expect(mapped.status).toBe('hypothesis');
    expect(mapped.vacancyCount).toBe(0);
    expect(mapped.isWageCalculated).toBe(false);
    expect(mapped.wageDisplay).toBe('вилка не считается');
    expect(mapped.sampleNote).toBe('нет вакансий');
    expect(mapped.nextAction.action).toBe('few_data');
  });

  it('formats the observation date as DD.MM from a full ISO timestamp', () => {
    const proposed: ProposedRole = {
      id: 'role-dir',
      title: 'Технический директор',
      origin: 'model',
      reason: 'Опыт совпадает.',
      evidenceRefs: [],
      confirmation: {
        state: 'observed',
        sampleSize: 83,
        observedFrom: '2026-09-01T00:00:00.000+03:00',
        observedTo: '2026-10-14T18:31:16.263+03:00',
        sources: [{ source: 'hh.ru', count: 83 }],
        repeatedRequirements: [],
        matchedRequirements: 0,
      },
      family: 'СП',
    };

    expect(mapProposedRoleToCareerRole(proposed).observedDate).toBe('14.10');
  });
});
