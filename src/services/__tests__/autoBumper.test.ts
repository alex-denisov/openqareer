import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getInitialAutoBumperState,
  toggleAutoBumper,
  triggerInstantBump,
} from '../autoBumper';

describe('auto bumper state transitions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a predictable schedule from the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T08:00:00'));

    const state = getInitialAutoBumperState();

    expect(state.isActive).toBe(true);
    expect(state.intervalHours).toBe(4);
    expect(state.nextBumpTime).toBe('12:00');
  });

  it('pauses and resumes without losing the schedule', () => {
    const initial = getInitialAutoBumperState();
    const paused = toggleAutoBumper(initial);
    const resumed = toggleAutoBumper(paused);

    expect(paused).toMatchObject({
      isActive: false,
      lastBumpStatus: 'Idle',
      nextBumpTime: initial.nextBumpTime,
    });
    expect(resumed).toMatchObject({
      isActive: true,
      lastBumpStatus: 'Scheduled',
      nextBumpTime: initial.nextBumpTime,
    });
  });

  it('records an instant bump immutably', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T08:00:00'));
    const initial = getInitialAutoBumperState();

    const bumped = triggerInstantBump(initial);

    expect(bumped).not.toBe(initial);
    expect(bumped.bumpsToday).toBe(initial.bumpsToday + 1);
    expect(bumped.totalBumpsCount).toBe(initial.totalBumpsCount + 1);
    expect(bumped.nextBumpTime).toBe('12:00');
  });
});

