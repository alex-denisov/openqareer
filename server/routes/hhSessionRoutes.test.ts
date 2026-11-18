import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { hhVacancyIdFromUrl } from '../../shared/hhCandidateSession';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const flagged = 'token-flagged';
const plain = 'token-plain';
const other = 'token-other';
const RESUMES = '/api/v1/candidate/hh/resumes';
const APPLY = '/api/v1/candidate/hh/applications';

const SNAPSHOT = {
  resumes: [
    { id: 'abc123', title: 'Руководитель разработки', updatedLabel: 'обновлено 3 ноября' },
    { id: 'def456', title: 'Ведущий разработчик Go' },
  ],
  selected: { id: 'abc123', title: 'Руководитель разработки', text: 'Марина Соколова. Опыт 12 лет.' },
};

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-hh-session-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test', 'other.test'],
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
  const sessions = new Map([
    [flagged, principal('flagged.test')],
    [plain, principal('plain.test')],
    [other, principal('other.test')],
  ]);
  const authService: SessionAuth = { ...noSessions, authenticate: (token: string) => sessions.get(token) ?? null };
  const app = await buildApp({ config, candidateStore, authService, coachProvider: {} as never, serveStatic: false });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return { app, databasePath: config.databasePath };
}

function call(app: App, method: 'GET' | 'PUT' | 'POST', path: string, token?: string, payload?: unknown) {
  return app.inject({
    method,
    url: path,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

function tableRows(databasePath: string, table: string): Array<Record<string, unknown>> {
  const database = new DatabaseSync(databasePath);
  try {
    const exists = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    return exists ? (database.prepare(`SELECT * FROM ${table}`).all() as never) : [];
  } finally {
    database.close();
  }
}

const attempt = (overrides: Record<string, unknown> = {}) => ({
  vacancyId: '123456',
  resumeId: 'abc123',
  confirmed: true,
  ...overrides,
});

describe('B704: hh.ru session routes without the B640 flag', () => {
  it('answer like a missing address and write nothing', async () => {
    const { app, databasePath } = await setup();
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    const routes: ReadonlyArray<['GET' | 'PUT' | 'POST', string, unknown?]> = [
      ['GET', RESUMES],
      ['PUT', RESUMES, SNAPSHOT],
      ['POST', APPLY, attempt()],
      ['POST', `${APPLY}/x/result`, { outcome: 'sent' }],
    ];
    for (const [method, path, payload] of routes) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, path, token, payload);
        expect(response.statusCode, `${method} ${path}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
    expect(tableRows(databasePath, 'hh_resume_snapshots')).toEqual([]);
    expect(tableRows(databasePath, 'hh_apply_attempts')).toEqual([]);
  });
});

describe('B704: resumes read in the candidate hh.ru session', () => {
  it('are stored sealed and returned only to their candidate', async () => {
    const { app, databasePath } = await setup();
    expect((await call(app, 'GET', RESUMES, flagged)).json().data).toBeNull();
    const saved = await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ ...SNAPSHOT, readAt: expect.any(String) });
    expect((await call(app, 'GET', RESUMES, flagged)).json().data.selected.text).toBe(
      'Марина Соколова. Опыт 12 лет.',
    );
    expect((await call(app, 'GET', RESUMES, other)).json().data).toBeNull();
    const stored = JSON.stringify(tableRows(databasePath, 'hh_resume_snapshots'));
    expect(stored).not.toContain('Марина');
    expect(stored).not.toContain('Руководитель');
  });

  it('reject a selected resume that is not in the list and malformed input', async () => {
    const { app } = await setup();
    const bad = [
      { ...SNAPSHOT, selected: { ...SNAPSHOT.selected, id: 'zzz999' } },
      { ...SNAPSHOT, resumes: [{ id: 'a b', title: 'x' }] },
      { ...SNAPSHOT, resumes: Array.from({ length: 21 }, (_, index) => ({ id: `r${index}`, title: 'x' })) },
      { ...SNAPSHOT, selected: { ...SNAPSHOT.selected, text: 'x'.repeat(40_001) } },
      { ...SNAPSHOT, extra: true },
    ];
    for (const payload of bad) expect((await call(app, 'PUT', RESUMES, flagged, payload)).statusCode).toBe(400);
  });
});

describe('B704: an hh.ru application on the candidate behalf', () => {
  it('needs the candidate confirmation and a resume from the session', async () => {
    const { app, databasePath } = await setup();
    expect((await call(app, 'POST', APPLY, flagged, attempt())).statusCode).toBe(409);
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    expect((await call(app, 'POST', APPLY, flagged, attempt({ confirmed: false }))).statusCode).toBe(400);
    expect((await call(app, 'POST', APPLY, flagged, attempt({ resumeId: 'zzz999' }))).statusCode).toBe(409);
    expect((await call(app, 'POST', APPLY, flagged, attempt({ vacancyId: '0x1' }))).statusCode).toBe(400);
    expect(tableRows(databasePath, 'hh_apply_attempts')).toEqual([]);
    const started = await call(app, 'POST', APPLY, flagged, attempt());
    expect(started.statusCode).toBe(201);
    expect(started.json().data).toMatchObject({ remainingToday: 14 });
  });

  it('records the outcome once and refuses a second application to the same vacancy', async () => {
    const { app } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    const { attemptId } = (await call(app, 'POST', APPLY, flagged, attempt())).json().data;
    // Пока отклик идёт, второй на ту же вакансию не начинается.
    expect((await call(app, 'POST', APPLY, flagged, attempt())).json().error.code).toBe('hh_apply_in_progress');
    expect((await call(app, 'POST', `${APPLY}/${attemptId}/result`, other, { outcome: 'sent' })).statusCode).toBe(
      404,
    );
    const done = await call(app, 'POST', `${APPLY}/${attemptId}/result`, flagged, { outcome: 'sent' });
    expect(done.statusCode).toBe(200);
    expect((await call(app, 'POST', `${APPLY}/${attemptId}/result`, flagged, { outcome: 'failed' })).statusCode).toBe(
      409,
    );
    expect((await call(app, 'POST', APPLY, flagged, attempt())).json().error.code).toBe('hh_already_applied');
  });

  it('after a failure the candidate may try the same vacancy again', async () => {
    const { app } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    const { attemptId } = (await call(app, 'POST', APPLY, flagged, attempt())).json().data;
    await call(app, 'POST', `${APPLY}/${attemptId}/result`, flagged, { outcome: 'failed', failureCode: 'no_button' });
    expect((await call(app, 'POST', APPLY, flagged, attempt())).statusCode).toBe(201);
  });

  it('after a captcha hh.ru gets an hour of pause before the next application', async () => {
    const { app } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    const { attemptId } = (await call(app, 'POST', APPLY, flagged, attempt())).json().data;
    await call(app, 'POST', `${APPLY}/${attemptId}/result`, flagged, { outcome: 'failed', failureCode: 'captcha' });
    const paused = await call(app, 'POST', APPLY, flagged, attempt({ vacancyId: '777' }));
    expect(paused.statusCode).toBe(429);
    expect(paused.json().error.code).toBe('hh_cooldown');
  });

  it('keeps to the daily limit of hh.ru applications', async () => {
    const { app } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    for (let index = 0; index < 15; index += 1) {
      const started = await call(app, 'POST', APPLY, flagged, attempt({ vacancyId: String(1000 + index) }));
      expect(started.statusCode, `attempt ${index}`).toBe(201);
    }
    const over = await call(app, 'POST', APPLY, flagged, attempt({ vacancyId: '9999' }));
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('hh_daily_limit_reached');
  });
});

describe('B704: hh.ru vacancy number from its address', () => {
  it('takes only hh.ru vacancy pages', () => {
    expect(hhVacancyIdFromUrl('https://hh.ru/vacancy/123456')).toBe('123456');
    expect(hhVacancyIdFromUrl('https://spb.hh.ru/vacancy/77/')).toBe('77');
    expect(hhVacancyIdFromUrl('http://hh.ru/vacancy/1')).toBeNull();
    expect(hhVacancyIdFromUrl('https://hh.ru.evil.com/vacancy/1')).toBeNull();
    expect(hhVacancyIdFromUrl('https://hh.ru/employer/1')).toBeNull();
    expect(hhVacancyIdFromUrl('not a url')).toBeNull();
    expect(hhVacancyIdFromUrl(null)).toBeNull();
  });
});
