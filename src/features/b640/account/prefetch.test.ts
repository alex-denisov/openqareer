import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefetch } from './prefetch';

afterEach(() => {
  vi.useRealTimers();
});

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

  it('B773: сбой раннего чтения читается заново один раз; второй сбой достаётся тому, кто взял', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('до сессии'))
      .mockResolvedValueOnce('ok')
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    const read = prefetch(fetcher);
    read.start();
    await expect(read.read()).resolves.toBe('ok');
    read.start();
    await expect(read.read()).rejects.toThrow('offline');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('невостребованное забывается; старше 30 с — не берётся', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => fetcher.mock.calls.length);
    const read = prefetch(fetcher);
    read.start();
    read.drop();
    await expect(read.read()).resolves.toBe(2);
    read.start();
    vi.advanceTimersByTime(31_000);
    await expect(read.read()).resolves.toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
