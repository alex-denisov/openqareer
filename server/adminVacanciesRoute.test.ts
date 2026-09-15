import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { AuthPrincipal, SessionAuth } from './auth/authService';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { UnifiedVacancy, VacancySourceConfig } from './domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import { ADMIN_VACANCY_PAGE_BYTE_BUDGET } from './vacancies/adminVacancyPage';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/**
 * Прод отдавал `GET /api/v1/admin/vacancies` ровно на 20 220 байтах и обрывал
 * ответ на середине строки при любом `limit` (INC-032): консоль не могла
 * показать ни одной страницы пула. Ответ обязан быть валидным JSON внутри
 * доказанного бюджета, а полный текст поста — приходить отдельной карточкой.
 */
const SOURCE: VacancySourceConfig = {
  id: 'src-telegram-jobs',
  name: 'Telegram @job_react',
  type: 'telegram',
  enabled: true,
  targetUrl: 'https://t.me/job_react',
  refreshIntervalMinutes: 60,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

function vacancy(index: number): UnifiedVacancy {
  return {
    id: `vacancy-${index}`,
    fingerprint: `fingerprint-${index}`,
    title: `Ведущий инженер по данным ${index}`,
    company: `Компания ${index} с довольно длинным названием`,
    location: 'Москва',
    isRemote: index % 2 === 0,
    salary: { from: 250_000, to: 400_000, currency: 'RUR', gross: true },
    description: 'Описание вакансии. '.repeat(80),
    requiredSkills: Array.from({ length: 40 }, (_, s) => `навык-${index}-${s}`),
    responsibilities: Array.from({ length: 12 }, (_, r) => `Обязанность номер ${r}`),
    qualifications: Array.from({ length: 12 }, (_, q) => `Требование номер ${q}`),
    benefits: Array.from({ length: 8 }, (_, b) => `Бенефит ${b}`),
    aboutCompany: 'О компании. '.repeat(40),
    fullDescription: 'Полный текст поста. '.repeat(120),
    postType: 'vacancy',
    url: `https://t.me/job_react/${index}`,
    provenance: {
      sourceType: 'telegram',
      sourceId: SOURCE.id,
      sourceName: SOURCE.name,
      sourceUrl: `https://t.me/job_react/${index}`,
      externalId: `${index}`,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

const adminPrincipal: AuthPrincipal = {
  userId: 'admin-1',
  username: 'admin.test',
  email: null,
  displayName: null,
  role: 'admin',
  isTest: true,
  candidate: null,
};

const adminSessions: SessionAuth = {
  ...noSessions,
  authenticate(sessionToken: string) {
    return sessionToken === 'admin-session' ? adminPrincipal : null;
  },
};

async function createAdminApp(poolSize: number) {
  const vacancies = Array.from({ length: poolSize }, (_, index) => vacancy(index));
  const engine = new MultiSourceVacancyEngine({
    sources: [SOURCE],
    pool: {
      loadVacancies: () => vacancies,
      loadSourceStates: () => [],
      replaceSourceSlice: () => {},
      saveSourceState: () => {},
      prune: () => {},
      markExpired: () => 0,
    },
  });
  engine.restore();

  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: adminSessions,
    multiSourceVacancyEngine: engine,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return {
    app,
    vacancies,
    adminHeaders: { authorization: 'Bearer admin-session' },
    candidateHeaders: { authorization: `Bearer ${candidate.accessToken}` },
  };
}

describe('admin vacancy list', () => {
  it('отдаёт валидную страницу внутри байтового бюджета маршрута', async () => {
    const { app, adminHeaders } = await createAdminApp(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancies?limit=100',
      headers: adminHeaders,
    });

    expect(response.statusCode).toBe(200);
    // Тело целиком, а не «первые байты»: раньше JSON приходил оборванным.
    expect(() => JSON.parse(response.body)).not.toThrow();
    expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThanOrEqual(
      ADMIN_VACANCY_PAGE_BYTE_BUDGET + 4_096,
    );

    const body = response.json();
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.total).toBe(200);
    expect(body.data.offset).toBe(0);
    expect(body.data.nextOffset).toBe(body.data.items.length);
    expect(body.data.items[0]).not.toHaveProperty('fullDescription');
    expect(body.data.statsBySource[0]).toMatchObject({ sourceId: SOURCE.id });
  });

  it('вторая страница начинается там, где кончилась первая', async () => {
    const { app, adminHeaders } = await createAdminApp(200);

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancies',
      headers: adminHeaders,
    });
    const offset = first.json().data.nextOffset as number;

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/vacancies?offset=${offset}`,
      headers: adminHeaders,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.offset).toBe(offset);
    expect(second.json().data.items[0].id).not.toBe(first.json().data.items[0].id);
  });

  it('карточка отдаёт полную запись, а неизвестный id — 404', async () => {
    const { app, adminHeaders } = await createAdminApp(5);

    const found = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancies/vacancy-2',
      headers: adminHeaders,
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().data).toMatchObject({
      id: 'vacancy-2',
      fullDescription: expect.stringContaining('Полный текст поста'),
      benefits: expect.any(Array),
    });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancies/vacancy-nope',
      headers: adminHeaders,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('оба маршрута закрыты для не-администратора', async () => {
    const { app, candidateHeaders } = await createAdminApp(5);

    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/vacancies' });
    expect(list.statusCode).toBe(401);

    const card = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancies/vacancy-1',
      headers: candidateHeaders,
    });
    expect(card.statusCode).toBe(401);
  });
});
