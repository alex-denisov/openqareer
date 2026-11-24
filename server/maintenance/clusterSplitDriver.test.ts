import { describe, expect, it, vi } from 'vitest';
import { readClusterSplitConfig, runClusterSplitDriver } from './clusterSplitDriver';
import type { ClusterSplitStepResult } from '../vacancies/clusterSplitStep';

const GIB = 1024 ** 3;

function stepResult(completed: boolean): ClusterSplitStepResult {
  return {
    stepId: completed ? null : 's',
    scanned: completed ? 0 : 200,
    split: 0,
    pieces: 0,
    skippedCandidateRef: 0,
    skippedIdTaken: 0,
    catalogMoved: 0,
    pages: { kept: 0, redirect: 0, gone: 0, unresolved: 0 },
    newPieceIds: [],
    completed,
    writeMs: completed ? 0 : 120,
  };
}

function probes(overrides: Partial<Parameters<typeof runClusterSplitDriver>[0]> = {}) {
  const log = { info: vi.fn(), warn: vi.fn() };
  const checkpoint = vi.fn();
  const sleep = vi.fn(async () => undefined);
  let calls = 0;
  const step = vi.fn(() => stepResult(++calls > 2));
  const dropClusterSnapshot = vi.fn();
  return {
    log,
    checkpoint,
    sleep,
    step,
    dropClusterSnapshot,
    options: {
      config: readClusterSplitConfig({ CLUSTER_SPLIT_ENABLED: '1' }),
      step,
      dropClusterSnapshot,
      checkpoint,
      sleep,
      log,
      lagP99Ms: () => 10,
      rssBytes: () => 100 * 1024 ** 2,
      walBytes: () => 0,
      isStopped: () => false,
      ...overrides,
    },
  };
}

describe('cluster split config (B752)', () => {
  it('is off by default with safe limits', () => {
    expect(readClusterSplitConfig({})).toEqual({
      enabled: false,
      pauseMs: 2_000,
      walLimitBytes: GIB,
    });
    expect(readClusterSplitConfig({ CLUSTER_SPLIT_ENABLED: '1' })).toMatchObject({ enabled: true });
  });
});

describe('cluster split driver (B752)', () => {
  it('does nothing when the flag is off', async () => {
    const { options, step } = probes({ config: readClusterSplitConfig({}) });
    expect(await runClusterSplitDriver(options)).toEqual({ steps: 0, reason: 'disabled' });
    expect(step).not.toHaveBeenCalled();
  });

  it('runs steps with a checkpoint and a pause each, until completed', async () => {
    const { options, checkpoint, sleep } = probes();
    expect(await runClusterSplitDriver(options)).toEqual({ steps: 3, reason: 'completed' });
    expect(checkpoint).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('drops the engine cluster snapshot right after every step, before any pause', async () => {
    const order: string[] = [];
    const { options } = probes({
      step: vi.fn(() => {
        order.push('step');
        return stepResult(order.length > 4);
      }),
      dropClusterSnapshot: () => order.push('drop'),
      sleep: async () => {
        order.push('sleep');
      },
    });
    await runClusterSplitDriver(options);
    expect(order).toEqual(['step', 'drop', 'sleep', 'step', 'drop', 'sleep', 'step', 'drop']);
  });

  it.each([
    ['event_loop_lag', { lagP99Ms: () => 250 }],
    ['rss', { rssBytes: () => 1.6 * GIB }],
    ['wal', { walBytes: () => 2 * GIB }],
  ])('pauses on %s', async (reason, override) => {
    const { options, log } = probes(override);
    expect(await runClusterSplitDriver(options)).toEqual({ steps: 1, reason });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason }),
      'cluster_split_paused',
    );
  });

  it('its own step blocking the loop (planning a large cluster) does not pause it', async () => {
    // Первое чтение после шага — задержка самого шага, второе — задержка за паузу.
    let reads = 0;
    const { options, log } = probes({ lagP99Ms: () => (++reads % 2 === 1 ? 7_800 : 10) });
    expect(await runClusterSplitDriver(options)).toEqual({ steps: 3, reason: 'completed' });
    expect(log.info).toHaveBeenCalledWith(
      { steps: 3, maxWriteMs: 120, pagesUnresolved: 0 },
      'cluster_split_completed',
    );
  });

  it('pauses when the step asks to stop', async () => {
    const { options } = probes({ step: () => ({ ...stepResult(false), stop: true }) });
    expect(await runClusterSplitDriver(options)).toEqual({ steps: 1, reason: 'step_stop' });
  });
});
