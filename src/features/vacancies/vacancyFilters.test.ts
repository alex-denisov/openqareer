import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import {
  filterVacancies,
  vacancyAge,
  vacancyCoverage,
  vacancySourceNames,
} from './vacancyFilters';

const NOW = '2026-09-01T12:00:00.000Z';

function item(
  id: string,
  overrides: Partial<MatchedVacancyItem['cluster']> = {},
  explanation: Partial<MatchedVacancyItem['explanation']> = {},
): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: 'Продуктовый аналитик',
      canonicalCompany: 'FinCloud',
      canonicalLocation: 'Москва',
      isRemote: true,
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.test/1',
      sources: [
        {
          sourceType: 'telegram',
          sourceId: 'ch-1',
          sourceUrl: 'https://example.test/1',
          observedAt: '2026-08-30T12:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-08-30T12:00:00.000Z',
      lastSeenAt: NOW,
      status: 'active',
      vacanciesCount: 1,
      ...overrides,
    } as MatchedVacancyItem['cluster'],
    explanation: {
      clusterId: id,
      matchScore: 0.7,
      fitLevel: 'good',
      matchingPoints: ['SQL', 'A/B-тесты'],
      missingPoints: ['Kubernetes'],
      summary: '',
      calculatedAt: NOW,
      ...explanation,
    },
  };
}

/**
 * Возраст вакансии — узел 15 пути B165. Кластер знает только, когда его
 * впервые увидел сбор, поэтому продукт имеет право говорить «в базе N дней», а
 * не «опубликована N дней назад»: даты публикации в кластере нет.
 */
describe('vacancyAge', () => {
  it('считает дни с первого наблюдения', () => {
    expect(vacancyAge(item('c1').cluster, NOW)).toEqual({
      days: 2,
      label: 'в базе 2 дня',
    });
  });

  it('говорит «сегодня» про запись того же дня', () => {
    const fresh = item('c2', { firstObservedAt: '2026-09-01T06:00:00.000Z' });
    expect(vacancyAge(fresh.cluster, NOW).label).toBe('в базе сегодня');
  });

  it('не выдумывает возраст без даты наблюдения', () => {
    const undated = item('c3', { firstObservedAt: '' });
    expect(vacancyAge(undated.cluster, NOW)).toEqual({
      days: null,
      label: 'дата сбора неизвестна',
    });
  });
});

/**
 * Покрытие — счёт требований, а не процент. Процент без источника, выборки и
 * даты запрещён (находка 8 аудита B178).
 */
describe('vacancyCoverage', () => {
  it('считает совпавшие требования из объяснения подбора', () => {
    expect(vacancyCoverage(item('c1').explanation)).toEqual({
      covered: 2,
      total: 3,
    });
  });

  it('верит счёту ответа, а не длине обрезанных списков', () => {
    // Списки приходят обрезанными до видимых трёх (INC-029), поэтому счёт
    // покрытия берётся из чисел — иначе карточка занизила бы и совпавшее,
    // и требуемое.
    const trimmed = item(
      'c1',
      {},
      {
        matchingPoints: ['a', 'b', 'c'],
        missingPoints: ['x', 'y', 'z'],
        matchingCount: 12,
        missingCount: 40,
      },
    );
    expect(vacancyCoverage(trimmed.explanation)).toEqual({ covered: 12, total: 52 });
  });

  it('не считает покрытие, когда сравнивать было не с чем', () => {
    const empty = item('c1', {}, { matchingPoints: [], missingPoints: [] });
    expect(vacancyCoverage(empty.explanation)).toBeUndefined();
  });
});

describe('filterVacancies', () => {
  const pool = [
    item('fresh', { firstObservedAt: '2026-08-31T12:00:00.000Z' }),
    item('old', {
      firstObservedAt: '2026-07-01T12:00:00.000Z',
      canonicalTitle: 'Аналитик данных',
    }),
    item('office', {
      isRemote: false,
      canonicalCompany: 'Банк',
      sources: [
        {
          sourceType: 'hh',
          sourceId: 'hh-9',
          sourceUrl: 'https://example.test/9',
          observedAt: '2026-08-31T12:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-08-31T12:00:00.000Z',
    }),
  ];

  it('оставляет только свежие, когда так попросили', () => {
    const ids = filterVacancies(pool, { freshness: 7 }, NOW).map(
      (found) => found.cluster.id,
    );
    expect(ids).toEqual(['fresh', 'office']);
  });

  it('ищет по названию и работодателю', () => {
    expect(
      filterVacancies(pool, { query: 'банк' }, NOW).map((f) => f.cluster.id),
    ).toEqual(['office']);
    expect(
      filterVacancies(pool, { query: 'данных' }, NOW).map((f) => f.cluster.id),
    ).toEqual(['old']);
  });

  it('фильтрует по источнику и по удалённой работе', () => {
    expect(
      filterVacancies(pool, { source: 'hh' }, NOW).map((f) => f.cluster.id),
    ).toEqual(['office']);
    expect(
      filterVacancies(pool, { remoteOnly: true }, NOW).map((f) => f.cluster.id),
    ).toEqual(['fresh', 'old']);
  });

  it('без фильтров возвращает пул как есть', () => {
    expect(filterVacancies(pool, {}, NOW)).toHaveLength(3);
  });
});

describe('vacancySourceNames', () => {
  it('считает вакансии по источникам, чтобы фильтр не врал про размер', () => {
    const counted = vacancySourceNames([
      item('a'),
      item('b'),
      item('c', {
        sources: [
          {
            sourceType: 'hh',
            sourceId: 'hh-1',
            sourceUrl: 'https://example.test/2',
            observedAt: NOW,
          },
        ],
      }),
    ]);

    expect(counted).toEqual([
      { source: 'telegram', count: 2 },
      { source: 'hh', count: 1 },
    ]);
  });
});
