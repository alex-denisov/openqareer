import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { RELOCATION_CONSENT_VERSION } from '../../shared/relocationQuestionnaire';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const PATH = '/api/v1/candidate/career/relocation/places';
const CITIES = '/api/v1/candidate/career/relocation/cities';

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-places-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test'],
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const principals = { flagged: principal('flagged.test'), plain: principal('plain.test') };
  const sessions = new Map([
    ['token-flagged', principals.flagged],
    ['token-plain', principals.plain],
  ]);
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  const id = principals.flagged.candidate!.id;
  return { app, candidateStore, id, databasePath: config.databasePath };
}

function call(
  app: App,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

function addEntries(databasePath: string, slug: string, count: number) {
  const database = new DatabaseSync(databasePath);
  database.exec(`CREATE TABLE IF NOT EXISTS catalog_entries (cluster_id TEXT PRIMARY KEY,
    entry_key TEXT, path TEXT, title TEXT, company TEXT, is_remote INTEGER, summary TEXT,
    skills_json TEXT, source_url TEXT, published_at TEXT, last_seen_at TEXT, source_count INTEGER,
    status TEXT, place_slug TEXT, place_label TEXT, published_ms INTEGER, last_seen_ms INTEGER)`);
  const insert = database.prepare(
    `INSERT INTO catalog_entries (cluster_id, entry_key, path, title, company, is_remote, summary,
       skills_json, source_url, published_at, last_seen_at, source_count, status, place_slug,
       place_label, published_ms, last_seen_ms)
     VALUES (?, ?, ?, 'Руководитель', 'Компания', 0, '', '[]', 'https://hh.ru/v', '2026-11-01',
       '2026-11-01', 1, 'active', ?, ?, 1, 1)`,
  );
  for (let index = 0; index < count; index += 1)
    insert.run(`${slug}-${index}`, `${slug}-${index}`, `/v/${slug}-${index}`, slug, slug);
  database.close();
}

const BODY = {
  places: [
    { kind: 'country', code: 'RS', skipped: [] },
    { kind: 'city', slug: 'kazan', skipped: ['education'] },
  ],
};

describe('B672 relocation places routes', () => {
  it('answers 404 without the B640 flag and without a session, like a missing route', async () => {
    const { app } = await setup();
    for (const url of [PATH, CITIES]) {
      expect((await call(app, 'GET', url, 'token-plain')).statusCode).toBe(404);
      expect((await call(app, 'GET', url)).statusCode).toBe(404);
    }
    expect((await call(app, 'PUT', PATH, 'token-plain', BODY)).statusCode).toBe(404);
  });

  it('keeps chosen places with skipped sections between visits, after consent', async () => {
    const { app, candidateStore, id } = await setup();
    expect((await call(app, 'GET', PATH, 'token-flagged')).json().data).toEqual({
      saved: false,
      places: [],
      updatedAt: null,
    });
    const denied = await call(app, 'PUT', PATH, 'token-flagged', BODY);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('relocation_consent_required');
    candidateStore.relocationQuestionnaireRepo.grantConsent(
      id,
      RELOCATION_CONSENT_VERSION,
      new Date().toISOString(),
    );
    expect((await call(app, 'PUT', PATH, 'token-flagged', BODY)).statusCode).toBe(200);
    const read = (await call(app, 'GET', PATH, 'token-flagged')).json().data;
    expect(read.saved).toBe(true);
    expect(read.places).toEqual(BODY.places);
    expect(typeof read.updatedAt).toBe('string');
  });

  it('rejects a foreign city, a repeated place and an unknown section', async () => {
    const { app, candidateStore, id } = await setup();
    candidateStore.relocationQuestionnaireRepo.grantConsent(
      id,
      RELOCATION_CONSENT_VERSION,
      new Date().toISOString(),
    );
    const bad = { places: [{ kind: 'city', slug: 'belgrade', skipped: [] }] };
    const response = await call(app, 'PUT', PATH, 'token-flagged', bad);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_places');
  });

  it('lists Russian cities with active catalog vacancies, largest first', async () => {
    const { app, databasePath } = await setup();
    addEntries(databasePath, 'kazan', 3);
    addEntries(databasePath, 'saint-petersburg', 5);
    addEntries(databasePath, 'belgrade', 7);
    const response = await call(app, 'GET', CITIES, 'token-flagged');
    expect(response.statusCode).toBe(200);
    expect(response.json().data.cities).toEqual([
      { slug: 'saint-petersburg', name: 'Санкт-Петербург', vacancies: 5 },
      { slug: 'kazan', name: 'Казань', vacancies: 3 },
    ]);
  });
});
