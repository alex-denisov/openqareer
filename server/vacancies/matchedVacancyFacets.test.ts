import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { filterMatchedVacancies, matchedVacanciesQuerySchema } from './matchedVacancyFilters';
import { buildMatchedVacancyFacets } from './matchedVacancyFacets';

function item(title: string, location: string, remote = false): MatchedVacancyItem {
  return {
    cluster: { id: title, canonicalTitle: title, canonicalCompany: 'Компания',
      canonicalLocation: location, isRemote: remote, skills: [], descriptionSummary: '',
      primaryUrl: 'https://example.test', sources: [
        { sourceId: 'jobs', sourceName: 'Работа', sourceType: 'direct', sourceUrl: '', observedAt: '' },
        { sourceId: 'jobs', sourceName: 'Работа', sourceType: 'direct', sourceUrl: '', observedAt: '' },
      ], firstObservedAt: '', lastSeenAt: '', status: 'active', vacanciesCount: 1 },
    explanation: { clusterId: title, roleMatch: 'target', levelMatch: 'unknown',
      matchingPoints: [], missingPoints: [], summary: '', calculatedAt: '' },
  };
}

describe('сводка всей подборки', () => {
  it('использует сохранённый уровень одинаково в сводке и фильтрах, null остаётся неизвестным', () => {
    const items = [item('Head of Engineering', 'Berlin'), item('VP of Engineering', 'Dubai')];
    const readLevel = (vacancy: MatchedVacancyItem) => vacancy.cluster.canonicalLocation === 'Berlin' ? 0 : null;
    expect(buildMatchedVacancyFacets(items, [], readLevel).levels).toEqual([
      { level: 'ic', count: 1 }, { level: 'unknown', count: 1 },
    ]);
    const filters = matchedVacanciesQuerySchema.parse({ level: 'ic' });
    expect(filterMatchedVacancies(items, filters, [], readLevel)).toEqual([items[0]]);
  });

  it('считает регионы, удалёнку, уровни, роли и уникальные источники без нулей', () => {
    const items = [item('Head of Engineering', 'Berlin'), item('Engineering', 'Berlin', true),
      item('VP of Engineering', 'Dubai')];
    expect(buildMatchedVacancyFacets(items, ['Engineering', 'Marketing'])).toEqual({
      total: 3, regions: [{ id: 'eu', count: 2 }, { id: 'mena', count: 1 }], remote: 1,
      levels: [{ level: 'head', count: 1 }, { level: 'unknown', count: 1 }, { level: 'vp', count: 1 }],
      roles: [{ role: 'Engineering', count: 3 }], sources: [{ sourceId: 'jobs', name: 'Работа', count: 3 }],
    });
    expect(items[0].cluster.sources).toHaveLength(2);
  });
});
