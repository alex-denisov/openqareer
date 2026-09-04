import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../coach/apiClient';
import { readReleaseSha } from './releaseSha';

vi.mock('../coach/apiClient', () => ({ apiFetch: vi.fn() }));

const mocked = vi.mocked(apiFetch);

afterEach(() => {
  mocked.mockReset();
});

describe('B159 — чтение SHA продакшена', () => {
  it('возвращает SHA, который отдал /health', async () => {
    mocked.mockResolvedValue(
      new Response('89c3824d707d4eac002eb5779af62237ebea67e5', { status: 200 }),
    );

    await expect(readReleaseSha()).resolves.toBe('89c3824d707d4eac002eb5779af62237ebea67e5');
    expect(mocked).toHaveBeenCalledWith('/health', expect.anything());
  });

  it('возвращает null, когда продакшен ответил отказом', async () => {
    mocked.mockResolvedValue(new Response('nope', { status: 502 }));
    await expect(readReleaseSha()).resolves.toBeNull();
  });

  it('возвращает null, когда продакшен ответил пустотой', async () => {
    mocked.mockResolvedValue(new Response('   ', { status: 200 }));
    await expect(readReleaseSha()).resolves.toBeNull();
  });

  it('возвращает null, когда запрос не дошёл', async () => {
    mocked.mockRejectedValue(new Error('offline'));
    await expect(readReleaseSha()).resolves.toBeNull();
  });
});
