import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { CandidateMatchProfile } from './vacancyMatcher';

describe('MultiSourceVacancyEngine', () => {
  it('aggregates vacancies from multiple simulated sources, deduplicates them and matches candidate profile', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'test-hh',
          name: 'hh.ru IT',
          type: 'hh',
          enabled: true,
          targetUrl: 'https://hh.ru',
          refreshIntervalMinutes: 60,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
        {
          id: 'test-tg',
          name: 'Telegram Dev Jobs',
          type: 'telegram',
          enabled: true,
          targetUrl: 'https://t.me/s/dev_jobs',
          refreshIntervalMinutes: 30,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
      ],
      fetcher: async (source) => {
        if (source.id === 'test-hh') {
          return [
            {
              id: 'hh-1',
              fingerprint: 'fp-1',
              title: 'Senior TypeScript / React Developer',
              company: 'TechCorp Global',
              isRemote: true,
              description: 'Looking for a Senior TypeScript pro with React & Node.js experience.',
              requiredSkills: ['TypeScript', 'React', 'Node.js'],
              url: 'https://hh.ru/1',
              provenance: {
                sourceType: 'hh',
                sourceId: 'test-hh',
                sourceUrl: 'https://hh.ru/1',
                observedAt: new Date().toISOString(),
              },
              publishedAt: new Date().toISOString(),
              status: 'active',
            },
          ];
        }
        if (source.id === 'test-tg') {
          return [
            {
              id: 'tg-1',
              fingerprint: 'fp-tg-1',
              title: 'Senior TypeScript Developer',
              company: 'TechCorp Global LLC',
              isRemote: true,
              description: 'TechCorp Global ищет Senior TypeScript разработчика в React команду.',
              requiredSkills: ['TypeScript', 'React', 'PostgreSQL'],
              url: 'https://t.me/dev_jobs/1',
              provenance: {
                sourceType: 'telegram',
                sourceId: 'test-tg',
                sourceUrl: 'https://t.me/dev_jobs/1',
                observedAt: new Date().toISOString(),
              },
              publishedAt: new Date().toISOString(),
              status: 'active',
            },
          ];
        }
        return [];
      },
    });

    // 1. Sync both sources
    await engine.syncAll();

    const sources = engine.getSources();
    expect(sources).toHaveLength(2);
    expect(sources[0].lastStatus).toBe('healthy');

    // Название площадки едет вместе с записью, иначе кандидат читает под
    // вакансией тип адаптера — «json_api», «rss, rss» (PRB-017).
    expect(engine.getActiveClusters()[0].sources.map((s) => s.sourceName)).not.toContain(undefined);

    const clusters = engine.getActiveClusters();
    // 2 items merged into 1 cluster due to deduplication
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sources).toHaveLength(2);
    expect(clusters[0].skills).toContain('PostgreSQL');
    expect(clusters[0].skills).toContain('Node.js');

    // 2. Match candidate
    const candidate: CandidateMatchProfile = {
      candidateId: 'cand-1',
      targetRoles: ['Senior TypeScript Developer'],
      confirmedSkills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
      confirmedFacts: ['5+ лет разработки на React/TypeScript'],
      preferredRemote: true,
    };

    const matched = engine.getMatchedVacancies(candidate);
    expect(matched).toHaveLength(1);
    // Каноническое название кластера — «Senior TypeScript / React Developer»,
    // целевая роль совпадает с ним частично, и продукт называет это честно.
    expect(matched[0].explanation.roleMatch).toBe('partial');
    expect(matched[0].explanation.requirements?.matched).toBeGreaterThanOrEqual(3);
    expect(matched[0].cluster.primaryUrl).toBe('https://hh.ru/1');
  });

  it('filters out vacancies older than 30 days', async () => {
    const now = Date.now();
    const freshDate = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const staleDate = new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString();

    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'test-src',
          name: 'Test Source',
          type: 'telegram',
          enabled: true,
          targetUrl: 'https://t.me/s/test',
          refreshIntervalMinutes: 60,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
      ],
      fetcher: async () => [
        {
          id: 'fresh-1',
          fingerprint: 'fp-fresh',
          title: 'Fresh React Developer',
          company: 'Active Studio',
          isRemote: true,
          description: 'Active vacancy from 5 days ago.',
          requiredSkills: ['React'],
          url: 'https://t.me/test/1',
          provenance: {
            sourceType: 'telegram',
            sourceId: 'test-src',
            sourceUrl: 'https://t.me/test/1',
            observedAt: new Date().toISOString(),
          },
          publishedAt: freshDate,
          status: 'active',
        },
        {
          id: 'stale-1',
          fingerprint: 'fp-stale',
          title: 'Stale React Developer',
          company: 'Old Corp',
          isRemote: true,
          description: 'Old vacancy from 35 days ago.',
          requiredSkills: ['React'],
          url: 'https://t.me/test/2',
          provenance: {
            sourceType: 'telegram',
            sourceId: 'test-src',
            sourceUrl: 'https://t.me/test/2',
            observedAt: new Date().toISOString(),
          },
          publishedAt: staleDate,
          status: 'active',
        },
      ],
    });

    await engine.syncAll();

    const vacancies = engine.getVacancies();
    expect(vacancies.items.some((v) => v.id === 'fresh-1')).toBe(true);
    expect(vacancies.items.some((v) => v.id === 'stale-1')).toBe(false);

    // Название площадки едет вместе с записью, иначе кандидат читает под
    // вакансией тип адаптера — «json_api», «rss, rss» (PRB-017).
    expect(engine.getActiveClusters()[0].sources.map((s) => s.sourceName)).not.toContain(undefined);

    const clusters = engine.getActiveClusters();
    expect(clusters.some((c) => c.canonicalTitle === 'Fresh React Developer')).toBe(true);
    expect(clusters.some((c) => c.canonicalTitle === 'Stale React Developer')).toBe(false);
  });

  it('uses store.queryMatchCandidates in getMatchedVacancies when available', async () => {
    let queryMatchCalled = false;
    const mockPool = {
      loadVacancies: () => [],
      iterateClusterInput: function* () {},
      getVacancy: () => undefined,
      hasVacancy: () => false,
      countVacancies: () => 1,
      countBySource: () => new Map(),
      countSourceSlice: () => ({ total: 1, active: 1 }),
      queryVacancies: () => ({ total: 0, items: [] }),
      loadSourceLinks: () => [],
      mergeSourceSlice: () => {},
      loadSourceStates: () => [],
      replaceSourceSlice: () => {},
      saveSourceState: () => {},
      markExpired: () => 0,
      prune: () => {},
      queryMatchCandidates: (cand: CandidateMatchProfile) => {
        queryMatchCalled = true;
        return [
          {
            id: 'mock-1',
            fingerprint: 'fp-mock-1',
            title: cand.targetRoles[0] ?? 'Mock Role',
            company: 'Mock Corp',
            isRemote: true,
            description: 'Mock description with TypeScript',
            requiredSkills: ['TypeScript'],
            url: 'https://example.test/mock-1',
            provenance: {
              sourceType: 'json_api' as const,
              sourceId: 'mock-src',
              sourceUrl: 'https://example.test/mock-1',
              observedAt: new Date().toISOString(),
            },
            publishedAt: new Date().toISOString(),
            status: 'active' as const,
          },
        ];
      },
    };

    const engine = new MultiSourceVacancyEngine({
      sources: [],
      pool: mockPool,
    });

    const candidate: CandidateMatchProfile = {
      candidateId: 'cand-mock',
      targetRoles: ['Lead Engineer'],
      confirmedSkills: ['TypeScript'],
      confirmedFacts: [],
      preferredRemote: true,
    };

    const matched = engine.getMatchedVacancies(candidate);
    expect(queryMatchCalled).toBe(true);
    expect(matched).toHaveLength(1);
    expect(matched[0].cluster.canonicalTitle).toBe('Lead Engineer');
  });

  it('falls back to getActiveClusters when store does not implement queryMatchCandidates', async () => {
    const fallbackPool = {
      loadVacancies: () => [],
      iterateClusterInput: function* () {},
      getVacancy: () => undefined,
      hasVacancy: () => false,
      countVacancies: () => 0,
      countBySource: () => new Map(),
      countSourceSlice: () => ({ total: 0, active: 0 }),
      queryVacancies: () => ({ total: 0, items: [] }),
      loadSourceLinks: () => [],
      mergeSourceSlice: () => {},
      loadSourceStates: () => [],
      replaceSourceSlice: () => {},
      saveSourceState: () => {},
      markExpired: () => 0,
      prune: () => {},
      // Notice: queryMatchCandidates is explicitly undefined
    };

    const engine = new MultiSourceVacancyEngine({
      sources: [],
      pool: fallbackPool,
    });

    const candidate: CandidateMatchProfile = {
      candidateId: 'cand-fallback',
      targetRoles: ['QA Engineer'],
      confirmedSkills: [],
      confirmedFacts: [],
    };

    const matched = engine.getMatchedVacancies(candidate);
    expect(matched).toEqual([]);
  });
});
