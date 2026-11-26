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
  { title: 'Продакт-менеджер', reason: 'вёл продукты', evidenceRefs: ['memory:1', 'memory:1b'] },
  { title: 'Head of Growth', reason: 'запускал рост', evidenceRefs: ['memory:2', 'memory:2b'] },
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
      matched: Array.from({ length: 9 }, () =>
        matchedVacancy('Аналитик данных', ['SQL', 'Python']),
      ),
      named: [],
      candidateSkills: ['SQL', 'Python'],
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

describe('вилка роли по зарплатам в валюте (28.10)', () => {
  it('считает вилку по годовым долларовым зарплатам, а не «вилка не считается»', async () => {
    const { setCurrencyRates } = await import('../currency/cbrRates');
    setCurrencyRates({ date: '2026-10-27', rubPerUnit: { USD: 80 } });
    const paid = (from: number, to: number) =>
      ({
        ...matchedVacancy('VP of Engineering', ['Kubernetes']),
        cluster: {
          ...matchedVacancy('VP of Engineering', ['Kubernetes']).cluster,
          salary: { from, to, currency: 'USD' },
        },
        explanation: { roleMatch: 'target' },
      }) as unknown as MatchedVacancyItem;
    const confirmation = confirmChosenTitle({
      matched: Array.from({ length: 9 }, () => paid(240_000, 300_000)),
      title: 'VP of Engineering',
      candidateSkills: [],
    });
    setCurrencyRates(undefined);

    expect(confirmation.state).toBe('observed');
    expect(confirmation.state === 'observed' && confirmation.wage).toEqual({
      sampleSize: 9,
      min: 1_600_000,
      max: 2_000_000,
    });
  });
});

describe('B767: два варианта одной роли словаря — одна строка', () => {
  const twoVariants = [
    {
      title: 'Head of Technical Support',
      reason: 'руководил поддержкой',
      evidenceRefs: ['memory:1', 'memory:2'],
    },
    {
      title: 'Customer Support Director',
      reason: 'руководил поддержкой',
      evidenceRefs: ['memory:1', 'memory:2'],
    },
  ];
  const pool = [
    ...Array.from({ length: 6 }, () => matchedVacancy('Head of Technical Support', ['SLA'])),
    ...Array.from({ length: 4 }, () => matchedVacancy('Customer Support Director', ['SLA'])),
    ...Array.from({ length: 3 }, () => matchedVacancy('VP of Customer Support', ['SLA'])),
  ];

  it('сводит их в одну роль: вакансии объединены без двойного счёта, второе название — псевдоним', () => {
    const roles = buildRoleProposals({
      matched: pool,
      named: twoVariants,
      candidateSkills: ['SLA'],
    });
    const support = roles.filter((role) => role.origin === 'model');
    expect(support).toHaveLength(1);
    expect(support[0]!.title).toBe('Head of Technical Support');
    expect(support[0]!.aliases).toEqual(
      expect.arrayContaining(['Head of Technical Support', 'Customer Support Director']),
    );
    const conf = support[0]!.confirmation;
    expect(conf.state === 'observed' && conf.sampleSize).toBe(10);
  });

  it('второе название остаётся псевдонимом, даже если вакансий с ним нет: проверки и отметки идут за ним', () => {
    const roles = buildRoleProposals({
      matched: pool.filter((item) => item.cluster.canonicalTitle !== 'Customer Support Director'),
      named: twoVariants,
      candidateSkills: ['SLA'],
    });
    const [support] = roles.filter((role) => role.origin === 'model');
    expect(support!.aliases).toContain('Customer Support Director');
  });

  it('вице-президент поддержки — другая роль словаря и в строку не входит', () => {
    const roles = buildRoleProposals({
      matched: pool,
      named: [
        ...twoVariants,
        { title: 'VP of Customer Support', reason: 'r', evidenceRefs: ['memory:1', 'memory:2'] },
      ],
      candidateSkills: ['SLA'],
    });
    expect(roles.filter((role) => role.origin === 'model').map((role) => role.title)).toEqual(
      expect.arrayContaining(['Head of Technical Support', 'VP of Customer Support']),
    );
    expect(roles.filter((role) => role.origin === 'model')).toHaveLength(2);
  });
});
