import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, login } from './testHelpers/vacancyPitchHarness';

const origin = 'http://localhost:3000';
afterEach(() => vi.restoreAllMocks());

describe('deleting an account (04.11)', () => {
  it('takes the candidate off the hh text queue', async () => {
    const { app, poolStore } = await createApp([]);
    const { cookie, candidateId } = await login(app);
    const forget = vi.fn();
    Object.assign(poolStore, { forgetHhTextRoleTarget: forget });
    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/candidate/me', headers: { cookie, origin } });
    expect(deleted.statusCode).toBe(204);
    expect(forget).toHaveBeenCalledWith(candidateId);
  });
});
