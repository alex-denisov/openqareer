import { describe, expect, it, vi } from 'vitest';
import { createSelectionLivenessStep, startSelectionLiveness } from './selectionLivenessStep';

const log = () => ({ info: vi.fn(), error: vi.fn() });
const REPORT = { checked: 1, gone: 1, open: 0, unknown: 0 };

describe('B797: такт сверки живости', () => {
  it('второй такт не начинается поверх идущего; итог — в журнале', async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () => new Promise<typeof REPORT>((resolve) => (finish = () => resolve(REPORT))),
    );
    const lines = log();
    const step = createSelectionLivenessStep({ runSelectionLivenessStep: run }, lines, () => false);
    const first = step();
    await step();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(lines.info).toHaveBeenCalledWith(REPORT, 'selection-liveness-tick');
  });

  it('остановка и сбой не роняют воркер', async () => {
    const run = vi.fn(async () => Promise.reject(new Error('busy')));
    const lines = log();
    await createSelectionLivenessStep({ runSelectionLivenessStep: run }, lines, () => true)();
    expect(run).not.toHaveBeenCalled();
    await createSelectionLivenessStep({ runSelectionLivenessStep: run }, lines, () => false)();
    expect(lines.error).toHaveBeenCalledWith({ errorName: 'Error' }, 'selection-liveness-failed');
  });

  it('движок без сверки таймер не заводит', () => {
    expect(startSelectionLiveness({}, log(), () => false)).toEqual([]);
  });
});
