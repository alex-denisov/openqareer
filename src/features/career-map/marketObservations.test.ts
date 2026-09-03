import { describe, expect, it } from 'vitest';
import { poolMarketObservations } from './marketObservations';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

function vacancy(
  id: string,
  overrides: Partial<MatchedVacancyItem['cluster']> = {},
): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: 'Руководитель продукта',
      canonicalCompany: 'FinCloud',
      canonicalLocation: 'Москва',
      isRemote: false,
      descriptionSummary: '',
      skills: ['SQL', 'аналитика'],
      primaryUrl: `https://hh.ru/vacancy/${id}`,
      sources: [
        {
          sourceType: 'hh',
          sourceId: id,
          sourceUrl: `https://hh.ru/vacancy/${id}`,
          observedAt: '2026-09-01T08:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-09-01T08:00:00.000Z',
      lastSeenAt: '2026-09-02T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
      ...overrides,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'none',
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-02T08:00:00.000Z',
    },
  } as MatchedVacancyItem;
}

describe('poolMarketObservations', () => {
  it('раскладывает собранный пул по рынкам кандидата', () => {
    const observations = poolMarketObservations([
      vacancy('1'),
      vacancy('2', { isRemote: true, canonicalLocation: 'Удалённо' }),
    ]);

    expect(observations.russia).toHaveLength(1);
    expect(observations['worldwide-remote']).toHaveLength(1);
    expect(observations.russia[0]).toMatchObject({
      roleTitle: 'Руководитель продукта',
      observedAt: '2026-09-01T08:00:00.000Z',
      requirements: ['SQL', 'аналитика'],
    });
  });

  it('не приписывает рынку запись, географию которой продукт не знает', () => {
    const observations = poolMarketObservations([
      vacancy('3', {
        isRemote: false,
        canonicalLocation: 'Berlin',
        sources: [
          {
            sourceType: 'remotive',
            sourceId: '3',
            sourceUrl: 'https://remotive.com/3',
            observedAt: '2026-09-01T08:00:00.000Z',
          },
        ],
      }),
    ]);

    expect(observations.russia).toHaveLength(0);
    expect(observations['worldwide-remote']).toHaveLength(0);
  });

  it('называет источник наблюдения так же, как его называет продукт', () => {
    const [observation] = poolMarketObservations([vacancy('4')]).russia;
    expect(observation.sourceLabel).toBe('hh.ru');
  });
});
