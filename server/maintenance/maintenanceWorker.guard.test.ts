import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceWorker } from './maintenanceWorker';

/**
 * B756 22.11: два выхода с exit 1 за вечер от «database is locked». Любой такт обслуживания —
 * синхронный бросок или отказ обещания — не роняет процесс: строка в журнал, следующий такт идёт.
 */
describe('MaintenanceWorker: такт с ошибкой не роняет процесс (B756)', () => {
  afterEach(() => vi.useRealTimers());

  it('отказ волны и синхронный бросок такта — строкой журнала, без необработанных ошибок', async () => {
    vi.useFakeTimers();
    const locked = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR' });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const engine = {
      clusterKeysReady: true,
      poolSize: 0,
      getRequestedSourceSyncs: () => {
        throw locked;
      },
      syncDue: () => Promise.resolve([]),
      refreshCatalogTotals: () => Promise.resolve({ clusters: 0 }),
      getCatalogTotals: () => {
        throw locked;
      },
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const worker = new MaintenanceWorker({ engine: engine as never, log });
    try {
      expect(() => worker.start()).not.toThrow();
      await vi.advanceTimersByTimeAsync(130_000);
      expect(unhandled).toEqual([]);
      const failed = log.error.mock.calls.filter(
        ([, message]) => message === 'maintenance-step-failed',
      );
      expect(failed.map(([fields]) => fields.step)).toEqual(
        expect.arrayContaining(['runManualSyncWave', 'refreshCatalogTotals']),
      );
      expect(JSON.stringify(failed)).not.toContain('stack');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await worker.stop();
    }
  });
});
