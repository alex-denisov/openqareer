import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { config, noSessions, successProvider } from './appTestHarness';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { CATALOG_ARCHIVE_TABLE_SQL, closeCatalogArchiveReaders } from './seo/catalogArchive';
import type { UnifiedVacancy } from './domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './vacancies/memoryVacancyPoolStore';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';

const dirs: string[] = [];
afterEach(() => {
  closeCatalogArchiveReaders();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DAY = 86_400_000;
const ARCHIVED_PATH = '/vacancies/job/frontend-developer-at-acme-arch1';

function archiveDatabase(rows: ReadonlyArray<Record<string, string | number | null>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'archive-route-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const db = new DatabaseSync(path);
  db.exec(CATALOG_ARCHIVE_TABLE_SQL);
  for (const row of rows) {
    const names = Object.keys(row);
    db.prepare(
      `INSERT INTO catalog_archive_cards (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
    ).run(...Object.values(row));
  }
  db.close();
  return path;
}

function archived(key: string, overrides: Record<string, string | number | null> = {}) {
  return {
    entry_key: key,
    path: `/vacancies/job/frontend-developer-at-acme-${key}`,
    title: 'Frontend Developer',
    company: 'Acme',
    location: 'Berlin',
    is_remote: 0,
    salary_label: '5 000 €',
    summary: 'Делаем интерфейсы на React для банков. <script>alert(1)</script>',
    source_name: 'src-remoteok',
    published_at: '2026-10-01T00:00:00.000Z',
    last_seen_at: new Date(Date.now() - 5 * DAY).toISOString(),
    place_slug: 'berlin',
    place_label: 'Берлин',
    role_slug: 'frontend-developer',
    role_label: 'Frontend-разработчик',
    last_listed_at: new Date(Date.now() - 6 * DAY).toISOString(),
    last_impression_at: null,
    ...overrides,
  };
}

function openVacancy(index: number): UnifiedVacancy {
  return {
    id: `open${index}`,
    fingerprint: `open${index}`,
    title: 'Frontend Developer',
    company: ['Globex', 'Initech', 'Umbrella'][index] ?? `Company ${index}`,
    location: 'Berlin',
    isRemote: false,
    description: `Открытая вакансия номер ${index}. `.repeat(20),
    requiredSkills: ['React'],
    url: `https://boards.example.com/open/${index}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'src-remoteok',
      sourceUrl: `https://boards.example.com/open/${index}`,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

async function app(databasePath: string, open: readonly UnifiedVacancy[] = []) {
  const pool = new MemoryVacancyPoolStore();
  if (open.length > 0) pool.replaceSourceSlice('src-remoteok', [...open]);
  const engine = new MultiSourceVacancyEngine({ pool });
  engine.restore();
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

describe('11.11: archive page of a closed vacancy', () => {
  it('answers 200 «В архиве» for a closed card that was in the sitemap', async () => {
    const server = await app(archiveDatabase([archived('arch1')]), [0, 1, 2].map(openVacancy));
    const response = await server.inject({ method: 'GET', url: ARCHIVED_PATH });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('В архиве');
    expect(body).toContain(`<link rel="canonical" href="https://openqareer.com${ARCHIVED_PATH}">`);
    expect(body).not.toMatch(/noindex/u);
    expect(body).not.toContain('JobPosting');
    // The text is behind a cut, escaped, and the apply button is gone.
    expect(body).toMatch(/<details[^>]*>[\s\S]*Делаем интерфейсы на React/u);
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).not.toContain('Открыть у работодателя');
    expect(body).not.toContain('boards.example.com/1');
    // Similar open vacancies: same role and place, live links.
    expect(body).toContain('Похожие открытые вакансии');
    expect(body).toMatch(/href="\/vacancies\/job\/frontend-developer[^"]*"/u);
  });

  it('answers 200 for a closed card with impressions only', async () => {
    const row = archived('arch1', {
      last_listed_at: null,
      last_impression_at: new Date().toISOString(),
    });
    const response = await (
      await app(archiveDatabase([row]))
    ).inject({
      method: 'GET',
      url: ARCHIVED_PATH,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Похожих открытых вакансий сейчас нет');
  });

  it('keeps 410 for a closed card nobody has seen, and for an old archive', async () => {
    const unseen = archived('arch1', { last_listed_at: null });
    const old = archived('arch2', {
      last_seen_at: new Date(Date.now() - 200 * DAY).toISOString(),
      last_impression_at: new Date(Date.now() - 100 * DAY).toISOString(),
    });
    const server = await app(archiveDatabase([unseen, old]));
    for (const url of [ARCHIVED_PATH, '/vacancies/job/frontend-developer-at-acme-arch2']) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(410);
    }
    const never = await server.inject({ method: 'GET', url: '/vacancies/job/x-at-y-nope' });
    expect(never.statusCode).toBe(410);
  });
});
