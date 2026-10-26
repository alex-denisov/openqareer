import { describe, expect, it } from 'vitest';

import { buildSourceOptions } from './VacancySourceCatalogFilter';
import type { MatchedVacancyFacets } from '../../../shared/matchedVacancyFacets';
import type { VacancySourceRegistryEntry } from '../coach/coachApi';

const facets = (sources: MatchedVacancyFacets['sources']): MatchedVacancyFacets => ({
  total: 0,
  regions: [],
  remote: 0,
  levels: [],
  roles: [],
  sources,
});

const entry = (id: string, name: string, category?: string) =>
  ({ id, name, category }) as unknown as VacancySourceRegistryEntry;

/** B446-r (W7): у всех источников стоял 0, Indeed в списке не было. */
describe('buildSourceOptions', () => {
  it('сводит счёт выдачи с реестром по имени и ставит источники с вакансиями первыми', () => {
    const options = buildSourceOptions(
      facets([
        { sourceId: 'src-indeed', name: 'Indeed', count: 1900, groupId: 'aggregators' },
        { sourceId: 'hh-search', name: 'hh.ru (страница поиска)', count: 40, groupId: 'platforms' },
        { sourceId: 'acme', name: 'Acme Careers', count: 3, groupId: 'ats' },
      ]),
      [
        entry('remoteok', 'RemoteOK', 'Агрегаторы и API'),
        entry('hh', 'hh.ru', 'Международные площадки'),
      ],
    );
    expect(options.map(({ name, count }) => [name, count])).toEqual([
      ['Indeed', 1900],
      ['hh.ru', 40],
      ['Acme Careers', 3],
      ['RemoteOK', 0],
    ]);
    expect(options.find(({ name }) => name === 'Acme Careers')?.groupId).toBe('ats');
    expect(options.find(({ name }) => name === 'hh.ru')?.sourceId).toBe('hh-search');
  });
});

/** CPO 26.10: 35 из 322 — список дополняется всеми живыми источниками пула. */
describe('buildSourceOptions with pool sources', () => {
  it('adds every pool source once, without repeating the registry or the matches', () => {
    const options = buildSourceOptions(
      facets([{ sourceId: 'src-indeed', name: 'Indeed', count: 12, groupId: 'aggregators' }]),
      [entry('hh', 'hh.ru', 'Агрегаторы и API')],
      [
        { sourceId: 'src-hh-search', name: 'hh.ru Search', count: 756922 },
        { sourceId: 'src-indeed', name: 'Indeed', count: 175889 },
        {
          sourceId: 'ats-greenhouse-stripe',
          name: 'Stripe · Greenhouse',
          category: 'ATS компаний',
          count: 202,
        },
      ],
    );
    expect(options.map(({ name }) => name)).toEqual(['Indeed', 'hh.ru', 'Stripe · Greenhouse']);
    expect(options.find(({ name }) => name === 'Stripe · Greenhouse')).toMatchObject({
      sourceId: 'ats-greenhouse-stripe',
      groupId: 'ats',
      count: 0,
    });
  });
});
