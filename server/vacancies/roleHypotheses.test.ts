import { describe, expect, it } from 'vitest';
import { buildRoleProposals, confirmChosenTitle } from './roleHypotheses';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

function matchedVacancy(title: string, skills: string[]): MatchedVacancyItem {
  return {
    cluster: {
      canonicalTitle: title,
      firstObservedAt: '2026-08-20T08:00:00.000Z',
      skills,
      sources: [{ sourceType: 'hh' }],
    },
  } as unknown as MatchedVacancyItem;
}

const named = [
  { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1'] },
  { title: 'Head of Growth', reason: 'запускал рост', evidenceRefs: ['memory:2'] },
];

describe('buildRoleProposals (B180, срез 1в)', () => {
  it('подтверждает названную роль пулом и оставляет ненайденную с честной меткой', () => {
    const roles = buildRoleProposals({
      matched: Array.from({ length: 9 }, () => matchedVacancy('Продакт-менеджер', ['SQL'])),
      named,
      candidateSkills: ['SQL'],
    });

    expect(roles.map((role) => [role.title, role.confirmation.state])).toEqual([
      ['Продакт-менеджер', 'observed'],
      ['Head of Growth', 'not-found'],
    ]);
  });

  it('не теряет роли, когда пул пуст: отсутствие вакансий — не отказ роли', () => {
    const roles = buildRoleProposals({ matched: [], named, candidateSkills: [] });

    expect(roles).toHaveLength(2);
    expect(roles.every((role) => role.confirmation.state === 'not-found')).toBe(true);
  });

  it('без названных ролей отдаёт только то, что назвал сам рынок', () => {
    const roles = buildRoleProposals({
      matched: Array.from({ length: 9 }, () => matchedVacancy('Аналитик данных', ['SQL'])),
      named: [],
      candidateSkills: [],
    });

    expect(roles).toEqual([
      expect.objectContaining({ title: 'Аналитик данных', origin: 'market' }),
    ]);
  });
});

describe('confirmChosenTitle: счёт роли мастера = счёт фильтра «Роли» (26.10)', () => {
  const at = (title: string, roleMatch: 'target' | 'partial' | 'none') =>
    ({
      ...matchedVacancy(title, ['Kubernetes']),
      explanation: { roleMatch },
    }) as unknown as MatchedVacancyItem;

  it('считает подобранные вакансии роли, а не точные совпадения заголовка', () => {
    const matched = [
      ...Array.from({ length: 5 }, () => at('VP of Engineering', 'target')),
      ...Array.from({ length: 4 }, () => at('VP Engineering, Platform', 'partial')),
      // Как в фильтре «Роли»: два общих слова («of», «technology»).
      at('Head of Technology', 'partial'),
      at('VP of Sales', 'none'),
    ];
    const confirmation = confirmChosenTitle({
      matched,
      title: 'VP of Engineering / Technology',
      candidateSkills: ['Kubernetes'],
    });
    expect(confirmation.state).toBe('observed');
    expect(confirmation.state === 'observed' && confirmation.sampleSize).toBe(10);
  });
});
