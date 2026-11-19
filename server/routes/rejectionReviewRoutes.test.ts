import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const REVIEW = '/api/v1/candidate/applications/rejection-review';
const flagged = 'token-flagged';
const plain = 'token-plain';
const other = 'token-other';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-rejection-'));
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
  const add = (token: string, stage: 'saved' | 'applied' | 'rejected', title: string) =>
    candidateStore.createApplication(sessions.get(token)!.candidate!.id, {
      stage,
      vacancy: { title, company: 'Сбыт Онлайн', url: 'https://example.test/v', source: 'manual' },
    });
  const floor = (token: string, salaryFloor: number) =>
    candidateStore.decisionProfileRepo.put(
      sessions.get(token)!.candidate!.id,
      { citizenship: [], languages: [], workFormats: [], salaryFloor, salaryCurrency: 'RUB' },
      '2026-11-19T00:00:00.000Z',
    );
  return { app, add, floor, databasePath: config.databasePath };
}

function call(
  app: App,
  method: 'GET' | 'PUT' | 'PATCH',
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

function rowCount(databasePath: string, table: string): number {
  const database = new DatabaseSync(databasePath);
  try {
    return (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    database.close();
  }
}

describe('rejection review routes without the B640 flag', () => {
  it('answer like a missing address and write nothing', async () => {
    const { app, add, databasePath } = await setup();
    const rejected = add(plain, 'rejected', 'Руководитель группы');
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    const routes: ReadonlyArray<['GET' | 'PUT', string, unknown?]> = [
      ['GET', REVIEW],
      ['PUT', `${REVIEW}/feedback`, { helped: true }],
      [
        'PUT',
        `/api/v1/candidate/applications/${rejected.id}/rejection-reason`,
        { reason: 'level' },
      ],
    ];
    for (const [method, url, payload] of routes) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
    expect(rowCount(databasePath, 'application_rejection_reasons')).toBe(0);
    expect(rowCount(databasePath, 'rejection_review_feedback')).toBe(0);
  });

  it('leave the old applications routes as they were', async () => {
    const { app, add } = await setup();
    const application = add(plain, 'applied', 'Аналитик');
    const list = await call(app, 'GET', '/api/v1/candidate/applications?tz=180', plain);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(Object.keys(list.json().data[0])).not.toContain('rejectionReason');
    const funnel = await call(app, 'GET', '/api/v1/candidate/applications/funnel', plain);
    expect(funnel.statusCode).toBe(200);
    expect(funnel.json().data.applied).toBe(1);
    const patched = await call(
      app,
      'PATCH',
      `/api/v1/candidate/applications/${application.id}`,
      plain,
      {
        expectedVersion: application.version,
        stage: 'rejected',
      },
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.stage).toBe('rejected');
  });
});

describe('rejection review routes with the B640 flag', () => {
  it('returns the low-data state with the rejection and no invented guess', async () => {
    const { app, add } = await setup();
    add(flagged, 'saved', 'Черновик');
    add(flagged, 'applied', 'Аналитик');
    const rejected = add(flagged, 'rejected', 'Руководитель группы');
    const response = await call(app, 'GET', REVIEW, flagged);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    const review = response.json().data;
    expect(review).toMatchObject({
      state: 'low_data',
      sentCount: 2,
      threshold: 20,
      rejectedCount: 1,
      helped: null,
    });
    expect(review.rejections).toEqual([
      expect.objectContaining({
        applicationId: rejected.id,
        title: 'Руководитель группы',
        company: 'Сбыт Онлайн',
        guess: null,
        candidateReason: null,
      }),
    ]);
    expect(review.recommendations).toEqual([]);
  });

  it('B645: low data carries the three checks; the money check needs a salary floor', async () => {
    const { app, add, floor } = await setup();
    add(flagged, 'saved', 'Черновик');
    add(flagged, 'applied', 'Аналитик');
    add(flagged, 'rejected', 'Руководитель группы');
    const bare = (await call(app, 'GET', REVIEW, flagged)).json().data.checks;
    expect(bare).toMatchObject({
      unfinished: { count: 1, total: 2 },
      late: { count: 0, total: 2 },
      salaryBelow: null,
    });
    expect(typeof bare.since).toBe('string');
    floor(flagged, 500_000);
    const withFloor = (await call(app, 'GET', REVIEW, flagged)).json().data.checks;
    expect(withFloor.salaryBelow).toEqual({ count: 0, total: 2, floor: 500_000, currency: 'RUB' });
  });

  it('records the candidate reason, replaces it and returns it in the review', async () => {
    const { app, add } = await setup();
    const rejected = add(flagged, 'rejected', 'Руководитель группы');
    const url = `/api/v1/candidate/applications/${rejected.id}/rejection-reason`;
    const first = await call(app, 'PUT', url, flagged, {
      reason: 'money',
      note: '  просили ниже вилки  ',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ reason: 'money', note: 'просили ниже вилки' });
    const second = await call(app, 'PUT', url, flagged, { reason: 'level' });
    expect(second.json().data).toMatchObject({ reason: 'level', note: null });
    const review = (await call(app, 'GET', REVIEW, flagged)).json().data;
    expect(review.rejections[0].candidateReason).toMatchObject({ reason: 'level', note: null });
  });

  it('keeps the note sealed at rest', async () => {
    const { app, add, databasePath } = await setup();
    const rejected = add(flagged, 'rejected', 'Руководитель группы');
    await call(
      app,
      'PUT',
      `/api/v1/candidate/applications/${rejected.id}/rejection-reason`,
      flagged,
      {
        reason: 'other',
        note: 'секретная причина',
      },
    );
    const database = new DatabaseSync(databasePath);
    try {
      const row = database
        .prepare('SELECT note_cipher FROM application_rejection_reasons')
        .get() as {
        note_cipher: string;
      };
      expect(row.note_cipher).toBeTruthy();
      expect(row.note_cipher).not.toContain('секретная');
    } finally {
      database.close();
    }
  });

  it('rejects a bad reason, a long note, a foreign or a non-rejected application', async () => {
    const { app, add, databasePath } = await setup();
    const rejected = add(flagged, 'rejected', 'Руководитель группы');
    const active = add(flagged, 'applied', 'Аналитик');
    const url = (id: string) => `/api/v1/candidate/applications/${id}/rejection-reason`;
    expect((await call(app, 'PUT', url(rejected.id), flagged, { reason: 'bad' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await call(app, 'PUT', url(rejected.id), flagged, {
          reason: 'other',
          note: 'x'.repeat(2001),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call(app, 'PUT', url(rejected.id), flagged, { reason: 'other', extra: 1 })).statusCode,
    ).toBe(400);
    expect((await call(app, 'PUT', url(active.id), flagged, { reason: 'level' })).statusCode).toBe(
      409,
    );
    expect((await call(app, 'PUT', url(rejected.id), other, { reason: 'level' })).statusCode).toBe(
      404,
    );
    expect((await call(app, 'PUT', url('no-such'), flagged, { reason: 'level' })).statusCode).toBe(
      404,
    );
    expect(rowCount(databasePath, 'application_rejection_reasons')).toBe(0);
  });

  it('refuses a write from a foreign origin', async () => {
    const { app, add, databasePath } = await setup();
    const rejected = add(flagged, 'rejected', 'Руководитель группы');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/candidate/applications/${rejected.id}/rejection-reason`,
      headers: { cookie: `openqareer_session=${flagged}`, origin: 'https://evil.example' },
      payload: { reason: 'level' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('origin_not_allowed');
    expect(rowCount(databasePath, 'application_rejection_reasons')).toBe(0);
  });

  it('stores «разбор помог» per candidate', async () => {
    const { app } = await setup();
    expect(
      (await call(app, 'PUT', `${REVIEW}/feedback`, flagged, { helped: 'yes' })).statusCode,
    ).toBe(400);
    expect(
      (await call(app, 'PUT', `${REVIEW}/feedback`, flagged, { helped: false })).statusCode,
    ).toBe(200);
    expect(
      (await call(app, 'PUT', `${REVIEW}/feedback`, flagged, { helped: true })).statusCode,
    ).toBe(200);
    expect((await call(app, 'GET', REVIEW, flagged)).json().data.helped).toBe(true);
    expect((await call(app, 'GET', REVIEW, other)).json().data.helped).toBeNull();
  });
});
