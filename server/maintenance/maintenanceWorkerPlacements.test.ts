import { describe, expect, it, vi } from 'vitest';
import type { CareersPruneTicker } from '../companyDirectory/siteDiscovery/careersPrune';
import { MaintenanceWorker, type MaintenanceLog } from './maintenanceWorker';

function silentLog(): MaintenanceLog {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

describe('MaintenanceWorker placement & replan integration', () => {
  it('F3+F4: runPlacementStep replans companies whose careers_url was dropped by CareersPrune', () => {
    const replanCompany = vi.fn(() => true);
    const engine = {
      replanCompany,
    } as unknown as ConstructorParameters<typeof MaintenanceWorker>[0]['engine'];
    const careersPrune = {
      tick: () => ({
        done: true,
        processed: 2,
        dropped: 1,
        droppedTotal: 1,
        ms: 1,
        droppedCompanies: [{ companyKey: 'acme', sourceId: 'src-company-site-acme' }],
      }),
    } as unknown as CareersPruneTicker;
    const worker = new MaintenanceWorker({ engine, log: silentLog(), careersPrune });

    worker.runPlacementStep();
    expect(replanCompany).toHaveBeenCalledWith('acme');
  });
});
