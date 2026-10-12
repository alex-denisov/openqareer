import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import type { VacancySourceConfig, UnifiedVacancy } from '../domain/unifiedVacancy';
import { filterMatchedVacancies, matchedVacanciesQuerySchema } from './matchedVacancyFilters';
import { buildMatchedVacancyFacets, matchedVacancySourceRegistry, type MatchedVacancySourceDefinition } from './matchedVacancyFacets';

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


function sqliteVacancy(
  source: VacancySourceConfig,
  id: string,
  title: string,
): UnifiedVacancy {
  const now = new Date().toISOString();
  return {
    id,
    fingerprint: `fingerprint-${id}`,
    title,
    company: id,
    description: 'Описание',
    requiredSkills: [],
    url: `${source.targetUrl}/${id}`,
    provenance: {
      sourceType: source.type,
      sourceId: source.id,
      sourceUrl: source.targetUrl,
      observedAt: now,
    },
    publishedAt: now,
    status: 'active',
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
      roles: [{ role: 'Engineering', count: 3 }],
      sources: [{ sourceId: 'jobs', name: 'Работа', count: 3 }],
      sourceGroups: [
        { id: 'platforms', name: 'Площадки', count: 0 },
        { id: 'ats', name: 'ATS компаний', count: 0 },
        { id: 'aggregators', name: 'Агрегаторы', count: 0 },
        { id: 'channels', name: 'Каналы', count: 0 },
      ],
    });
    expect(items[0].cluster.sources).toHaveLength(2);
  });


  it('возвращает только ненулевые источники и считает группы по уникальным вакансиям', () => {
    const source = (sourceId: string, sourceName: string) => ({
      sourceId, sourceName, sourceType: 'direct' as const, sourceUrl: '', observedAt: '',
    });
    const vacancy = (id: string, sources: ReturnType<typeof source>[]) => ({
      ...item(id, 'Berlin'),
      cluster: { ...item(id, 'Berlin').cluster, sources },
    });
    const items = [
      vacancy('one', [source('hh', 'hh.ru'), source('ats-acme', 'Acme')]),
      vacancy('two', [source('tg-jobs', 'Telegram')]),
      vacancy('three', [source('hh', 'hh.ru')]),
    ];
    const registry: readonly MatchedVacancySourceDefinition[] = [
      { id: 'remotive', name: 'Remotive', type: 'remotive', targetUrl: 'https://www.remotive.com/jobs', market: 'Global', category: 'Международные площадки' },
      { id: 'ats-acme', name: 'Acme', type: 'career_site', targetUrl: 'https://careers.acme.com/jobs', market: 'США' },
      { id: 'hh', name: 'hh.ru', type: 'hh', targetUrl: 'https://hh.ru/vacancies', market: 'Россия и СНГ', category: 'Агрегаторы и API' },
      { id: 'zero', name: 'Zero', type: 'rss', targetUrl: 'https://zero.example/jobs', market: 'Великобритания' },
      { id: 'tg-jobs', name: 'Telegram', type: 'telegram', targetUrl: 'https://t.me/jobs', market: 'Россия' },
    ];
    const facets = buildMatchedVacancyFacets(items, [], undefined, registry);

    expect(facets.sourceGroups).toEqual([
      { id: 'platforms', name: 'Площадки', count: 0 },
      { id: 'ats', name: 'ATS компаний', count: 1 },
      { id: 'aggregators', name: 'Агрегаторы', count: 2 },
      { id: 'channels', name: 'Каналы', count: 1 },
    ]);
    expect(facets.sources).toEqual([
      { sourceId: 'hh', name: 'hh.ru', count: 2 },
      { sourceId: 'ats-acme', name: 'Acme', count: 1 },
      { sourceId: 'tg-jobs', name: 'Telegram', count: 1 },
    ]);
    expect(facets).not.toHaveProperty('sourceCatalog');
  });
});


describe('каталог источников на выборке SQLite', () => {
  it('считает только совпадения кандидата, не записи всего пула', async () => {
    const sources: VacancySourceConfig[] = [
      {
        id: 'remotive', name: 'Remotive', type: 'remotive', enabled: true,
        targetUrl: 'https://remotive.com/api', refreshIntervalMinutes: 60,
        itemsFoundTotal: 1, itemsActiveTotal: 1,
      },
      {
        id: 'acme-careers', name: 'Acme Careers', type: 'career_site', enabled: true,
        targetUrl: 'https://careers.acme.test/jobs', refreshIntervalMinutes: 60,
        itemsFoundTotal: 1, itemsActiveTotal: 1,
      },
      {
        id: 'other-rss', name: 'Other RSS', type: 'rss', enabled: true,
        targetUrl: 'https://other.test/feed', refreshIntervalMinutes: 60,
        itemsFoundTotal: 1, itemsActiveTotal: 1,
      },
    ];
    const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    try {
      pool.replaceSourceSlice('remotive', [
        sqliteVacancy(sources[0], 'platform-match', 'Remote Engineer'),
      ]);
      pool.replaceSourceSlice('acme-careers', [
        sqliteVacancy(sources[1], 'ats-match', 'Product Engineer'),
      ]);
      pool.replaceSourceSlice('other-rss', [
        sqliteVacancy(sources[2], 'outside-match', 'Support Specialist'),
      ]);
      const engine = new MultiSourceVacancyEngine({ sources, pool });
      const matched = await engine.getMatchedVacanciesAsync({
        candidateId: 'candidate',
        targetRoles: ['Engineer'],
        confirmedSkills: [],
        confirmedFacts: [],
      });
      const registry = matchedVacancySourceRegistry(engine.getSources());
      const selected = filterMatchedVacancies(
        matched,
        matchedVacanciesQuerySchema.parse({ role: 'Engineer' }),
        ['Engineer'],
        undefined,
        registry.map(({ id }) => id),
      );
      const facets = buildMatchedVacancyFacets(selected, ['Engineer'], undefined, registry);

      expect(matched).toHaveLength(3);
      expect(selected).toHaveLength(2);
      expect(facets.total).toBe(2);
      expect(facets.sourceGroups).toEqual([
        { id: 'platforms', name: 'Площадки', count: 1 },
        { id: 'ats', name: 'ATS компаний', count: 1 },
        { id: 'aggregators', name: 'Агрегаторы', count: 0 },
        { id: 'channels', name: 'Каналы', count: 0 },
      ]);
      expect(facets.sources).toEqual([
        { sourceId: 'acme-careers', name: 'Acme Careers', count: 1 },
        { sourceId: 'remotive', name: 'Remotive', count: 1 },
      ]);
      expect(facets).not.toHaveProperty('sourceCatalog');
    } finally {
      pool.close();
    }
  });
});
