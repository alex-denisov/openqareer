import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceWorker } from './maintenanceWorker';

describe('maintenance memory line', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('counts the pool for the memory line off the event loop (B649-4: up to 2.9 s per report)', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const engine = {
      get poolSize(): number {
        throw new Error('sync count on the loop');
      },
      poolSizeInWorker: () => Promise.resolve(1_151_297),
    };
    const worker = new MaintenanceWorker({ engine: engine as never, log });
    await worker.reportMemory();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ poolSize: 1_151_297 }),
      'maintenance-memory',
    );
  });

  it('includes db and disk headroom in maintenance-memory when databasePath is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oq-worker-disk-'));
    dirs.push(dir);
    const dbPath = join(dir, 'openqareer.db');
    writeFileSync(dbPath, Buffer.alloc(1024 * 1024, 1));
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const engine = { poolSize: 10 };
    const worker = new MaintenanceWorker({ engine: engine as never, log, databasePath: dbPath });
    await worker.reportMemory();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        poolSize: 10,
        dbSizeMb: 1,
        walSizeMb: 0,
        diskFreeMb: expect.any(Number),
        diskFreePct: expect.any(Number),
      }),
      'maintenance-memory',
    );
  });
});
