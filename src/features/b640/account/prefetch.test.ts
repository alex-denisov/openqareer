import { describe, expect, it, vi } from 'vitest';
import { prefetch } from './prefetch';

describe('prefetch', () => {
  it('начатое заранее чтение отдаётся первому, следующее читается заново', async () => {
    const fetcher = vi.fn(async () => fetcher.mock.calls.length);
    const read = prefetch(fetcher);
    read.start();
    read.start();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(read.read()).resolves.toBe(1);
    await expect(read.read()).resolves.toBe(2);
  });

  it('невостребованное забывается; ошибка достаётся тому, кто взял', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok');
    const read = prefetch(fetcher);
    read.start();
    await expect(read.read()).rejects.toThrow('offline');
    read.start();
    read.drop();
    await expect(read.read()).resolves.toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
