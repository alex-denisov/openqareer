import { describe, expect, it } from 'vitest';
import { runSteps, type Steps } from '../vacancies/yieldingSteps';
import { createPhaseTimer } from './matchedListPhases';

/** Часы, которые двигает сам тест. */
function clock() {
  let at = 0;
  return { now: () => at, tick: (ms: number) => (at += ms) };
}

describe('createPhaseTimer: время фазы — только внутри её шагов (B770)', () => {
  it('ходы между шагами в фазу не идут', () => {
    const time = clock();
    const timer = createPhaseTimer(time.now);
    function* work(): Steps<string> {
      time.tick(5);
      yield;
      time.tick(7);
      return 'done';
    }
    const steps = timer.steps('finish', work());
    expect(steps.next().done).toBe(false);
    time.tick(1_000); // чужой ход event loop
    expect(steps.next()).toEqual({ done: true, value: 'done' });
    expect(timer.read()).toEqual({ finish: 12 });
  });

  it('фазы с одним именем складываются, run считает синхронную работу', () => {
    const time = clock();
    const timer = createPhaseTimer(time.now);
    expect(timer.run('order', () => (time.tick(3), 'a'))).toBe('a');
    timer.run('order', () => time.tick(4));
    expect(
      runSteps(
        timer.steps(
          'facets',
          (function* () {
            time.tick(2.345);
            yield;
            return 1;
          })(),
        ),
      ),
    ).toBe(1);
    expect(timer.read()).toEqual({ order: 7, facets: 2.35 });
  });

  it('ошибка внутри run всё равно учтена', () => {
    const time = clock();
    const timer = createPhaseTimer(time.now);
    expect(() =>
      timer.run('order', () => {
        time.tick(9);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(timer.read()).toEqual({ order: 9 });
  });
});
