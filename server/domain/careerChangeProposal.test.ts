import { describe, expect, it } from 'vitest';
import { careerActionProposalSchema } from './coach';

const base = {
  objective: 'Добавить роль в «Карьеру»',
  evidenceRefs: ['memory:1'],
  acceptanceCriteria: ['Роль видна в «Карьере» и в фильтре «Вакансий»'],
  expectedSignal: 'Вакансии по роли появились в подборке',
  measureAfter: '2026-11-02',
  risk: 'candidate_data_write' as const,
  resumeRevision: null,
};
const empty = {
  roleTitle: null,
  locations: null,
  salaryFloorRubles: null,
  formats: null,
  relocation: null,
  stopCompanies: null,
};

describe('изменения «Карьеры» от консультанта (26.10)', () => {
  it('принимает добавление и удаление роли только с названием роли', () => {
    for (const kind of ['career.role.add', 'career.role.remove'] as const) {
      expect(
        careerActionProposalSchema.safeParse({
          ...base,
          kind,
          careerChange: { ...empty, roleTitle: 'CTO' },
        }).success,
      ).toBe(true);
      expect(
        careerActionProposalSchema.safeParse({ ...base, kind, careerChange: empty }).success,
      ).toBe(false);
      expect(
        careerActionProposalSchema.safeParse({
          ...base,
          kind,
          careerChange: { ...empty, roleTitle: 'CTO', salaryFloorRubles: 1 },
        }).success,
      ).toBe(false);
    }
  });

  it('изменение условий требует хотя бы одно условие и не называет роль', () => {
    const kind = 'career.conditions.update';
    expect(
      careerActionProposalSchema.safeParse({
        ...base,
        kind,
        careerChange: { ...empty, salaryFloorRubles: 700_000, formats: ['remote'] },
      }).success,
    ).toBe(true);
    expect(
      careerActionProposalSchema.safeParse({ ...base, kind, careerChange: empty }).success,
    ).toBe(false);
    expect(
      careerActionProposalSchema.safeParse({ ...base, kind, careerChange: null }).success,
    ).toBe(false);
  });

  it('прочие действия не несут изменения «Карьеры»', () => {
    expect(
      careerActionProposalSchema.safeParse({
        ...base,
        kind: 'vacancies.search',
        careerChange: { ...empty, roleTitle: 'CTO' },
      }).success,
    ).toBe(false);
    expect(
      careerActionProposalSchema.safeParse({ ...base, kind: 'vacancies.search' }).success,
    ).toBe(true);
  });
});
