import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { config, noSessions, successProvider } from './appTestHarness';
import { CLUSTER_SPLIT_TABLES } from './data/clusterSplitSchema';
import { VACANCY_CATALOG_ENTRIES_TABLE } from './data/sqliteSchema';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { createClusterFromVacancy } from './vacancies/vacancyDeduplicator';
import { MemoryVacancyPoolStore } from './vacancies/memoryVacancyPoolStore';
import { catalogEntryRowOfCluster } from './vacancies/vacancyCatalogProjection';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function databaseWithRedirect(): string {
  const directory = mkdtempSync(join(tmpdir(), 'oq-redirect-'));
  directories.push(directory);
  const path = join(directory, 'catalog.db');
  const db = new DatabaseSync(path);
  db.exec(VACANCY_CATALOG_ENTRIES_TABLE + CLUSTER_SPLIT_TABLES);
  db.prepare(
    `INSERT INTO catalog_entries (cluster_id, entry_key, path, title, company, is_remote, summary,
       skills_json, source_url, published_at, last_seen_at, source_count, status, published_ms, last_seen_ms)
     VALUES ('cluster-src-b:1', 'newkey', '/vacancies/job/teller-newkey', 't', 'c', 0, 's', '[]',
       'https://b.example/1', '', '', 1, 'active', 0, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO vacancy_catalog_redirects VALUES
       ('oldkey', '/vacancies/job/teller-oldkey', 'cluster-src-b:1', 'newkey', 's1', 0),
       ('gonekey', '/vacancies/job/teller-gonekey', '', '', 's1', 0)`,
  ).run();
  db.close();
  return path;
}

async function appOn(databasePath: string, catalog: Partial<MultiSourceVacancyEngine> = {}) {
  const engine = new MultiSourceVacancyEngine({ pool: new MemoryVacancyPoolStore() });
  engine.restore();
  Object.assign(engine, catalog);
  return buildApp({
    config: { ...config, databasePath },
    coachProvider: successProvider,
    candidateStore: new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    }),
    authService: noSessions,
    serveStatic: false,
    multiSourceVacancyEngine: engine,
  });
}

describe('B752: старый адрес карточки разбитого кластера', () => {
  it('ведёт 301 на новый адрес куска', async () => {
    const app = await appOn(databaseWithRedirect());
    const response = await app.inject({ method: 'GET', url: '/vacancies/job/teller-oldkey' });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe('/vacancies/job/teller-newkey');
    await app.close();
  });

  it('вакансии нет ни у одной части — 410, не другая вакансия', async () => {
    const app = await appOn(databaseWithRedirect());
    const response = await app.inject({ method: 'GET', url: '/vacancies/job/teller-gonekey' });
    expect(response.statusCode).toBe(410);
    await app.close();
  });

  it('ключ остался у основателя: прежний адрес ведёт к своей вакансии, новый — к основателю', async () => {
    const path = databaseWithRedirect();
    const db = new DatabaseSync(path);
    const founder = createClusterFromVacancy({
      id: 'src-a:1',
      fingerprint: 'f',
      title: 'Go Developer',
      company: 'VK',
      description: 'd',
      requiredSkills: [],
      url: 'https://a.example/1',
      provenance: {
        sourceType: 'json_api',
        sourceId: 'src-a',
        sourceUrl: 'https://a.example/1',
        externalId: '1',
        observedAt: '2026-11-01T00:00:00.000Z',
      },
      publishedAt: '2026-11-01T00:00:00.000Z',
      status: 'active',
    });
    const entry = catalogEntryRowOfCluster(founder)!;
    const insert = db.prepare('INSERT INTO vacancy_catalog_redirects VALUES (?, ?, ?, ?, ?, 0)');
    const old = `/vacancies/job/teller-${entry.key}`;
    insert.run(entry.key, old, 'cluster-src-b:1', 'newkey', 's1');
    db.close();
    const app = await appOn(path, {
      getPublicCatalogEntry: () => entry,
      getPublicCatalogCluster: () => founder,
    });
    const moved = await app.inject({ method: 'GET', url: `${old}?utm=1` });
    expect([moved.statusCode, moved.headers.location]).toEqual([
      301,
      '/vacancies/job/teller-newkey',
    ]);
    const own = await app.inject({ method: 'GET', url: entry.path });
    expect(own.statusCode).toBe(200);
    expect(own.body).toContain('Go Developer');
    await app.close();
  });

  it('без переадресации отвечает как раньше', async () => {
    const app = await appOn(databaseWithRedirect());
    const response = await app.inject({ method: 'GET', url: '/vacancies/job/teller-zzzzzz' });
    expect(response.statusCode).toBe(410);
    await app.close();
  });
});
