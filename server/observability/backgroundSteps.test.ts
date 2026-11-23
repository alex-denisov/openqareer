import { describe, expect, it } from 'vitest';
import { backgroundStep, heldBackgroundSteps, resetBackgroundSteps } from './backgroundSteps';

describe('B769: фоновые шаги веб-процесса для журнала задержек', () => {
  it('шаг виден, пока идёт, и после конца — в окне задержки', async () => {
    resetBackgroundSteps();
    const before = performance.now();
    let during: string[] = [];
    await backgroundStep('list-build', async () => {
      during = heldBackgroundSteps(before, performance.now());
    });
    expect(during).toEqual(['list-build']);
    expect(heldBackgroundSteps(before, performance.now())).toEqual(['list-build']);
  });

  it('закончившийся до окна шаг не назван', async () => {
    resetBackgroundSteps();
    await backgroundStep('role-snapshot', async () => undefined);
    const later = performance.now() + 1;
    expect(heldBackgroundSteps(later, later + 10)).toEqual([]);
  });

  it('ошибка шага пробрасывается, шаг закрывается', async () => {
    resetBackgroundSteps();
    await expect(backgroundStep('snapshot', async () => { throw new Error('x'); })).rejects.toThrow('x');
    const now = performance.now() + 1;
    expect(heldBackgroundSteps(now, now)).toEqual([]);
  });
});
