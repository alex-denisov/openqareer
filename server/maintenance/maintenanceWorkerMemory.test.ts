import { describe, expect, it, vi } from 'vitest';
import { MaintenanceWorker } from './maintenanceWorker';

describe('maintenance memory line', () => {
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
});
