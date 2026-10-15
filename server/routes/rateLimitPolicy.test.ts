import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, expect, it } from 'vitest';
import { governRateLimit, installRateLimitPolicy, READ_RATE_LIMIT } from './rateLimitPolicy';

const key = () => 'k';

describe('governRateLimit', () => {
  it('turns an hourly GET cap into the per-minute read cap keyed per session', () => {
    const governed = governRateLimit(
      'GET',
      '/api/v1/candidate/companies',
      {
        max: 120,
        timeWindow: '1 hour',
      },
      key,
    );
    expect(governed).toMatchObject({ ...READ_RATE_LIMIT, keyGenerator: key });
  });

  it('keeps a deliberately tight short-window read (file download) and only rekeys it', () => {
    const governed = governRateLimit(
      'GET',
      '/api/v1/candidate/documents/x/download',
      {
        max: 30,
        timeWindow: '1 minute',
      },
      key,
    );
    expect(governed).toMatchObject({ max: 30, timeWindow: '1 minute', keyGenerator: key });
  });

  it('keeps the strict cap of a write but keys it per session', () => {
    const governed = governRateLimit(
      'POST',
      '/api/v1/candidate/campaign/roles/rebuild',
      {
        max: 5,
        timeWindow: '1 hour',
      },
      key,
    );
    expect(governed).toMatchObject({ max: 5, timeWindow: '1 hour', keyGenerator: key });
  });

  it('leaves login, registration and admin limiters on the IP key', () => {
    for (const url of ['/api/v1/auth/login', '/api/v1/candidates', '/api/v1/admin/x']) {
      const original = { max: 5, timeWindow: '15 minutes' };
      expect(governRateLimit('POST', url, original, key)).toBe(original);
    }
  });

  it('does not add a limit to a route that had none, and keeps a custom key', () => {
    expect(governRateLimit('GET', '/api/v1/candidate/x', undefined, key)).toBeUndefined();
    const own = { max: 3, timeWindow: '30 minutes', keyGenerator: () => 'own' };
    expect(governRateLimit('POST', '/api/v1/candidate/x', own, key)).toBe(own);
  });

  it('treats a route answering both GET and POST as a write', () => {
    const governed = governRateLimit(
      ['GET', 'POST'],
      '/api/v1/candidate/x',
      {
        max: 7,
        timeWindow: '1 hour',
      },
      key,
    );
    expect(governed).toMatchObject({ max: 7, timeWindow: '1 hour' });
  });
});

describe('installRateLimitPolicy', () => {
  async function build() {
    const app = Fastify();
    installRateLimitPolicy(app, {
      tokenOf: (request) => String(request.headers.authorization ?? ''),
      read: { max: 2, timeWindow: '1 minute' },
    });
    await app.register(rateLimit, { global: false, keyGenerator: (request) => request.ip });
    app.get(
      '/api/v1/candidate/companies',
      { config: { rateLimit: { max: 1, timeWindow: '1 hour' } } },
      async () => ({ ok: true }),
    );
    app.post(
      '/api/v1/candidate/campaign',
      { config: { rateLimit: { max: 1, timeWindow: '1 hour' } } },
      async () => ({ ok: true }),
    );
    app.post(
      '/api/v1/auth/login',
      { config: { rateLimit: { max: 1, timeWindow: '15 minutes' } } },
      async () => ({ ok: true }),
    );
    await app.ready();
    return app;
  }

  const get = (app: Awaited<ReturnType<typeof build>>, token: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/candidate/companies',
      headers: { authorization: token },
    });

  it('gives each session its own read bucket on one IP and the read cap, not the hourly one', async () => {
    const app = await build();
    expect([(await get(app, 'a')).statusCode, (await get(app, 'a')).statusCode]).toEqual([
      200, 200,
    ]);
    expect((await get(app, 'a')).statusCode).toBe(429);
    expect((await get(app, 'b')).statusCode).toBe(200);
  });

  it('still caps writes by their own limit per session', async () => {
    const app = await build();
    const post = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/candidate/campaign',
        headers: { authorization: token },
      });
    expect((await post('a')).statusCode).toBe(200);
    expect((await post('a')).statusCode).toBe(429);
    expect((await post('b')).statusCode).toBe(200);
  });

  it('keeps login on the shared IP bucket regardless of the token', async () => {
    const app = await build();
    const login = (token: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { authorization: token } });
    expect((await login('a')).statusCode).toBe(200);
    expect((await login('b')).statusCode).toBe(429);
  });
});
