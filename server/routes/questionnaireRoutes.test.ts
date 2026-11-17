import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteQuestionnaireRepository } from '../candidate/sqliteQuestionnaireRepository';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const flagged = 'token-flagged';
const plain = 'token-plain';
const other = 'token-other';
const url = (vacancy: string, tail = '') => `/api/v1/candidate/vacancies/${vacancy}/questionnaire${tail}`;
const QUESTIONS = [
  { id: 'q1', text: 'Сколько человек было в вашей команде?', required: true, kind: 'text' as const },
  { id: 'q2', text: 'Ожидаемый уровень дохода?', required: true, kind: 'text' as const },
  { id: 'q3', text: 'Готовы ли к командировкам?', required: false, kind: 'text' as const },
];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-questionnaire-'));
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
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({ config, candidateStore, authService, coachProvider: {} as never, serveStatic: false });
  const forms = new SqliteQuestionnaireRepository({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => forms.close(),
    () => app.close(),
  );
  /** Вопросы, как если бы их прочитали у площадки. */
  const seed = (token: string, vacancyId: string) =>
    forms.saveQuestions(sessions.get(token)!.candidate!.id, vacancyId, {
      questions: QUESTIONS,
      formUrl: 'https://boards.greenhouse.io/acme/jobs/77',
      readAt: '2026-11-17T00:00:00.000Z',
    });
  return { app, seed, databasePath: config.databasePath };
}

function call(app: App, method: 'GET' | 'PUT' | 'POST', path: string, token?: string, payload?: unknown) {
  return app.inject({
    method,
    url: path,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

function rows(databasePath: string): Array<{ answers_cipher: string | null; submitted_at: string | null }> {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare('SELECT answers_cipher, submitted_at FROM application_questionnaires')
      .all() as never;
  } finally {
    database.close();
  }
}

describe('questionnaire routes without the B640 flag', () => {
  it('answer like a missing address and write nothing', async () => {
    const { app, seed, databasePath } = await setup();
    seed(plain, 'v1');
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    const routes: ReadonlyArray<['GET' | 'PUT' | 'POST', string, unknown?]> = [
      ['GET', url('v1')],
      ['PUT', url('v1', '/answers'), { answers: [{ questionId: 'q1', text: 'x' }] }],
      ['POST', url('v1', '/submitted')],
    ];
    for (const [method, path, payload] of routes) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, path, token, payload);
        expect(response.statusCode, `${method} ${path}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
    expect(rows(databasePath)).toEqual([{ answers_cipher: null, submitted_at: null }]);
  });

  it('leave the old vacancy routes as they were', async () => {
    const { app } = await setup();
    const fit = await call(app, 'GET', '/api/v1/candidate/vacancies/v1/fit', plain);
    const fitFlagged = await call(app, 'GET', '/api/v1/candidate/vacancies/v1/fit', flagged);
    expect(fit.statusCode).toBe(fitFlagged.statusCode);
    expect(fit.json().error?.code).toBe(fitFlagged.json().error?.code);
  });
});

describe('questionnaire routes with the B640 flag', () => {
  it('says there is no questionnaire for an unknown vacancy and stores nothing', async () => {
    const { app, databasePath } = await setup();
    const response = await call(app, 'GET', url('v-unknown'), flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ state: 'none', questions: [], total: 0, formUrl: null });
    expect(rows(databasePath)).toEqual([]);
  });

  it('keeps the stored questions when a day-old questionnaire cannot be read again', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE application_questionnaires SET read_at = '2026-01-01T00:00:00.000Z'").run();
    database.close();
    expect((await call(app, 'GET', url('v1'), flagged)).json().data).toMatchObject({ state: 'ready', total: 3 });
  });

  it('returns questions with readiness and saves answers sealed', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    const first = (await call(app, 'GET', url('v1'), flagged)).json().data;
    expect(first).toMatchObject({ state: 'ready', total: 3, answered: 0, missingRequired: 2 });
    expect(first.formUrl).toBe('https://boards.greenhouse.io/acme/jobs/77');
    const saved = await call(app, 'PUT', url('v1', '/answers'), flagged, {
      answers: [
        { questionId: 'q1', text: '  9 человек  ' },
        { questionId: 'gone', text: 'мимо' },
        { questionId: 'q3', text: '' },
      ],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ answered: 1, missingRequired: 1 });
    expect(saved.json().data.answers).toEqual([{ questionId: 'q1', text: '9 человек' }]);
    const again = (await call(app, 'GET', url('v1'), flagged)).json().data;
    expect(again.answers).toEqual([{ questionId: 'q1', text: '9 человек' }]);
    const cipher = rows(databasePath)[0].answers_cipher;
    expect(cipher).toBeTruthy();
    expect(cipher).not.toContain('человек');
  });

  it('keeps one candidate away from another candidate questionnaire', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    await call(app, 'PUT', url('v1', '/answers'), flagged, { answers: [{ questionId: 'q1', text: 'моё' }] });
    expect((await call(app, 'GET', url('v1'), other)).json().data.state).toBe('none');
    expect(
      (await call(app, 'PUT', url('v1', '/answers'), other, { answers: [{ questionId: 'q1', text: 'чужое' }] }))
        .statusCode,
    ).toBe(404);
    expect((await call(app, 'POST', url('v1', '/submitted'), other)).statusCode).toBe(404);
    expect(rows(databasePath)).toHaveLength(1);
    expect((await call(app, 'GET', url('v1'), flagged)).json().data.answers[0].text).toBe('моё');
  });

  it('rejects malformed answers and overlong text', async () => {
    const { app, seed } = await setup();
    seed(flagged, 'v1');
    const bad: unknown[] = [
      { answers: 'x' },
      { answers: [{ questionId: 'q1' }] },
      { answers: [{ questionId: 'q1', text: 'x'.repeat(4001) }] },
      { answers: [{ questionId: 'q1', text: 'x', extra: 1 }] },
      { answers: Array.from({ length: 41 }, () => ({ questionId: 'q1', text: 'x' })) },
    ];
    for (const payload of bad) {
      expect((await call(app, 'PUT', url('v1', '/answers'), flagged, payload)).statusCode).toBe(400);
    }
    expect((await call(app, 'GET', url('x'.repeat(201)), flagged)).statusCode).toBe(400);
  });

  it('marks the questionnaire as submitted by the candidate', async () => {
    const { app, seed } = await setup();
    expect((await call(app, 'POST', url('v1', '/submitted'), flagged)).statusCode).toBe(404);
    seed(flagged, 'v1');
    const done = await call(app, 'POST', url('v1', '/submitted'), flagged);
    expect(done.statusCode).toBe(200);
    expect((await call(app, 'GET', url('v1'), flagged)).json().data.submittedAt).toBe(done.json().data.submittedAt);
  });

  it('refuses a write from a foreign origin', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    const response = await app.inject({
      method: 'PUT',
      url: url('v1', '/answers'),
      headers: { cookie: `openqareer_session=${flagged}`, origin: 'https://evil.example' },
      payload: { answers: [{ questionId: 'q1', text: 'x' }] },
    });
    expect(response.statusCode).toBe(403);
    expect(rows(databasePath)[0].answers_cipher).toBeNull();
  });
});
