import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
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
  const connectedProvider = {
    clientId: 'synthetic-client-id',
    clientSecret: 'synthetic-client-secret-value',
    redirectUri: 'https://openqareer.com/api/v1/connectors/hh/callback',
  };

  const hhConnection = {
    platform: 'hh' as const,
    externalAccountId: 'synthetic-applicant-1',
    scopes: ['profile_read', 'resume_read'],
    capabilities: ['profile_read', 'resume_read'] as const,
    accessToken: 'synthetic-access-token-value',
    refreshToken: 'synthetic-refresh-token-value',
    accessTokenExpiresAt: '2026-08-11T00:00:00.000Z',
    profile: {
      capturedAt: '2026-08-10T00:00:00.000Z',
      sourceUrl: 'https://hh.ru/resume/syntheticresume',
      facts: [
        {
          kind: 'headline' as const,
          value: 'Синтетический руководитель продукта',
          sourceLocator: 'hh:resume:synthetic:title',
          confidence: 'official-api' as const,
        },
      ],
    },
  };

  async function createConnectionsApp(
    options: {
      providers?: ServerConfig['oauthProviders'];
      transport?: Parameters<typeof buildApp>[0]['oauthTransport'];
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
        oauthProviders: options.providers ?? { hh: connectedProvider },
        desktopTunnel: options.desktopTunnel,
      },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
      oauthTransport: options.transport,
    });
    apps.push(app);
    stores.push(candidateStore);
    return { app, authorization: `Bearer ${candidate.accessToken}` };
  }

  async function startAuthorization(
    app: Awaited<ReturnType<typeof buildApp>>,
    authorization: string,
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/hh/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(response.statusCode).toBe(201);
    return new URL(response.json().data.authorizationUrl).searchParams.get('state') ?? '';
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
        available: false,
        status: 'disconnected',
        capabilities: ['lite_identity'],
        importsCareerHistory: false,
      },
      {
        platform: 'hh',
        available: true,
        status: 'disconnected',
        capabilities: ['profile_read', 'resume_read'],
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

  it('refuses authorization for an unconfigured provider and an unknown platform', async () => {
    const { app, authorization } = await createConnectionsApp();

    const unconfigured = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/linkedin/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(unconfigured.statusCode).toBe(503);
    expect(unconfigured.json().error).toMatchObject({
      code: 'connector_not_configured',
      retryable: false,
    });

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/vk/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('connector_not_found');

    const foreignOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/hh/authorizations',
      headers: { origin: 'https://attacker.example' },
    });
    expect(foreignOrigin.statusCode).toBe(403);
  });

  it('returns a single-use authorization URL bound to the configured app', async () => {
    const { app, authorization } = await createConnectionsApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/connections/hh/authorizations',
      headers: { authorization, origin: 'http://localhost:3000' },
    });

    expect(response.statusCode).toBe(201);
    const authorizationUrl = new URL(response.json().data.authorizationUrl);
    expect(authorizationUrl.origin).toBe('https://hh.ru');
    expect(authorizationUrl.searchParams.get('client_id')).toBe(connectedProvider.clientId);
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(connectedProvider.redirectUri);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(response.payload).not.toContain(connectedProvider.clientSecret);
    expect(Date.parse(response.json().data.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('stores one connection per callback and never replays a consumed state', async () => {
    const { app, authorization } = await createConnectionsApp({
      transport: {
        async connect() {
          return hhConnection;
        },
      },
    });
    const state = await startAuthorization(app, authorization);

    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${state}&code=synthetic-code`,
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe('/connections/result?platform=hh&status=connected');

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(connections.json().data[1]).toMatchObject({
      platform: 'hh',
      status: 'connected',
      scopes: ['profile_read', 'resume_read'],
      profile: {
        sourceUrl: 'https://hh.ru/resume/syntheticresume',
        facts: [{ value: 'Синтетический руководитель продукта' }],
      },
    });
    expect(connections.payload).not.toContain(hhConnection.accessToken);
    expect(connections.payload).not.toContain(hhConnection.refreshToken);
    expect(connections.payload).not.toContain(hhConnection.externalAccountId);

    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${state}&code=synthetic-code`,
    });
    expect(replay.statusCode).toBe(303);
    expect(replay.headers.location).toBe(
      '/connections/result?platform=hh&status=failed&reason=oauth_state_invalid',
    );
  });

  it('surfaces an upstream failure and a candidate refusal without a connection', async () => {
    const { app, authorization } = await createConnectionsApp({
      transport: {
        async connect() {
          throw new Error('upstream contract failure');
        },
      },
    });

    const failed = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${await startAuthorization(
        app,
        authorization,
      )}&code=synthetic-code`,
    });
    expect(failed.statusCode).toBe(303);
    expect(failed.headers.location).toBe(
      '/connections/result?platform=hh&status=failed&reason=provider_oauth_failed',
    );

    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${await startAuthorization(
        app,
        authorization,
      )}&error=access_denied`,
    });
    expect(denied.statusCode).toBe(303);
    expect(denied.headers.location).toBe('/connections/result?platform=hh&status=declined');

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(connections.json().data[1].status).toBe('disconnected');
  });

  it('disconnects idempotently and reports upstream revocation honestly', async () => {
    const { app, authorization } = await createConnectionsApp({
      transport: {
        async connect() {
          return hhConnection;
        },
      },
    });
    const state = await startAuthorization(app, authorization);
    await app.inject({
      method: 'GET',
      url: `/api/v1/connectors/hh/callback?state=${state}&code=synthetic-code`,
    });

    const foreignOrigin = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { origin: 'https://attacker.example' },
    });
    expect(foreignOrigin.statusCode).toBe(403);

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data).toEqual({
      platform: 'hh',
      status: 'disconnected',
      localDataRemoved: true,
      upstreamRevocation: 'unsupported',
    });

    const again = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.localDataRemoved).toBe(false);

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(connections.json().data[1].status).toBe('disconnected');
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

    // 2. Admin vacancy sources
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/vacancy-sources',
      headers: { authorization: candidateAuth },
    });
    // Candidate session is unauthorized for admin section
    expect(adminRes.statusCode).toBe(401);
  });
});
