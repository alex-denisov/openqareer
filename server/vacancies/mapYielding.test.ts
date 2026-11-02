import { describe, expect, it } from 'vitest';
import { mapYielding } from './mapYielding';

describe('mapYielding', () => {
  it('maps in order and lets other work run between slices', async () => {
    let clock = 0;
    let timerRan = false;
    setImmediate(() => {
      timerRan = true;
    });
    const seenTimerMidway: boolean[] = [];
    const result = await mapYielding(
      [1, 2, 3, 4, 5, 6],
      (value) => {
        clock += 10;
        seenTimerMidway.push(timerRan);
        return value * 2;
      },
      { sliceMs: 25, now: () => clock },
    );
    expect(result).toEqual([2, 4, 6, 8, 10, 12]);
    expect(seenTimerMidway[0]).toBe(false);
    expect(seenTimerMidway.at(-1)).toBe(true);
  });

  it('returns an empty list for no items', async () => {
    expect(await mapYielding([], (value: number) => value)).toEqual([]);
  });
});
