import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { expect, it } from 'vitest';
import { registerBulkLlmSpendRoutes } from './bulkLlmSpendRoutes';
import type { RouteDeps } from './deps';
it('admin HTTP status denies anonymous/candidate and exposes only safe spend metadata', async () => {
  const app = Fastify();
  await app.register(cookie);
  const deps = {
    config: { secureCookies: false },
    authService: {
      authenticate: (token: string) =>
        token ? { role: token === 'admin' ? 'admin' : 'candidate' } : null,
    },
    bulkLlmRuntime: {
      status: () => ({
        enabled: false,
        spentUsd: 0.03,
        heldUsd: 0.06,
        remainingUsd: 0.01,
        events: [{ kind: 'budget_exceeded' }],
      }),
    },
  } as unknown as RouteDeps;
  await registerBulkLlmSpendRoutes(app, deps);
  expect((await app.inject('/api/admin/llm-spend')).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: '/api/admin/llm-spend',
        headers: { authorization: 'Bearer candidate' },
      })
    ).statusCode,
  ).toBe(403);
  const response = await app.inject({
    url: '/api/admin/llm-spend',
    headers: { authorization: 'Bearer admin' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toMatchObject({ spentUsd: 0.03, heldUsd: 0.06, remainingUsd: 0.01 });
  expect(response.body).not.toContain('secret');
  await app.close();
});
