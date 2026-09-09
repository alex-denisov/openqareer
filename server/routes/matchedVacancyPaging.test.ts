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

async function createPagingApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  // Без подтверждённого профиля подбора нет вовсе (B161): целевую роль даёт
  // черновик резюме — самый короткий честный путь к непустому подбору.
  candidateStore.saveResumeDraft(
    candidate.id,
    { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' },
    [],
  );

  let call = 0;
  const engine = {
    getMatchedVacancies: () => {
      call += 1;
      // Каждый пересчёт возвращает другой пул: так видно, из скольких списков
      // собралось одно чтение.
      return pool(`пул-${call}`, 40);
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
