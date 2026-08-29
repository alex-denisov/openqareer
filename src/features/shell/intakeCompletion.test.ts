import { describe, expect, it, vi } from 'vitest';
import { createIntakeCompletion } from './intakeCompletion';

const input = {
  resumeText: 'Синтетический текст резюме кандидата для проверки завершения мастера.',
  resumeSource: 'text' as const,
  targetDirection: 'Руководитель продукта',
  regions: ['ru'] as const,
  currentSituation: 'Проверяю завершение диагностики.',
  constraints: '',
  urgency: 'active' as const,
};

describe('createIntakeCompletion', () => {
  /**
   * The cabinet reads the server once when it mounts. The import that creates
   * the facts is still in flight at that moment, so the candidate is told the
   * profile is empty while the server is about to hold everything (INC-024).
   */
  it('refreshes the cabinet only after the import has actually settled', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push('import-settled');
            resolve();
          };
        }),
    );
    const refreshCabinet = vi.fn(() => order.push('cabinet-refreshed'));
    const closeIntake = vi.fn(() => order.push('intake-closed'));

    const complete = createIntakeCompletion({ save, closeIntake, refreshCabinet });
    complete(input);

    expect(closeIntake).toHaveBeenCalledOnce();
    expect(refreshCabinet).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => expect(refreshCabinet).toHaveBeenCalledOnce());
    expect(order).toEqual(['intake-closed', 'import-settled', 'cabinet-refreshed']);
  });

  it('refreshes the cabinet when the import fails, so the screen shows the real state', async () => {
    const save = vi.fn(() => Promise.reject(new Error('import_failed')));
    const refreshCabinet = vi.fn();

    const complete = createIntakeCompletion({
      save,
      closeIntake: () => undefined,
      refreshCabinet,
    });
    complete(input);

    await vi.waitFor(() => expect(refreshCabinet).toHaveBeenCalledOnce());
  });

  it('does not schedule a refresh when saving is synchronous', () => {
    const refreshCabinet = vi.fn();

    const complete = createIntakeCompletion({
      save: () => undefined,
      closeIntake: () => undefined,
      refreshCabinet,
    });
    complete(input);

    expect(refreshCabinet).not.toHaveBeenCalled();
  });

  /**
   * B160 §3: for the ~12 seconds the import takes, «Сегодня» printed a
   * confident `0 · нет подтверждённых фактов` over a profile the server was
   * about to hold in full. The screen has to know the import is running.
   */
  it('marks the import as running until it settles, so the cabinet can stop claiming a zero', async () => {
    let release: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const setImporting = vi.fn();

    const complete = createIntakeCompletion({
      save,
      closeIntake: () => undefined,
      refreshCabinet: () => undefined,
      setImporting,
    });
    complete(input);

    expect(setImporting).toHaveBeenCalledWith(true);
    expect(setImporting).not.toHaveBeenCalledWith(false);

    release();
    await vi.waitFor(() => expect(setImporting).toHaveBeenLastCalledWith(false));
  });

  it('never leaves the import marked as running when the save is synchronous', () => {
    const setImporting = vi.fn();

    const complete = createIntakeCompletion({
      save: () => undefined,
      closeIntake: () => undefined,
      refreshCabinet: () => undefined,
      setImporting,
    });
    complete(input);

    expect(setImporting).not.toHaveBeenCalledWith(true);
  });
});
