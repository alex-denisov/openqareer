import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { CandidateOAuthService } from './oauthConnector';

const stores: SqliteCandidateStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
});

function createStore() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: Buffer.alloc(32, 6),
  });
  stores.push(store);
  return store;
}

describe('candidate OAuth connector', () => {
  it('starts an hh.ru authorization with state and PKCE bound to the candidate', () => {
    const store = createStore();
    const candidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const secrets = [Buffer.alloc(32, 1), Buffer.alloc(48, 2)];
    const service = new CandidateOAuthService({
      store,
      providers: {
        hh: {
          clientId: 'hh-client-id',
          clientSecret: 'hh-client-secret-for-tests',
          redirectUri:
            'https://openqareer.com/api/v1/connectors/hh/callback',
        },
      },
      now: () => new Date('2026-08-10T12:00:00.000Z'),
      randomBytes: () => secrets.shift()!,
    });

    const started = service.startAuthorization(candidate.id, 'hh');
    const authorizationUrl = new URL(started.authorizationUrl);
    const state = authorizationUrl.searchParams.get('state')!;
    const verifier = Buffer.alloc(48, 2).toString('base64url');

    expect(started).toMatchObject({
      platform: 'hh',
      expiresAt: '2026-08-10T12:10:00.000Z',
    });
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://hh.ru/oauth/authorize',
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'hh-client-id',
      redirect_uri:
        'https://openqareer.com/api/v1/connectors/hh/callback',
      state,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256')
        .update(verifier)
        .digest('base64url'),
      role: 'applicant',
      force_role: 'true',
    });
    expect(
      store.consumeOAuthAuthorization(
        'hh',
        createHash('sha256').update(state).digest('hex'),
        '2026-08-10T12:05:00.000Z',
      ),
    ).toEqual({ candidateId: candidate.id, codeVerifier: verifier });
  });

  it('reports a fixed capability catalog without exposing stored tokens', () => {
    const store = createStore();
    const candidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    store.saveOAuthConnection(candidate.id, {
      platform: 'hh',
      externalAccountId: 'synthetic-account',
      scopes: ['profile_read', 'resume_read'],
      capabilities: ['profile_read', 'resume_read'],
      accessToken: 'must-not-leave-server',
      refreshToken: 'must-not-leave-server-either',
      accessTokenExpiresAt: '2026-08-24T12:00:00.000Z',
      profile: {
        capturedAt: '2026-08-10T12:00:00.000Z',
        sourceUrl: 'https://hh.ru/resume/synthetic',
        facts: [],
      },
    });
    const service = new CandidateOAuthService({
      store,
      providers: {
        hh: {
          clientId: 'hh-client-id',
          clientSecret: 'hh-client-secret-for-tests',
          redirectUri:
            'https://openqareer.com/api/v1/connectors/hh/callback',
        },
      },
    });

    const catalog = service.listConnections(candidate.id);

    expect(catalog).toEqual([
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
        status: 'connected',
        capabilities: ['profile_read', 'resume_read'],
        importsCareerHistory: true,
        scopes: ['profile_read', 'resume_read'],
        accessTokenExpiresAt: '2026-08-24T12:00:00.000Z',
        connectedAt: expect.any(String),
        profile: {
          capturedAt: '2026-08-10T12:00:00.000Z',
          sourceUrl: 'https://hh.ru/resume/synthetic',
          facts: [],
        },
      },
    ]);
    expect(JSON.stringify(catalog)).not.toContain('must-not-leave-server');
    expect(JSON.stringify(catalog)).not.toContain('synthetic-account');
  });

  it('consumes the callback once and persists only the transport result', async () => {
    const store = createStore();
    const candidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const connectedProfile = {
      platform: 'hh' as const,
      externalAccountId: 'synthetic-hh-id',
      scopes: ['profile_read', 'resume_read'],
      capabilities: ['profile_read', 'resume_read'] as const,
      accessToken: 'synthetic-access',
      refreshToken: 'synthetic-refresh',
      accessTokenExpiresAt: '2026-08-24T12:00:00.000Z',
      profile: {
        capturedAt: '2026-08-10T12:01:00.000Z',
        sourceUrl: 'https://hh.ru/resume/synthetic',
        facts: [
          {
            kind: 'headline' as const,
            value: 'Synthetic Product Lead',
            sourceLocator: 'hh:resume:synthetic:title',
            confidence: 'official-api' as const,
          },
        ],
      },
    };
    const service = new CandidateOAuthService({
      store,
      providers: {
        hh: {
          clientId: 'hh-client-id',
          clientSecret: 'hh-client-secret-for-tests',
          redirectUri:
            'https://openqareer.com/api/v1/connectors/hh/callback',
        },
      },
      now: () => new Date('2026-08-10T12:00:00.000Z'),
      randomBytes: (size) => Buffer.alloc(size, size),
      transport: {
        async connect(input) {
          expect(input).toMatchObject({
            platform: 'hh',
            code: 'synthetic-authorization-code',
            codeVerifier: Buffer.alloc(48, 48).toString('base64url'),
          });
          return connectedProfile;
        },
      },
    });
    const started = service.startAuthorization(candidate.id, 'hh');
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;

    await expect(
      service.completeAuthorization('hh', {
        state,
        code: 'synthetic-authorization-code',
      }),
    ).resolves.toMatchObject({
      platform: 'hh',
      status: 'connected',
      profile: connectedProfile.profile,
    });
    await expect(
      service.completeAuthorization('hh', {
        state,
        code: 'synthetic-authorization-code',
      }),
    ).rejects.toMatchObject({ code: 'oauth_state_invalid', statusCode: 409 });
    expect(store.getOAuthConnection(candidate.id, 'hh')).toMatchObject(
      connectedProfile,
    );
  });
});
