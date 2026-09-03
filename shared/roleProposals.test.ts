import { describe, expect, it } from 'vitest';
import type { RoleObservation } from './poolRoleHypotheses';
import { proposeRoles, type NamedRole } from './roleProposals';

function vacancy(title: string, skills: string[] = ['SQL'], source = 'hh'): RoleObservation {
  return {
    canonicalTitle: title,
    firstObservedAt: '2026-08-20T08:00:00.000Z',
    skills,
    sources: [{ sourceType: source }],
  };
}

function named(title: string, reason = 'девять лет вёл внутренние продукты'): NamedRole {
  return { title, reason, evidenceRefs: ['document:resume'] };
}

describe('proposeRoles', () => {
  it('оставляет названную моделью роль, которой нет в пуле, вместо отказа', () => {
    const roles = proposeRoles({
      named: [named('Head of Growth')],
      pool: [],
      candidateSkills: [],
    });

    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      title: 'Head of Growth',
      origin: 'model',
      confirmation: { state: 'not-found' },
    });
  });

  it('показывает абсолютное число и не агрегирует требования, когда наблюдений меньше восьми', () => {
    const roles = proposeRoles({
      named: [named('Продакт-менеджер')],
      pool: Array.from({ length: 7 }, () => vacancy('Продакт-менеджер')),
      candidateSkills: [],
    });

    expect(roles[0].confirmation).toEqual({ state: 'too-few', sampleSize: 7 });
  });

  it('подтверждает роль числами, когда наблюдений хватает', () => {
    const roles = proposeRoles({
      named: [named('Продакт-менеджер')],
      pool: Array.from({ length: 9 }, () => vacancy('Продакт-менеджер', ['SQL', 'discovery'])),
      candidateSkills: ['SQL'],
    });

    expect(roles[0].confirmation).toMatchObject({
      state: 'observed',
      sampleSize: 9,
      sources: [{ source: 'hh', count: 9 }],
      matchedRequirements: 1,
    });
  });

  it('склеивает имя модели и имя рынка в одну строку', () => {
    const roles = proposeRoles({
      named: [named('Product Manager')],
      pool: Array.from({ length: 9 }, () => vacancy('Продакт-менеджер')),
      candidateSkills: [],
    });

    expect(roles).toHaveLength(1);
    expect(roles[0].origin).toBe('model');
    expect(roles[0].confirmation).toMatchObject({ state: 'observed', sampleSize: 9 });
  });

  it('добавляет роль, которую назвал рынок, а модель не назвала', () => {
    const roles = proposeRoles({
      named: [named('Head of Growth')],
      pool: Array.from({ length: 9 }, () => vacancy('Аналитик данных')),
      candidateSkills: [],
    });

    expect(roles.map((role) => role.origin)).toEqual(['market', 'model']);
    expect(roles[0].title).toBe('Аналитик данных');
    expect(roles[0].reason).toBeNull();
  });

  it('отбрасывает роль, которую модель не объяснила фактом резюме', () => {
    const roles = proposeRoles({
      named: [{ title: 'Космонавт', reason: '', evidenceRefs: [] }],
      pool: [],
      candidateSkills: [],
    });

    expect(roles).toEqual([]);
  });

  it('не даёт модели задавать порядок: перестановка входа не меняет выход', () => {
    const pool = [
      ...Array.from({ length: 9 }, () => vacancy('Аналитик данных')),
      ...Array.from({ length: 12 }, () => vacancy('Продакт-менеджер')),
    ];
    const first = proposeRoles({
      named: [named('Аналитик данных'), named('Продакт-менеджер'), named('Head of Growth')],
      pool,
      candidateSkills: [],
    });
    const second = proposeRoles({
      named: [named('Head of Growth'), named('Продакт-менеджер'), named('Аналитик данных')],
      pool,
      candidateSkills: [],
    });

    expect(second).toEqual(first);
    expect(first.map((role) => role.title)).toEqual([
      'Продакт-менеджер',
      'Аналитик данных',
      'Head of Growth',
    ]);
  });
});

describe('proposeRoles: что считается одной ролью', () => {
  it('грейд и формат не расщепляют роль', () => {
    const roles = proposeRoles({
      named: [named('Продакт-менеджер')],
      pool: [
        ...Array.from({ length: 5 }, () => vacancy('Senior Product Manager')),
        ...Array.from({ length: 4 }, () => vacancy('Ведущий продакт-менеджер (удалённо)')),
      ],
      candidateSkills: [],
    });

    expect(roles[0].confirmation).toMatchObject({ state: 'observed', sampleSize: 9 });
  });

  it('разные роли не сливаются в одну', () => {
    const roles = proposeRoles({
      named: [named('Менеджер по продукту'), named('Менеджер по закупкам')],
      pool: [
        ...Array.from({ length: 9 }, () => vacancy('Менеджер по продукту')),
        ...Array.from({ length: 9 }, () => vacancy('Менеджер по закупкам')),
      ],
      candidateSkills: [],
    });

    expect(roles.map((role) => sample(role))).toEqual([9, 9]);
  });
});

function sample(role: { confirmation: { state: string; sampleSize?: number } }): number {
  return role.confirmation.sampleSize ?? 0;
}
