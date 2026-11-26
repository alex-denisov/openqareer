import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { filterMatchedVacancies, matchedVacanciesQuerySchema } from './matchedVacancyFilters';
import { sourceFilterMatches } from './matchedVacancySourceFilter';

function item(id: string, sourceId: string): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: 'Head of Engineering',
      canonicalCompany: 'Компания',
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: [],
      descriptionSummary: '',
      primaryUrl: 'https://example.test',
      sources: [{ sourceId, sourceName: sourceId, sourceType: 'direct', sourceUrl: '', observedAt: '' }],
      firstObservedAt: '',
      lastSeenAt: '',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target',
      levelMatch: 'unknown',
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '',
    },
  };
}

describe('B706: фильтр источника сопоставляет значение с sourceId', () => {
  it('«hh» берёт вакансии src-hh-search и src-hh-rss', () => {
    expect(sourceFilterMatches(['hh'], 'src-hh-search')).toBe(true);
    expect(sourceFilterMatches(['hh'], 'src-hh-rss')).toBe(true);
    expect(sourceFilterMatches(['hh'], 'hh')).toBe(true);
    expect(sourceFilterMatches(['hh'], 'src-hhunter')).toBe(false);
    expect(sourceFilterMatches(['hh'], 'remotive')).toBe(false);
  });

  it('точный sourceId фильтрует как прежде', () => {
    expect(sourceFilterMatches(['src-hh-search'], 'src-hh-search')).toBe(true);
    expect(sourceFilterMatches(['src-hh-search'], 'src-hh-rss')).toBe(false);
    expect(sourceFilterMatches(['remotive'], 'remotive')).toBe(true);
  });

  it('source=hh в запросе возвращает вакансии hh.ru, остальные отсеивает', () => {
    const items = [item('a', 'src-hh-search'), item('b', 'remotive'), item('c', 'src-hh-rss')];
    const filters = matchedVacanciesQuerySchema.parse({ source: 'hh' });
    expect(filterMatchedVacancies(items, filters, [], undefined, ['hh']).map((row) => row.cluster.id)).toEqual([
      'a',
      'c',
    ]);
    const remotive = matchedVacanciesQuerySchema.parse({ source: 'remotive' });
    expect(filterMatchedVacancies(items, remotive, []).map((row) => row.cluster.id)).toEqual(['b']);
  });

  it('«hh» принимается, даже если реестр источников не передан', () => {
    const items = [item('a', 'src-hh-search')];
    const filters = matchedVacanciesQuerySchema.parse({ source: 'hh' });
    expect(filterMatchedVacancies(items, filters, []).map((row) => row.cluster.id)).toEqual(['a']);
  });
});
