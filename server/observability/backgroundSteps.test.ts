import { describe, expect, it } from 'vitest';
import { backgroundStep, heldBackgroundSteps, resetBackgroundSteps, type HeldStep } from './backgroundSteps';

describe('B769: фоновые шаги веб-процесса для журнала задержек', () => {
  it('шаг виден, пока идёт, и после конца — в окне задержки', async () => {
    resetBackgroundSteps();
    const before = performance.now();
    let during: HeldStep[] = [];
    await backgroundStep('list-build', async () => {
      during = heldBackgroundSteps(before, performance.now());
    });
    expect(during.map((step) => step.name)).toEqual(['list-build']);
    expect(heldBackgroundSteps(before, performance.now()).map((step) => step.name)).toEqual(['list-build']);
  });

  it('закончившийся до окна шаг не назван', async () => {
    resetBackgroundSteps();
    await backgroundStep('role-snapshot', async () => undefined);
    const later = performance.now() + 1;
    expect(heldBackgroundSteps(later, later + 10)).toEqual([]);
  });

  it('шаги — по перекрытию с окном задержки, длинное первым (прод 23.11: 8 имён в одной задержке)', async () => {
    resetBackgroundSteps();
    const windowStart = performance.now();
    await backgroundStep('short', async () => undefined);
    await backgroundStep('long', async () => {
      const until = performance.now() + 30;
      while (performance.now() < until) {
        // держит цикл
      }
    });
    const held = heldBackgroundSteps(windowStart, performance.now());
    expect(held[0]?.name).toBe('long');
    expect(held[0]?.overlapMs).toBeGreaterThanOrEqual(25);
    expect(held[1]?.overlapMs ?? 0).toBeLessThan(held[0]!.overlapMs);
  });

  it('ошибка шага пробрасывается, шаг закрывается', async () => {
    resetBackgroundSteps();
    await expect(backgroundStep('snapshot', async () => { throw new Error('x'); })).rejects.toThrow('x');
    const now = performance.now() + 1;
    expect(heldBackgroundSteps(now, now)).toEqual([]);
  });
});
