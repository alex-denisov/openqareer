import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import {
  apps,
  candidateAuthorization,
  config,
  createApp,
  noSessions,
  stores,
  successProvider,
} from './appTestHarness';

describe('candidate platform connections', () => {
  async function createConnectionsApp(
    options: {
      desktopTunnel?: ServerConfig['desktopTunnel'];
    } = {},
  ) {
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const app = await buildApp({
      config: {
        ...config,
        desktopTunnel: options.desktopTunnel,
      },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
    });
    apps.push(app);
    stores.push(candidateStore);
    return {
      app,
      candidateStore,
      candidateId: candidate.id,
      authorization: `Bearer ${candidate.accessToken}`,
    };
  }

  it('publishes an honest connection catalog only to the candidate session', async () => {
    const { app, authorization } = await createConnectionsApp();

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().data).toEqual([
      {
        platform: 'linkedin',
        available: true,
        status: 'disconnected',
        capabilities: ['resume_read'],
        importsCareerHistory: true,
      },
      {
        platform: 'hh',
        available: true,
        status: 'disconnected',
        capabilities: ['resume_read'],
        importsCareerHistory: true,
      },
    ]);
  });

  it('returns tunnel bootstrap only to an authenticated candidate', async () => {
    const configured = await createConnectionsApp({
      desktopTunnel: {
        remoteServer: 'openqareer.com',
        remotePort: 443,
        sshUser: 'openqareer-tunnel',
        sshPrivateKeyBase64: Buffer.from(
          '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
        ).toString('base64'),
        sshHostKeyBase64: Buffer.from(
          'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISyntheticHostKeyForTests',
        ).toString('base64'),
        proxyUsername: 'synthetic_user',
        proxyPassword: 'synthetic-password-that-is-long-enough',
        localSocksPort: 10885,
        localHttpPort: 10886,
      },
    });
    const unauthorized = await configured.app.inject({
      method: 'GET',
      url: '/api/v1/candidate/desktop-tunnel',
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await configured.app.inject({
      method: 'GET',
      url: '/api/v1/candidate/desktop-tunnel',
      headers: { authorization: configured.authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().data).toMatchObject({
      remoteServer: 'openqareer.com',
      remotePort: 443,
      sshUser: 'openqareer-tunnel',
    });
  });

  it('disconnects a native connection receipt and retains candidate data', async () => {
    const { app, candidateStore, candidateId, authorization } = await createConnectionsApp();
    candidateStore.commitResumeImport(candidateId, {
      evidence: {
        sourceLabel: 'Импорт: резюме hh.ru',
        entries: [
          {
            memoryId: 'native-hh-connection-result',
            domain: 'outcome',
            statement: 'Сократил срок релиза.',
          },
        ],
      },
      draft: EMPTY_RESUME_DRAFT,
      sourceReceipt: {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: 'https://hh.ru/resume/native-only-731',
        capturedAt: '2026-08-23T12:00:00.000Z',
        importDigest: 'b'.repeat(64),
      },
    });

    const foreignOrigin = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { origin: 'https://attacker.example' },
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { authorization, origin: 'http://localhost:3000' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      platform: 'hh',
      status: 'disconnected',
      accessMode: 'native_session_snapshot',
      connectionRemoved: true,
      providerSession: 'not_managed',
      importedData: 'retained',
    });

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(
      connections.json().data.find((c: { platform: string }) => c.platform === 'hh').status,
    ).toBe('disconnected');
  });

  it('serves matched vacancies for candidate and manages vacancy sources for admin', async () => {
    const app = await createApp();
    const candidateAuth = candidateAuthorization(app);

    const matchedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies',
      headers: { authorization: candidateAuth },
    });
    expect(matchedRes.statusCode).toBe(200);
    expect(Array.isArray(matchedRes.json().data)).toBe(true);
    // Подбор отдаётся страницами внутри байтового бюджета: целиком тело до
    // браузера не доезжает (INC-029). Ответ обязан сказать, где продолжить.
    expect(matchedRes.json().meta).toMatchObject({
      total: expect.any(Number),
      offset: 0,
      nextOffset: null,
    });
    // Первая страница называет смещения всех страниц — иначе кабинет читает
    // пул шестьюдесятью кругами по каналу подряд (PRB-023, B211).
    expect(matchedRes.json().meta.pageOffsets).toEqual([0]);
    expect(Buffer.byteLength(matchedRes.body, 'utf8')).toBeLessThanOrEqual(16_384);

    const pagedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies?offset=5',
      headers: { authorization: candidateAuth },
    });
    expect(pagedRes.statusCode).toBe(200);
    expect(pagedRes.json().meta.offset).toBe(5);

    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancy-sources',
      headers: { authorization: candidateAuth },
    });
    expect(adminRes.statusCode).toBe(401);
  });

  // B180, срез 1б: гипотезы роли считает сервер, где пул полный. Наружу уходит
  // готовый ответ, и байтовый бюджет маршрута (INC-029) перестаёт мешать.
  it('отдаёт гипотезы роли готовыми и только вошедшему кандидату', async () => {
    const app = await createApp();

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
    });
    expect(anonymous.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
      headers: { authorization: candidateAuthorization(app) },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().data)).toBe(true);
    expect(response.json().data.length).toBeLessThanOrEqual(3);
    expect(response.json().meta).toMatchObject({ poolSize: expect.any(Number) });
    expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThanOrEqual(4_096);
  });

  // INC-035 / B186: очередь сдвигается молча, и без записи в лог отличить
  // исчерпанную квоту от таймаута тоннеля на проде нечем. Кандидату причина
  // не нужна — она не должна попадать в `meta`.
  it('пишет причину молчания ступени в лог сервера, а не в meta кандидату', async () => {
    const lines: string[] = [];
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    // Без подтверждённого профиля маршрут не спрашивает модель вовсе.
    candidateStore.saveResumeDraft(
      candidate.id,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Продакт-менеджер' },
      [],
    );
    const app = await buildApp({
      config: { ...config, logLevel: 'warn' },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
      logDestination: {
        write: (line: string) => {
          lines.push(line);
        },
      },
      roleNamer: {
        async nameRoles() {
          return {
            roles: [],
            failures: [
              {
                stage: 'gemini:gemini-3.6-flash',
                kind: 'http_error',
                status: 429,
                detail: 'RESOURCE_EXHAUSTED',
              },
            ],
          };
        },
      },
    });
    apps.push(app);
    stores.push(candidateStore);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
      headers: { authorization: `Bearer ${candidate.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json().meta)).not.toContain('RESOURCE_EXHAUSTED');

    const logged = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'role-naming-stage-failed');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      stage: 'gemini:gemini-3.6-flash',
      kind: 'http_error',
      status: 429,
      detail: 'RESOURCE_EXHAUSTED',
    });

    // Лог прод-сервера снаружи не читается: ключ выкатки выполняет три
    // команды, и `journalctl` в их числе нет. Окно последних отказов открыто
    // администратору — иначе причину молчания нечем доказать (INC-035).
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/provider/status',
      headers: { authorization: `Bearer ${config.previewToken}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.roleNaming.recentFailures).toMatchObject([
      { stage: 'gemini:gemini-3.6-flash', kind: 'http_error', status: 429, at: expect.any(String) },
    ]);
  });
});
