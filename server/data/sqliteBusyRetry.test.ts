import { describe, expect, it, vi } from 'vitest';
import { isSqliteBusy, retryOnSqliteBusy } from './sqliteBusyRetry';

const busy = () => Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
const noWait = { delaysMs: [0, 0] };

describe('retryOnSqliteBusy', () => {
  it('returns the answer of the first free attempt', async () => {
    const work = vi.fn().mockImplementationOnce(() => { throw busy(); }).mockReturnValue('ok');
    await expect(retryOnSqliteBusy(work, noWait)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('awaits asynchronous work and retries its rejection', async () => {
    const work = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValue('ok');
    await expect(retryOnSqliteBusy(work, noWait)).resolves.toBe('ok');
  });

  it('gives the last error back after the last attempt', async () => {
    const work = vi.fn(() => { throw busy(); });
    await expect(retryOnSqliteBusy(work, noWait)).rejects.toSatisfy(isSqliteBusy);
    expect(work).toHaveBeenCalledTimes(3);
  });

  it('never repeats another error', async () => {
    const work = vi.fn(() => { throw new Error('no such table'); });
    await expect(retryOnSqliteBusy(work, noWait)).rejects.toThrow('no such table');
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe('isSqliteBusy', () => {
  it('knows the lock and nothing else', () => {
    expect(isSqliteBusy(busy())).toBe(true);
    expect(isSqliteBusy(Object.assign(new Error('boom'), { code: 'ERR_SQLITE_ERROR', errcode: 1 }))).toBe(false);
    expect(isSqliteBusy('database is locked')).toBe(false);
  });
});
