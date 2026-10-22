import { describe, expect, it } from 'vitest';
import { candidateAuthorization, createApp } from './appTestHarness';

describe('API rate limits on the real route set', () => {
  const companies = (app: Awaited<ReturnType<typeof createApp>>, authorization: string) =>
    app.inject({ method: 'GET', url: '/api/v1/candidate/companies', headers: { authorization } });

  it('never limits a signed-in candidate, even far past the route cap', async () => {
    const app = await createApp();
    const statuses = new Set<number>();
    for (let index = 0; index < 130; index += 1) {
      statuses.add((await companies(app, candidateAuthorization(app))).statusCode);
    }
    expect(statuses.has(429)).toBe(false);
    await app.close();
  });

  it('keeps the route cap for a forged token', async () => {
    const app = await createApp();
    const statuses = new Set<number>();
    for (let index = 0; index < 130; index += 1) {
      statuses.add((await companies(app, 'Bearer forged')).statusCode);
    }
    expect(statuses.has(429)).toBe(true);
    await app.close();
  });

  it('keeps login on the shared per-IP bucket whatever token is sent', async () => {
    const app = await createApp();
    const attempt = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { authorization: `Bearer ${token}` },
        payload: { identifier: 'nobody', password: 'wrong' },
      });
    const codes: number[] = [];
    for (let index = 0; index < 8; index += 1) codes.push((await attempt(`t${index}`)).statusCode);
    expect(codes).toContain(429);
    await app.close();
  });
});
