import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from '../appTestHarness';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

/**
 * Страницы одного чтения приходят из одного снимка (B211, PRB-023).
 *
 * Кабинет читает пул шестьюдесятью запросами. Пересчитывать подбор на каждый
 * из них — это, во-первых, шестьдесят проходов по всем активным кластерам
 * (замер на проде `1e2436e`: круг вырос с 1.2 с до 3.4 с), а во-вторых —
 * сдвиг смещений, если между страницами прошёл опрос площадок: то же смещение
 * укажет уже на другую запись, и чтение получит дыру или повтор.
 */
function pool(prefix: string, size: number): MatchedVacancyItem[] {
  return Array.from({ length: size }, (_, index) => ({
    cluster: {
      id: `${prefix}-${index}`,
      canonicalTitle: `Инженер данных ${index}`,
      canonicalCompany: `Компания ${index}`,
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: [],
      descriptionSummary: 'Описание вакансии. '.repeat(40),
      primaryUrl: `https://example.test/${prefix}/${index}`,
      sources: [],
      firstObservedAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-09-02T00:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: `${prefix}-${index}`,
      roleMatch: 'target',
      requirements: { matched: 1, total: 2 },
      matchingPoints: ['Подтверждённый навык: SQL'],
      missingPoints: ['Airflow'],
      summary: 'Совпало 1 из 2 требований вакансии.',
      calculatedAt: '2026-09-02T00:00:00.000Z',
    },
  })) as unknown as MatchedVacancyItem[];
}

async function createPagingApp(waitForMatching?: Promise<void>, items?: MatchedVacancyItem[], unconfirmed = false) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  // Без подтверждённого профиля подбора нет вовсе (B161): целевую роль даёт
  // черновик резюме — самый короткий честный путь к непустому подбору.
  if (!unconfirmed) candidateStore.saveResumeDraft(
    candidate.id,
    { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' },
    [],
  );

  let call = 0;
  const engine = {
    getMatchedVacanciesAsync: async () => {
      call += 1;
      await waitForMatching;
      // Каждый пересчёт возвращает другой пул: так видно, из скольких списков
      // собралось одно чтение.
      return items ?? pool(`пул-${call}`, 40);
    },
    restore: () => ({ clusters: 0, sources: 0 }),
  };

  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    multiSourceVacancyEngine: engine as never,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}`, calls: () => call };
}

describe('чтение подбора страницами', () => {
  it('serves session and connections while a matching read is still running', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    const { app, authorization, calls } = await createPagingApp(waiting);
    const matched = app.inject({ url: '/api/v1/candidate/matched-vacancies', headers: { authorization } }).then((response) => response);
    // Give Fastify the request; matching must remain pending during both reads.
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      expect(calls()).toBe(1);
      const session = await app.inject({ url: '/api/v1/auth/me' });
      const connections = await app.inject({ url: '/api/v1/candidate/connections', headers: { authorization } });
      expect(session.statusCode).toBe(200);
      expect(connections.statusCode).toBe(200);
      expect(Array.isArray(connections.json().data)).toBe(true);
    } finally { finish(); }
    expect((await matched).statusCode).toBe(200);
  });

  it('проверяет неизвестные источники и роли даже без подтверждённого профиля', async () => {
    const { app, authorization } = await createPagingApp(undefined, undefined, true);
    for (const query of ['source=unknown', 'role=unknown']) {
      const response = await app.inject({ url: `/api/v1/candidate/matched-vacancies?${query}`,
        headers: { authorization } });
      expect(response.statusCode).toBe(400);
    }
    const empty = await app.inject({ url: '/api/v1/candidate/matched-vacancies', headers: { authorization } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().meta.facets.total).toBe(0);
  });

  it('сужает смешанную подборку до пагинации по регионам, источникам и удалёнке', async () => {
    const items = pool('mixed', 40).map((item, index) => ({ ...item, cluster: {
      ...item.cluster, canonicalLocation: index < 30 ? 'Berlin' : 'Dubai',
      isRemote: index >= 30, sources: [{ sourceId: index < 30 ? 'eu-jobs' : 'mena-jobs',
        sourceName: 'Работа', sourceType: 'direct' as const, sourceUrl: '', observedAt: '' }],
    } }));
    const { app, authorization } = await createPagingApp(undefined, items);
    const get = (query: string) => app.inject({ url: `/api/v1/candidate/matched-vacancies?${query}`,
      headers: { authorization } });
    const first = (await get('region=eu&source=eu-jobs')).json();
    expect(first.meta.total).toBe(30);
    expect(first.meta.facets.total).toBe(40);
    expect(first.meta.facets.regions).toEqual([{ id: 'eu', count: 30 }, { id: 'mena', count: 10 }]);
    const page = (await get('region=eu&source=eu-jobs&offset=20')).json();
    expect(page.meta.total).toBe(30);
    expect(page.data).toHaveLength(10);
    expect(page.data.every((item: MatchedVacancyItem) => item.cluster.canonicalLocation === 'Berlin')).toBe(true);
    const remote = (await get('remote=1&source=mena-jobs')).json();
    expect(remote.meta.total).toBe(10);
    expect(remote.meta.facets.total).toBe(40);
  });

  it('сводка охватывает снимок, фильтры применяются до страницы и значения проверяются', async () => {
    const { app, authorization } = await createPagingApp();
    const get = (query: string) => app.inject({ url: `/api/v1/candidate/matched-vacancies?${query}`,
      headers: { authorization } });
    const first = await get('offset=0');
    expect(first.json().meta.facets.total).toBe(40);
    expect(first.json().meta.facets.regions).toEqual([{ id: 'ru', count: 40 }]);
    const excluded = await get('region=eu');
    expect(excluded.json().meta.total).toBe(0);
    expect(excluded.json().meta.facets.total).toBe(40);
    const repeated = await get('region=eu&region=ru&level=unknown');
    expect(repeated.json().meta.total).toBe(40);
    expect((await get('offset=20')).json().meta.facets).toBeUndefined();
    for (const query of ['level=invalid', 'region=invalid', 'remote=yes', 'source=invalid', 'role=invalid']) {
      expect((await get(query)).statusCode).toBe(400);
    }
  });

  it('все страницы одного чтения приходят из одного снимка', async () => {
    const { app, authorization, calls } = await createPagingApp();

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies?offset=0',
      headers: { authorization },
    });
    expect(first.statusCode).toBe(200);
    const plan: number[] = first.json().meta.pageOffsets;
    expect(plan.length).toBeGreaterThan(1);

    const ids: string[] = first.json().data.map((item: { cluster: { id: string } }) => item.cluster.id);
    for (const offset of plan.slice(1)) {
      const page = await app.inject({
        method: 'GET',
        url: `/api/v1/candidate/matched-vacancies?offset=${offset}`,
        headers: { authorization },
      });
      expect(page.statusCode).toBe(200);
      ids.push(...page.json().data.map((item: { cluster: { id: string } }) => item.cluster.id));
    }

    // Один снимок — один пул: записи из двух разных пересчётов в одном чтении
    // означали бы дыру или повтор на границе страниц.
    expect(new Set(ids.map((id) => id.split('-').slice(0, 2).join('-'))).size).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(40);
    expect(calls()).toBe(1);
  });
});
