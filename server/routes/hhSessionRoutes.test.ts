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
import { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';
import { APPLY_MANDATE_VERSION } from '../candidate/applyMandate';
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
  const consents = new SqliteCapabilityConsentStore({ databasePath: config.databasePath });
  const grant = (userId: string) =>
    consents.recordConsent({ userId, capability: 'actions_on_behalf', versionId: APPLY_MANDATE_VERSION });
  const flaggedId = sessions.get(flagged)!.candidate!.id;
  for (const token of [flagged, other]) grant(sessions.get(token)!.candidate!.id);
  const revokeMandate = () => consents.revokeConsent(flaggedId, 'actions_on_behalf');
  cleanups.push(() => consents.close());
  return { app, databasePath: config.databasePath, revokeMandate };
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

describe('B787: поручение перед откликом hh.ru', () => {
  it('без поручения отклик не начинается и попытка не тратится', async () => {
    const { app, databasePath, revokeMandate } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    revokeMandate();
    const refused = await call(app, 'POST', APPLY, flagged, attempt());
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('apply_mandate_required');
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

  it('B704: keep the read date when nothing was read from hh.ru', async () => {
    const { app } = await setup();
    const first = (await call(app, 'PUT', RESUMES, flagged, SNAPSHOT)).json().data.readAt;
    await new Promise((done) => setTimeout(done, 5));
    for (const extra of [{ contentRead: false }, { contents: [] }]) {
      const saved = await call(app, 'PUT', RESUMES, flagged, { ...SNAPSHOT, ...extra });
      expect(saved.json().data.readAt).toBe(first);
    }
    expect((await call(app, 'PUT', RESUMES, flagged, SNAPSHOT)).json().data.readAt).not.toBe(first);
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

  it('B708: a response finished in the hh.ru window turns the failed attempt into a sent one', async () => {
    const { app, databasePath } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    const { attemptId } = (await call(app, 'POST', APPLY, flagged, attempt())).json().data;
    const result = `${APPLY}/${attemptId}/result`;
    await call(app, 'POST', result, flagged, { outcome: 'failed', failureCode: 'captcha' });
    const late = { outcome: 'sent', vacancyId: '123456' };

    expect((await call(app, 'POST', result, other, late)).statusCode).toBe(404);
    expect((await call(app, 'POST', result, flagged, { ...late, vacancyId: '777' })).statusCode).toBe(409);
    expect((await call(app, 'POST', result, flagged, { outcome: 'sent' })).statusCode).toBe(409);
    expect((await call(app, 'POST', result, flagged, { ...late, outcome: 'questionnaire' })).statusCode).toBe(409);
    expect((await call(app, 'POST', result, flagged, late)).statusCode).toBe(200);
    expect((await call(app, 'POST', result, flagged, late)).statusCode).toBe(409);

    expect((await call(app, 'POST', APPLY, flagged, attempt())).json().error.code).toBe('hh_already_applied');
    // Пауза после проверки hh.ru остаётся: код сбоя не стирается.
    expect((await call(app, 'POST', APPLY, flagged, attempt({ vacancyId: '777' }))).json().error.code).toBe(
      'hh_cooldown',
    );
    expect(tableRows(databasePath, 'hh_apply_attempts')).toMatchObject([{ outcome: 'sent', failure_code: 'captcha' }]);
  });

  it('B708: a late response is refused after the deadline and for failures that leave no vacancy window', async () => {
    const { app, databasePath } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    const failedWith = async (vacancyId: string, failureCode: string) => {
      const { attemptId } = (await call(app, 'POST', APPLY, flagged, attempt({ vacancyId }))).json().data;
      await call(app, 'POST', `${APPLY}/${attemptId}/result`, flagged, { outcome: 'failed', failureCode });
      return () => call(app, 'POST', `${APPLY}/${attemptId}/result`, flagged, { outcome: 'sent', vacancyId });
    };
    const noWindow = await failedWith('111', 'no_response_button');
    expect((await noWindow()).statusCode).toBe(409);
    const stale = await failedWith('222', 'popup_missing');
    const database = new DatabaseSync(databasePath);
    database
      .prepare('UPDATE hh_apply_attempts SET finished_at = ?')
      .run(new Date(Date.now() - 16 * 60_000).toISOString());
    database.close();
    expect((await stale()).statusCode).toBe(409);
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

describe('B787: согласие по поручению', () => {
  const CONSENT = { text: 'Согласен на обработку персональных данных', url: 'https://hh.ru/policy' };
  const JOURNAL = '/api/v1/candidate/apply-consents';

  async function start() {
    const { app, databasePath } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    const { attemptId, consent } = (await call(app, 'POST', APPLY, flagged, attempt())).json().data;
    expect(consent).toBe(true);
    const finish = (result: Record<string, unknown>) =>
      call(app, 'POST', `${APPLY}/${attemptId}/result`, flagged, result);
    const entries = async () => (await call(app, 'GET', JOURNAL, flagged)).json().data.entries;
    return { app, databasePath, finish, entries };
  }

  it('галочка пишется в запечатанный журнал с действующим поручением', async () => {
    const { finish, entries, databasePath } = await start();
    const sent = { outcome: 'sent', consents: [CONSENT], employer: 'Ромашка', applicationId: 'foreign' };
    expect((await finish(sent)).statusCode).toBe(200);
    expect((await finish(sent)).statusCode).toBe(409);
    expect(await entries()).toMatchObject([
      {
        host: 'hh.ru',
        employer: 'Ромашка',
        applicationId: null,
        checkboxText: CONSENT.text,
        policyUrl: CONSENT.url,
        mandateVersion: APPLY_MANDATE_VERSION,
        results: [{ result: 'sent' }],
      },
    ]);
    expect(JSON.stringify(tableRows(databasePath, 'apply_consent_journal'))).not.toContain(CONSENT.text);
  });

  it('неподтверждённая отправка записана, поздний отклик дописывает результат', async () => {
    const { finish, entries } = await start();
    await finish({ outcome: 'failed', failureCode: 'no_confirmation', consents: [CONSENT] });
    expect((await entries())[0].results).toMatchObject([{ result: 'unconfirmed' }]);
    expect((await finish({ outcome: 'sent', vacancyId: '123456' })).statusCode).toBe(200);
    expect((await entries())[0].results).toMatchObject([{ result: 'unconfirmed' }, { result: 'sent' }]);
  });

  it.each(['http://hh.ru/policy', 'javascript:alert(1)'])('ссылка на политику только https: %s', async (url) => {
    const { finish, entries } = await start();
    expect((await finish({ outcome: 'sent', consents: [{ ...CONSENT, url }] })).statusCode).toBe(400);
    expect(await entries()).toEqual([]);
  });

  it('отклик не ушёл — согласие не записано; already_applied закрывает повтор', async () => {
    const { app, finish, entries } = await start();
    await finish({ outcome: 'failed', failureCode: 'already_applied', consents: [CONSENT] });
    expect(await entries()).toEqual([]);
    const again = await call(app, 'POST', APPLY, flagged, attempt());
    expect(again.json().error.code).toBe('hh_already_applied');
  });
});

describe('B787: копия резюме hh.ru под вакансию', () => {
  const COPY = { sourceId: 'abc123', knownIds: ['abc123'], copyId: 'copy1', stage: 'hidden' };
  const put = (app: App, copy: unknown) => call(app, 'PUT', `${RESUMES}/copy`, flagged, { vacancyId: 'v-1', copy });

  it('хранится за вакансией, переживает новое чтение резюме и снимается', async () => {
    const { app } = await setup();
    expect((await put(app, COPY)).statusCode).toBe(409);
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    expect((await put(app, COPY)).json().data.copy).toEqual(COPY);
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    const read = async (query: string) => (await call(app, 'GET', `${RESUMES}${query}`, flagged)).json().data;
    expect((await read('?vacancyId=v-1')).copy).toEqual(COPY);
    expect((await read('?vacancyId=v-2')).copy).toBeUndefined();
    expect((await read('')).copies).toBeUndefined();
    expect((await put(app, null)).json().data.copy).toBeUndefined();
  });

  it.each([
    { ...COPY, copyId: 'abc123' },
    { ...COPY, copyId: undefined },
    { ...COPY, knownIds: ['zzz'] },
    { ...COPY, stage: 'x' },
  ])('не принимает чужое или неполное: %j', async (copy) => {
    const { app } = await setup();
    await call(app, 'PUT', RESUMES, flagged, SNAPSHOT);
    expect((await put(app, copy)).statusCode).toBe(400);
  });

  it('незаполненной копией отклик не начинается', async () => {
    const { app } = await setup();
    const resumes = [...SNAPSHOT.resumes, { id: 'copy1', title: 'Копия' }];
    await call(app, 'PUT', RESUMES, flagged, { ...SNAPSHOT, resumes });
    await put(app, COPY);
    const refused = await call(app, 'POST', APPLY, flagged, attempt({ resumeId: 'copy1' }));
    expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'hh_copy_not_ready']);
    await put(app, { ...COPY, stage: 'ready' });
    expect((await call(app, 'POST', APPLY, flagged, attempt({ resumeId: 'copy1' }))).json().error?.code).not.toBe('hh_copy_not_ready');
  });
});
