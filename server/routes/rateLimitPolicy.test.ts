import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, expect, it } from 'vitest';
import { governRateLimit, installRateLimitPolicy } from './rateLimitPolicy';

const signedIn = () => true;

describe('governRateLimit', () => {
  it('keeps the limit of a candidate route and lets a signed-in session through it', () => {
    const governed = governRateLimit(
      '/api/v1/candidate/companies',
      { max: 5, timeWindow: '1 hour' },
      signedIn,
    );
    expect(governed).toMatchObject({
      max: 5,
      timeWindow: '1 hour',
      allowList: expect.any(Function),
    });
  });

  it('leaves login, registration and admin limiters untouched', () => {
    for (const url of ['/api/v1/auth/login', '/api/v1/candidates', '/api/v1/admin/x']) {
      const original = { max: 5, timeWindow: '15 minutes' };
      expect(governRateLimit(url, original, signedIn)).toBe(original);
    }
  });

  it('does not add a limit to a route that had none', () => {
    expect(governRateLimit('/api/v1/candidate/x', undefined, signedIn)).toBeUndefined();
  });
});

describe('installRateLimitPolicy', () => {
  async function build() {
    const app = Fastify();
    installRateLimitPolicy(app, {
      isSignedIn: (request) => request.headers.authorization === 'valid',
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

  const call = (
    app: Awaited<ReturnType<typeof build>>,
    method: 'GET' | 'POST',
    url: string,
    token: string,
  ) => app.inject({ method, url, headers: { authorization: token } });

  it('never limits reads or writes of a signed-in session', async () => {
    const app = await build();
    for (const [method, url] of [
      ['GET', '/api/v1/candidate/companies'],
      ['POST', '/api/v1/candidate/campaign'],
    ] as const) {
      const codes = [];
      for (let i = 0; i < 5; i += 1) codes.push((await call(app, method, url, 'valid')).statusCode);
      expect(codes).toEqual([200, 200, 200, 200, 200]);
    }
  });

  it('keeps the route limit for a request without a valid session', async () => {
    const app = await build();
    expect((await call(app, 'GET', '/api/v1/candidate/companies', 'forged')).statusCode).toBe(200);
    expect((await call(app, 'GET', '/api/v1/candidate/companies', 'forged')).statusCode).toBe(429);
  });

  it('keeps login on the IP limit even for a signed-in session', async () => {
    const app = await build();
    expect((await call(app, 'POST', '/api/v1/auth/login', 'valid')).statusCode).toBe(200);
    expect((await call(app, 'POST', '/api/v1/auth/login', 'valid')).statusCode).toBe(429);
  });
});
