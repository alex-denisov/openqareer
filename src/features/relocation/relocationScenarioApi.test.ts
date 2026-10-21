// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { deleteRelocationScenario } from './relocationScenarioApi';
afterEach(() => vi.unstubAllGlobals());
it('does not report a rejected deletion as successful', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'storage_unavailable',
              message: 'Не удалось удалить расчёт.',
              retryable: true,
              requestId: 'synthetic',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
  );
  await expect(deleteRelocationScenario('synthetic')).rejects.toThrow();
});
it('accepts a successful empty204 without parsing JSON', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  await expect(deleteRelocationScenario('synthetic')).resolves.toBeUndefined();
});
