import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEarlyReads, readEarlyOr, startEarlyRead } from './earlyRead';
import { bindSectionCacheOwner, clearSectionCache, dropSectionCache } from './sectionCache';

const signal = new AbortController().signal;
afterEach(() => {
  vi.useRealTimers();
  clearSectionCache();
});

describe('B792: раннее чтение', () => {
  it('начатое забирают один раз, дальше — свежее', async () => {
    const reader = vi.fn().mockResolvedValueOnce('раннее').mockResolvedValue('свежее');
    startEarlyRead(reader);
    expect(await readEarlyOr(reader, signal)).toBe('раннее');
    expect(await readEarlyOr(reader, signal)).toBe('свежее');
    expect(reader).toHaveBeenCalledTimes(2);
  });
  it('сорвалось или устарело — читаем заново', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('401')).mockResolvedValue('ок');
    startEarlyRead(failing);
    expect(await readEarlyOr(failing, signal)).toBe('ок');
    vi.useFakeTimers();
    const old = vi.fn().mockResolvedValueOnce('старое').mockResolvedValue('новое');
    startEarlyRead(old);
    vi.advanceTimersByTime(30_000);
    expect(await readEarlyOr(old, signal)).toBe('новое');
  });
  it('первый вошедший забирает начатое; другому, после выхода и после правки — нет', async () => {
    const start = () => {
      const reader = vi.fn().mockResolvedValueOnce('раннее').mockResolvedValue('своё');
      startEarlyRead(reader);
      return reader;
    };
    const first = start();
    bindSectionCacheOwner('a');
    expect(await readEarlyOr(first, signal)).toBe('раннее');
    const other = start();
    bindSectionCacheOwner('b');
    expect(await readEarlyOr(other, signal)).toBe('своё');
    for (const drop of [clearSectionCache, () => dropSectionCache('k'), clearEarlyReads]) {
      const reader = start();
      drop();
      expect(await readEarlyOr(reader, signal)).toBe('своё');
    }
  });
});
