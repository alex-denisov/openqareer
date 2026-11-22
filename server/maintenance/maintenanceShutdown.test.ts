import { describe, expect, it } from 'vitest';
import { shutdownMaintenance, type MaintenanceShutdownDeps } from './maintenanceShutdown';

function deps(overrides: Partial<MaintenanceShutdownDeps> = {}) {
  const calls: string[] = [];
  const exits: number[] = [];
  const base: MaintenanceShutdownDeps = {
    abortCollection: () => calls.push('abort'),
    stopTimers: () => calls.push('timers'),
    stopWorker: async () => {
      calls.push('stop');
      return { waveFinished: true };
    },
    startup: undefined,
    closeStores: () => calls.push('close'),
    log: {
      info: (_: unknown, msg: string) => calls.push(`info:${msg}`),
      error: (_: unknown, msg: string) => calls.push(`error:${msg}`),
    },
    exit: (code: number) => {
      exits.push(code);
    },
  };
  return { calls, exits, deps: { ...base, ...overrides } };
}

describe('остановка обслуживания (B759)', () => {
  it('сначала отменяет сбор и останавливает волны, потом закрывает базы; код 0', async () => {
    const { calls, exits, deps: d } = deps();
    await shutdownMaintenance('SIGTERM', d);
    expect(calls).toEqual([
      'timers',
      'info:maintenance-shutdown-started',
      'abort',
      'stop',
      'close',
      'info:maintenance-shutdown-finished',
    ]);
    expect(exits).toEqual([0]);
  });

  it('не ждёт стартовый проход, прежде чем остановить волны', async () => {
    let finishStartup: () => void = () => undefined;
    const startup = new Promise<void>((resolve) => {
      finishStartup = resolve;
    });
    const { calls, exits, deps: d } = deps({ startup });
    const done = shutdownMaintenance('SIGTERM', d);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toContain('stop');
    expect(calls).not.toContain('close');
    finishStartup();
    await done;
    expect(calls.at(-2)).toBe('close');
    expect(exits).toEqual([0]);
  });

  it('волна не уложилась в срок — базы не закрываются, но выход 0, а не 1', async () => {
    const {
      calls,
      exits,
      deps: d,
    } = deps({
      stopWorker: async () => ({ waveFinished: false }),
    });
    await shutdownMaintenance('SIGTERM', d);
    expect(calls).not.toContain('close');
    expect(calls).toContain('error:maintenance-shutdown-wave-abandoned');
    expect(exits).toEqual([0]);
  });

  it('упавший стартовый проход не мешает остановке', async () => {
    const startup = Promise.reject(new Error('restore'));
    startup.catch(() => undefined);
    const { calls, exits, deps: d } = deps({ startup });
    await shutdownMaintenance('SIGTERM', d);
    expect(calls).toContain('close');
    expect(exits).toEqual([0]);
  });
});
