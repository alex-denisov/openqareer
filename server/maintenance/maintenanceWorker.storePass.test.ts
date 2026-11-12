import { describe, expect, it } from 'vitest';
import { MaintenanceWorker, type MaintenanceLog } from './maintenanceWorker';

function silentLog(): MaintenanceLog & { entries: Array<{ level: string; msg: string }> } {
  const entries: Array<{ level: string; msg: string }> = [];
  const push = (level: string) => (_: unknown, msg: string) => {
    entries.push({ level, msg });
  };
  return { entries, info: push('info'), warn: push('warn'), error: push('error') };
}

describe('MaintenanceWorker · чистка после готовности (B649-2)', () => {
  it('объявляет готовность до чистки и дочитывания, а их проводит после (B649-2)', async () => {
    const calls: string[] = [];
    let restoreOptions: unknown;
    const log = silentLog();
    const engine = {
      getSources: () => [{ id: 'src' }],
      restoreAsync: async (_now?: number, _chunk?: number, options?: unknown) => {
        restoreOptions = options;
        calls.push('restore');
        return { restored: 1 };
      },
      maintainStoreAsync: async (_now?: number, shouldStop?: () => boolean) => {
        calls.push(`store:${String(shouldStop?.())}`);
        return { backfillWindows: 3 };
      },
      runClusterKeysBackfillStep: () => 0,
      clusterKeysReady: true,
      poolSize: 1,
    } as unknown as ConstructorParameters<typeof MaintenanceWorker>[0]['engine'];
    const worker = new MaintenanceWorker({ engine, log });
    await worker.restore();
    expect(restoreOptions).toEqual({ prune: false, backfill: false });
    expect(calls).toEqual(['restore', 'store:false']);
    const messages = log.entries.map((entry) => entry.msg);
    expect(messages.indexOf('maintenance-restored')).toBeLessThan(
      messages.indexOf('maintenance-store-pass'),
    );
  });

  it('сбой чистки после готовности не роняет обслуживание (B649-2)', async () => {
    const log = silentLog();
    const engine = {
      getSources: () => [{ id: 'src' }],
      restoreAsync: async () => ({ restored: 1 }),
      maintainStoreAsync: async () => {
        throw new Error('disk');
      },
      runClusterKeysBackfillStep: () => 0,
      clusterKeysReady: true,
      poolSize: 1,
    } as unknown as ConstructorParameters<typeof MaintenanceWorker>[0]['engine'];
    const worker = new MaintenanceWorker({ engine, log });
    await expect(worker.restore()).resolves.toEqual({ restored: 1 });
    expect(log.entries.some((entry) => entry.msg === 'maintenance-store-pass-failed')).toBe(true);
  });
});
