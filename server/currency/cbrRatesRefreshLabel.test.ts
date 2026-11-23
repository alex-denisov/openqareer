import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heldBackgroundSteps, resetBackgroundSteps } from '../observability/backgroundSteps';
import { scheduleCurrencyRatesRefresh } from './cbrRatesSchedule';

afterEach(() => resetBackgroundSteps());

// B776: «idle»-задержки без имени шага — таймер курсов подписан, как остальные таймеры веба.
describe('чтение курсов в веб-процессе видно журналу задержек', () => {
  it('шаг web:currency-refresh', async () => {
    const started = performance.now();
    const stop = scheduleCurrencyRatesRefresh(':memory:', { info: vi.fn(), error: vi.fn() });
    await new Promise((resolve) => setImmediate(resolve));
    expect(heldBackgroundSteps(started, performance.now()).map((step) => step.name)).toContain(
      'web:currency-refresh',
    );
    stop();
  });
});
