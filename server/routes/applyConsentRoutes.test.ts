import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

const cleanups: Array<() => Promise<void> | void> = [];
const URL = '/api/v1/candidate/apply-consents';
const V11 = 'actions_on_behalf-v1.1';
const ID = '00000000-0000-4000-8000-000000000001';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-apply-consent-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 't.sqlite'),
    cabinetB640Usernames: ['a.test', 'b.test'],
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
  const people = { a: principal('a.test'), b: principal('b.test'), plain: principal('plain.test') };
  const sessions = new Map(Object.entries(people));
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const consents = new SqliteCapabilityConsentStore({ databasePath: config.databasePath });
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    capabilityConsentStore: consents,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3000' },
      ...(payload ? { payload } : {}),
    });
  const id = (who: 'a' | 'b') => people[who].candidate!.id;
  const grant = (who: 'a' | 'b') =>
    consents.recordConsent({ userId: id(who), capability: 'actions_on_behalf', versionId: V11 });
  const raw = <T>(read: (database: DatabaseSync) => T): T => {
    const database = new DatabaseSync(config.databasePath);
    try {
      return read(database);
    } finally {
      database.close();
    }
  };
  return { candidateStore, consents, call, id, grant, raw };
}

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  applicationId: null,
  host: 'boards.greenhouse.io',
  employer: 'Ромашка',
  checkboxText: 'Согласен на обработку персональных данных',
  policyUrl: 'https://romashka.example/privacy',
  policySha256: 'a'.repeat(64),
  checkboxLabel: 'Даю согласие',
  command: 'Отправить отклик',
  ...overrides,
});

describe('B787: журнал согласий по отклику', () => {
  it('без принятого поручения v1.1 ничего не записывает', async () => {
    const { call, consents, id } = await setup();
    consents.recordConsent({
      userId: id('a'),
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
    });
    const refused = await call('POST', URL, 'a', entry());
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('apply_mandate_required');
    expect((await call('GET', URL, 'a')).json().data.entries).toEqual([]);
  });

  it('пишет запись и результат, версию и время ставит сервер, содержимое запечатано', async () => {
    const { call, grant, raw } = await setup();
    grant('a');
    const created = await call('POST', URL, 'a', entry());
    expect(created.statusCode).toBe(201);
    expect((await call('POST', `${URL}/${ID}/result`, 'a', { result: 'failed' })).statusCode).toBe(
      200,
    );
    expect((await call('POST', `${URL}/${ID}/result`, 'a', { result: 'sent' })).statusCode).toBe(
      200,
    );
    const [item] = (await call('GET', URL, 'a')).json().data.entries;
    expect(item).toMatchObject({
      ...entry(),
      mandateVersion: V11,
      results: [{ result: 'failed' }, { result: 'sent' }],
    });
    expect(item.occurredAt).toMatch(/Z$/);
    const stored = raw((database) =>
      JSON.stringify(database.prepare('SELECT * FROM apply_consent_journal').all()),
    );
    expect(stored).not.toContain('Даю согласие');
    expect(stored).not.toContain('Ромашка');
  });

  it('повтор той же записи не меняет её и не дублирует; чужой номер занять нельзя', async () => {
    const { call, grant } = await setup();
    grant('a');
    grant('b');
    await call('POST', URL, 'a', entry());
    expect((await call('POST', URL, 'a', entry())).statusCode).toBe(200);
    expect((await call('POST', URL, 'a', entry({ employer: 'Другая' }))).statusCode).toBe(409);
    expect((await call('POST', URL, 'b', entry())).statusCode).toBe(409);
    expect((await call('POST', `${URL}/${ID}/result`, 'b', { result: 'sent' })).statusCode).toBe(
      404,
    );
    expect((await call('GET', URL, 'b')).json().data.entries).toEqual([]);
    expect((await call('GET', URL, 'a')).json().data).toMatchObject({
      total: 1,
      entries: [{ employer: 'Ромашка' }],
    });
  });

  it.each([
    ['адрес политики не https', { policyUrl: 'javascript:alert(1)' }],
    ['хэш не sha-256', { policySha256: 'abc' }],
    ['хэш без ссылки', { policyUrl: null }],
    ['хост с путём', { host: 'a.example/x' }],
    ['пустой текст', { checkboxText: ' ' }],
    ['версия от клиента', { mandateVersion: 'v9' }],
    ['чужой отклик', { applicationId: 'missing' }],
  ])('отклоняет: %s', async (_name, overrides) => {
    const { call, grant } = await setup();
    grant('a');
    expect((await call('POST', URL, 'a', entry(overrides))).statusCode).toBe(400);
  });

  it('отзыв закрывает новые записи, прежние остаются', async () => {
    const { call, grant, consents, id } = await setup();
    grant('a');
    await call('POST', URL, 'a', entry());
    consents.revokeConsent(id('a'), 'actions_on_behalf');
    expect(
      (await call('POST', URL, 'a', entry({ id: '00000000-0000-4000-8000-000000000002' })))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `${URL}/${ID}/result`, 'a', { result: 'unconfirmed' })).statusCode,
    ).toBe(200);
    expect((await call('GET', URL, 'a')).json().data.total).toBe(1);
  });

  it('есть в выгрузке и стирается с кандидатом', async () => {
    const { call, grant, candidateStore, id, raw } = await setup();
    grant('a');
    await call('POST', URL, 'a', entry());
    await call('POST', `${URL}/${ID}/result`, 'a', { result: 'sent' });
    expect(candidateStore.exportCandidate(id('a')).automation.applyConsents).toMatchObject([
      {
        checkboxText: entry().checkboxText,
        checkboxLabel: 'Даю согласие',
        results: [{ result: 'sent' }],
      },
    ]);
    expect(candidateStore.exportCandidate(id('b')).automation.applyConsents).toEqual([]);
    candidateStore.deleteCandidate(id('a'));
    expect(
      raw((database) =>
        database
          .prepare(
            'SELECT (SELECT COUNT(*) FROM apply_consent_journal) + (SELECT COUNT(*) FROM apply_consent_results) AS n',
          )
          .get(),
      ),
    ).toEqual({ n: 0 });
  });

  it('без флага и для чужого отклика — как несуществующий адрес', async () => {
    const { call } = await setup();
    expect((await call('GET', URL, 'plain')).statusCode).toBe(404);
    expect((await call('GET', `${URL}?limit=1000`, 'a')).statusCode).toBe(400);
  });
});
