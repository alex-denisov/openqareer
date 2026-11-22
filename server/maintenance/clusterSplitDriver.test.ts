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
    newPieceIds: [],
    completed,
  };
}

function probes(overrides: Partial<Parameters<typeof runClusterSplitDriver>[0]> = {}) {
  const log = { info: vi.fn(), warn: vi.fn() };
  const checkpoint = vi.fn();
  const sleep = vi.fn(async () => undefined);
  let calls = 0;
  const step = vi.fn(() => stepResult(++calls > 2));
  return {
    log,
    checkpoint,
    sleep,
    step,
    options: {
      config: readClusterSplitConfig({ CLUSTER_SPLIT_ENABLED: '1' }),
      step,
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
  it('is off by default with no jobs and safe limits', () => {
    expect(readClusterSplitConfig({})).toEqual({
      enabled: false,
      maxJobs: 0,
      pauseMs: 2_000,
      walLimitBytes: GIB,
    });
    expect(
      readClusterSplitConfig({ CLUSTER_SPLIT_ENABLED: '1', CLUSTER_SPLIT_MAX_JOBS: '50' }),
    ).toMatchObject({ enabled: true, maxJobs: 50 });
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

  it('pauses when the step asks to stop', async () => {
    const { options } = probes({ step: () => ({ ...stepResult(false), stop: true }) });
    expect(await runClusterSplitDriver(options)).toEqual({ steps: 1, reason: 'step_stop' });
  });
});
