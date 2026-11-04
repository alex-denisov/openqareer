import { describe, expect, it } from 'vitest';
import {
  filterInSteps,
  mapInSteps,
  runSteps,
  runStepsYielding,
  type Steps,
} from './yieldingSteps';

function* doubled(items: readonly number[]): Steps<number[]> {
  const mapped = yield* mapInSteps(items, (item) => item * 2, 2);
  return yield* filterInSteps(mapped, (item) => item > 2, 2);
}

describe('steps that may run in one piece or in slices (PRB-041)', () => {
  it('gives the same result both ways', async () => {
    const items = [1, 2, 3, 4, 5];
    expect(runSteps(doubled(items))).toEqual([4, 6, 8, 10]);
    await expect(runStepsYielding(doubled(items))).resolves.toEqual([4, 6, 8, 10]);
  });

  it('lets queued work run once a slice has used its time', async () => {
    let clock = 0;
    const ran: string[] = [];
    function* slow(): Steps<void> {
      for (const name of ['a', 'b', 'c']) {
        ran.push(name);
        clock += 30;
        yield;
      }
    }
    setImmediate(() => ran.push('queued'));
    await runStepsYielding(slow(), { sliceMs: 20, now: () => clock });
    expect(ran.indexOf('queued')).toBeGreaterThan(0);
    expect(ran.indexOf('queued')).toBeLessThan(3);
  });

  it('does not give the loop away while the slice has time left', async () => {
    const ran: string[] = [];
    function* quick(): Steps<void> {
      for (const name of ['a', 'b', 'c']) {
        ran.push(name);
        yield;
      }
    }
    setImmediate(() => ran.push('queued'));
    await runStepsYielding(quick(), { sliceMs: 20, now: () => 0 });
    expect(ran.slice(0, 3)).toEqual(['a', 'b', 'c']);
  });

  it('passes a failure of a step to the caller', async () => {
    function* broken(): Steps<void> {
      yield;
      throw new Error('step failed');
    }
    await expect(runStepsYielding(broken())).rejects.toThrow('step failed');
  });
});
