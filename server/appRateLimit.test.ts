import { describe, expect, it } from 'vitest';
import { createApp } from './appTestHarness';

describe('API rate limits on the real route set', () => {
  it('lets a client page through the companies list far past the old 120-per-hour cap', async () => {
    const app = await createApp();
    const statuses = new Set<number>();
    for (let index = 0; index < 130; index += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/companies',
        headers: { authorization: 'Bearer reader-one' },
      });
      statuses.add(response.statusCode);
    }
    expect(statuses.has(429)).toBe(false);
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
