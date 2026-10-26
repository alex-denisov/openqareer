import { describe, expect, it } from 'vitest';
import {
  describeCareerChange,
  mergeConditions,
  withoutStoredConditionChanges,
} from './careerChangeApply';

const none = {
  roleTitle: null,
  locations: null,
  salaryFloorRubles: null,
  formats: null,
  relocation: null,
  stopCompanies: null,
};

const current = {
  citizenship: ['RU'],
  searchLocations: ['Москва', 'Удалённо из РФ'],
  taxStatus: 'resident',
  languages: [],
  workFormats: ['remote_home', 'home_market', 'office'] as const,
  salaryFloor: 600_000,
  salaryCurrency: 'RUB',
  hasFamily: true,
};

describe('изменение условий из предложения консультанта (26.10)', () => {
  it('меняет только названное кандидатом и не трогает остальное', () => {
    const next = mergeConditions(
      { ...current, workFormats: [...current.workFormats] },
      {
        ...none,
        salaryFloorRubles: 800_000,
      },
    );
    expect(next).toMatchObject({
      citizenship: ['RU'],
      searchLocations: ['Москва', 'Удалённо из РФ'],
      salaryFloor: 800_000,
      hasFamily: true,
    });
    expect([...next.workFormats].sort()).toEqual(['home_market', 'office', 'remote_home']);
  });

  it('формат заменяется целиком, релокация включается отдельно', () => {
    const next = mergeConditions(
      { ...current, workFormats: [...current.workFormats] },
      {
        ...none,
        formats: ['remote'],
        relocation: true,
      },
    );
    expect([...next.workFormats].sort()).toEqual(['relocation', 'remote_home']);
  });

  it('описывает изменение до применения', () => {
    expect(
      describeCareerChange('career.conditions.update', {
        ...none,
        salaryFloorRubles: 700_000,
        formats: ['office', 'remote'],
      }).map((line) => line.replace(/\u00a0/gu, ' ')),
    ).toEqual(['Зарплата от 700 000 ₽', 'Формат: офис, удалённо']);
    expect(describeCareerChange('career.role.add', { ...none, roleTitle: 'CTO' })).toEqual([
      'Роль: CTO',
    ]);
  });
});

describe('предложение условий из сохранённого хода (26.10)', () => {
  it('не воскресает: условия могли измениться после ответа, остальные предложения остаются', () => {
    const result = {
      message: 'm',
      actionProposals: [
        {
          kind: 'career.conditions.update',
          objective: 'o',
          careerChange: { ...none, salaryFloorRubles: 800_000 },
        },
        { kind: 'career.role.add', objective: 'o', careerChange: { ...none, roleTitle: 'CTO' } },
        { kind: 'skill.quiz', objective: 'o' },
      ],
    };
    const stored = withoutStoredConditionChanges(result);
    expect(stored?.actionProposals.map((p) => p.kind)).toEqual(['career.role.add', 'skill.quiz']);
    expect(result.actionProposals).toHaveLength(3);
    expect(withoutStoredConditionChanges(undefined)).toBeUndefined();
  });
});
