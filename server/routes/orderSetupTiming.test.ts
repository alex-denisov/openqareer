import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOrderSetupTiming, SLOW_ORDER_SETUP_MS } from './orderSetupTiming';

function clockAdvancing(stepsMs: readonly number[]) {
  let now = 0;
  const queue = [...stepsMs];
  vi.spyOn(performance, 'now').mockImplementation(() => {
    now += queue.shift() ?? 0;
    return now;
  });
}

const store = (snapshot: unknown) => ({
  getSnapshot: vi.fn(() => snapshot),
  getCandidateWorkspace: vi.fn(() => null),
});

describe('order setup breakdown in the journal (PRB-041)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names the slow step, the snapshot size and disk pressure, and nothing about the candidate', () => {
    const log = { warn: vi.fn() };
    const candidate = store({ candidate: { email: 'private@example.com' } });
    clockAdvancing([0, 0, 3000, 0, 200, 0, 100, 0, 400, 0]);
    const timing = startOrderSetupTiming(candidate, () => 'some avg10=1.00\nfull avg10=13.67');

    timing.store.getSnapshot('candidate-id');
    timing.store.getCandidateWorkspace('candidate-id');
    timing.step('planMs', () => 'free');
    timing.step('orderMs', () => 'order');
    timing.finish(log);

    expect(log.warn).toHaveBeenCalledTimes(1);
    const [details, message] = log.warn.mock.calls[0]!;
    expect(message).toBe('order-setup-slow');
    expect(details).toMatchObject({
      snapshotMs: 3000,
      workspaceMs: 200,
      planMs: 100,
      orderMs: 400,
      totalMs: 3700,
      snapshotBytes: JSON.stringify({ candidate: { email: 'private@example.com' } }).length,
      pressureIo: 'some avg10=1.00\nfull avg10=13.67',
    });
    expect(JSON.stringify(details)).not.toContain('private@example.com');
    expect(JSON.stringify(details)).not.toContain('candidate-id');
    expect(candidate.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('a fast setup logs nothing and never measures the snapshot or the disk', () => {
    const log = { warn: vi.fn() };
    const pressure = vi.fn(() => 'x');
    const candidate = store({});
    clockAdvancing([0, 0, SLOW_ORDER_SETUP_MS - 1, 0]);
    const timing = startOrderSetupTiming(candidate, pressure);

    timing.store.getSnapshot('candidate-id');
    timing.finish(log);

    expect(log.warn).not.toHaveBeenCalled();
    expect(pressure).not.toHaveBeenCalled();
    expect(candidate.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('a failed read of the pressure file does not break the request', () => {
    const log = { warn: vi.fn() };
    clockAdvancing([0, 0, SLOW_ORDER_SETUP_MS, 0]);
    const timing = startOrderSetupTiming(store({}), () => {
      throw new Error('no /proc here');
    });

    timing.store.getSnapshot('candidate-id');
    timing.finish(log);

    expect(log.warn.mock.calls[0]![0]).toMatchObject({ pressureIo: null });
  });
});
