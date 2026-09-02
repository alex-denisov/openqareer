import { describe, expect, it } from 'vitest';
import { poolRoleHypotheses, type RoleObservation } from './poolRoleHypotheses';

function vacancy(
  id: string,
  title: string,
  skills: string[],
  source = 'hh',
  observedAt = '2026-08-20T08:00:00.000Z',
): RoleObservation {
  return {
    canonicalTitle: title,
    firstObservedAt: observedAt,
    skills,
    sources: [{ sourceType: source }],
  };
}

/** Восемь однотипных вакансий — минимальная выборка, ниже неё гипотезы нет. */
function pool(): RoleObservation[] {
  const pm = Array.from({ length: 9 }, (_, i) =>
    vacancy(`pm-${i}`, i % 3 === 0 ? 'Senior Product Manager' : 'Продакт-менеджер', [
      'product discovery',
      'SQL',
    ]),
  );
  const analysts = Array.from({ length: 8 }, (_, i) =>
    vacancy(`an-${i}`, 'Продуктовый аналитик', ['SQL', 'A/B тесты'], 'telegram'),
  );
  const rare = [vacancy('rare-1', 'Level Artist', ['Unreal'], 'remotive')];
  return [...pm, ...analysts, ...rare];
}

describe('poolRoleHypotheses', () => {
  it('называет роль так, как её называет рынок, а не строкой из резюме', () => {
    const [top] = poolRoleHypotheses({
      pool: pool(),
      candidateRole: 'VP of Technology, VP of Operations, CTO, or COO roles in SaaS and FinTech.',
      candidateSkills: ['product discovery', 'SQL'],
    });

    expect(top.title).toBe('Продакт-менеджер');
    expect(top.sampleSize).toBe(9);
  });

  it('каждая гипотеза несёт выборку, окно наблюдения и источники', () => {
    const [top] = poolRoleHypotheses({
      pool: pool(),
      candidateRole: 'продакт',
      candidateSkills: ['SQL'],
    });

    expect(top.observedFrom).toBe('2026-08-20T08:00:00.000Z');
    expect(top.observedTo).toBe('2026-08-20T08:00:00.000Z');
    expect(top.sources).toEqual([{ source: 'hh', count: 9 }]);
    expect(top.repeatedRequirements).toContain('SQL');
  });

  it('роль с выборкой меньше восьми гипотезой не становится', () => {
    const titles = poolRoleHypotheses({
      pool: pool(),
      candidateRole: 'Level Artist',
      candidateSkills: ['Unreal'],
    }).map((role) => role.title);

    expect(titles).not.toContain('Level Artist');
  });

  it('без пула не выдумывает ни одной роли', () => {
    expect(poolRoleHypotheses({ pool: [], candidateRole: 'кто угодно', candidateSkills: [] })).toEqual([]);
  });

  it('отдаёт не больше трёх гипотез', () => {
    expect(
      poolRoleHypotheses({ pool: pool(), candidateRole: '', candidateSkills: ['SQL'] }).length,
    ).toBeLessThanOrEqual(3);
  });
});
