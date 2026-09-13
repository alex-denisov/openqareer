import { describe, expect, it, beforeEach } from 'vitest';
import { buildApp } from '../app';
import { apps, config, noSessions, stores, successProvider } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { createHhCrawlSettings } from '../vacancies/hhCrawlSettings';
import type { AuthPrincipal, SessionAuth } from '../auth/authService';

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
  authenticate: (token: string) => (token === 'admin-session' ? adminPrincipal : null),
};

const headers = { authorization: 'Bearer admin-session' };

async function createApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: adminSessions,
    hhCrawlSettings: createHhCrawlSettings({ databasePath: ':memory:' }),
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return app;
}

describe('фильтр веера обхода hh.ru', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    app = await createApp();
  });

  it('справочник ролей закрыт от неадминистратора', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/hh-crawl-filter' });

    expect(response.statusCode).toBe(401);
  });

  it('администратор читает все категории и текущий выбор', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/hh-crawl-filter',
      headers,
    });

    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.categories).toHaveLength(27);
    expect(data.selectedRoleIds).toHaveLength(25);
    expect(data.searchPeriodDays).toBe(30);
    const it11 = data.categories.find((c: { id: string }) => c.id === '11');
    expect(it11.name).toBe('Информационные технологии');
    expect(it11.roles).toHaveLength(25);
  });

  it('владелец меняет набор ролей множественным выбором', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/hh-crawl-filter',
      headers,
      payload: { roleIds: ['96', '124', '160'], searchPeriodDays: 14 },
    });

    expect(saved.statusCode).toBe(200);
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/hh-crawl-filter',
      headers,
    });
    expect(read.json().data.selectedRoleIds).toEqual(['96', '124', '160']);
    expect(read.json().data.searchPeriodDays).toBe(14);
  });

  it('пустой набор отклоняется, а не выключает обход молча', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/hh-crawl-filter',
      headers,
      payload: { roleIds: [], searchPeriodDays: 30 },
    });

    expect(response.statusCode).toBe(422);
  });

  it('срок сверх того, что отдаёт площадка, отклоняется', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/hh-crawl-filter',
      headers,
      payload: { roleIds: ['96'], searchPeriodDays: 365 },
    });

    expect(response.statusCode).toBe(422);
  });

  it('несуществующая роль не сохраняется молча — она названа отдельно', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/hh-crawl-filter',
      headers,
      payload: { roleIds: ['96', 'выдуманная'], searchPeriodDays: 30 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.selectedRoleIds).toEqual(['96']);
    expect(response.json().data.ignoredRoleIds).toEqual(['выдуманная']);
  });
});
