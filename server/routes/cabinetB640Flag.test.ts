import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import type { ServerConfig } from '../config';
import {
  cabinetB640Enabled,
  cabinetB640Features,
  requireCabinetB640,
} from './cabinetB640Flag';

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

function principal(username: string): AuthPrincipal {
  return {
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: null,
  };
}

function flagConfig(usernames?: readonly string[]): ServerConfig {
  return {
    secureCookies: false,
    allowedOrigins: ['http://localhost:3000'],
    ...(usernames ? { cabinetB640Usernames: usernames } : {}),
  } as ServerConfig;
}

/** Пробный маршрут волны 3: существует только в этом тесте. */
async function probeApp(usernames?: readonly string[]) {
  const config = flagConfig(usernames);
  const sessions = new Map([
    ['token-flagged', principal('flagged.test')],
    ['token-plain', principal('plain.test')],
    ['token-unverified', { ...principal('unverified.test'), emailVerified: false }],
  ]);
  const authService = {
    authenticate: (token: string) => sessions.get(token) ?? null,
  } as unknown as SessionAuth;
  const app = Fastify();
  await app.register(cookie);
  app.get('/api/v1/b640/probe', async (request, reply) => {
    const allowed = requireCabinetB640(request, reply, { authService, config });
    if (!allowed) return reply;
    return { data: { username: allowed.username } };
  });
  app.post('/api/v1/b640/probe', async (request, reply) => {
    const allowed = requireCabinetB640(request, reply, { authService, config });
    if (!allowed) return reply;
    return { data: { saved: true } };
  });
  apps.push(app);
  return app;
}

function probe(app: Awaited<ReturnType<typeof probeApp>>, token?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/b640/probe',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('cabinetB640Enabled', () => {
  it('is off for everyone when the list is empty or missing', () => {
    expect(cabinetB640Enabled(flagConfig(), 'flagged.test')).toBe(false);
    expect(cabinetB640Enabled(flagConfig([]), 'flagged.test')).toBe(false);
  });

  it('is on only for listed sign-in names, ignoring case and spaces', () => {
    const config = flagConfig(['flagged.test']);
    expect(cabinetB640Enabled(config, 'flagged.test')).toBe(true);
    expect(cabinetB640Enabled(config, ' Flagged.Test ')).toBe(true);
    expect(cabinetB640Enabled(config, 'plain.test')).toBe(false);
    expect(cabinetB640Enabled(config, 'flagged.test.other')).toBe(false);
    expect(cabinetB640Enabled(config, '')).toBe(false);
    expect(cabinetB640Enabled(config, null)).toBe(false);
  });

  it('is on for everyone with the wildcard', () => {
    const config = flagConfig(['*']);
    expect(cabinetB640Enabled(config, 'plain.test')).toBe(true);
    expect(cabinetB640Enabled(config, null)).toBe(false);
  });

  it('never treats a sign-in name as a wildcard', () => {
    expect(cabinetB640Enabled(flagConfig(['flagged.test']), '*')).toBe(false);
  });

  it('builds the public features object', () => {
    const config = flagConfig(['flagged.test']);
    expect(cabinetB640Features(config, principal('flagged.test'))).toEqual({ cabinetB640: true, interviewRecording: false });
    expect(cabinetB640Features(config, principal('plain.test'))).toEqual({ cabinetB640: false, interviewRecording: false });
    const recording = { ...config, interviewRecordingEnabled: true };
    expect(cabinetB640Features(recording, principal('flagged.test')).interviewRecording).toBe(true);
  });
});

describe('requireCabinetB640 on a probe route', () => {
  it('answers 404 without the flag, exactly as an unknown route does', async () => {
    const app = await probeApp(['flagged.test']);
    const plain = await probe(app, 'token-plain');
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/b640/missing',
      headers: { authorization: 'Bearer token-plain' },
    });
    expect(plain.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(plain.body.replace('/probe', '/missing')).toBe(unknown.body);
    expect(plain.body).not.toMatch(/flag|флаг|cabinet/iu);
  });

  it('answers 404 without a session', async () => {
    const app = await probeApp(['flagged.test']);
    expect((await probe(app)).statusCode).toBe(404);
    expect((await probe(app, 'token-unknown')).statusCode).toBe(404);
  });

  it('answers 404 for everyone while the list is empty', async () => {
    const app = await probeApp();
    expect((await probe(app, 'token-flagged')).statusCode).toBe(404);
  });

  it('lets a flagged account through', async () => {
    const app = await probeApp(['flagged.test']);
    const flagged = await probe(app, 'token-flagged');
    expect(flagged.statusCode).toBe(200);
    expect(flagged.json().data.username).toBe('flagged.test');
  });

  it('lets every signed-in account through with the wildcard', async () => {
    const app = await probeApp(['*']);
    expect((await probe(app, 'token-plain')).statusCode).toBe(200);
    expect((await probe(app)).statusCode).toBe(404);
  });

  it('asks a flagged account with an unconfirmed email to confirm it first', async () => {
    const app = await probeApp(['*']);
    const unverified = await probe(app, 'token-unverified');
    expect(unverified.statusCode).toBe(403);
    expect(unverified.json().error.code).toBe('email_unverified');
  });

  it('rejects a cookie mutation from a foreign page, and only for flagged accounts', async () => {
    const app = await probeApp(['flagged.test']);
    const post = (token: string, origin?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/b640/probe',
        headers: { cookie: `openqareer_session=${token}`, ...(origin ? { origin } : {}) },
      });

    expect((await post('token-flagged', 'http://localhost:3000')).statusCode).toBe(200);
    const foreign = await post('token-flagged', 'https://evil.example');
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('origin_not_allowed');
    expect((await post('token-flagged')).statusCode).toBe(403);
    expect((await post('token-plain', 'https://evil.example')).statusCode).toBe(404);
  });
});
