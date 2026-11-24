import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ finishHhApply: vi.fn() }));
const desktop = vi.hoisted(() => ({ readHhApplyWindow: vi.fn() }));
vi.mock('./hhSessionApi', () => api);
vi.mock('./hhDesktop', () => desktop);

const { HH_WATCH_LIMIT_MS, HH_WATCH_STEP_MS, stopHhWindowWatch, watchHhWindow } =
  await import('./hhWindowWatch');

const watch = (onSent = vi.fn().mockResolvedValue(undefined), failureCode = 'popup_missing') => ({
  onSent,
  done: watchHhWindow({ attemptId: 'att-1', vacancyId: '77', failureCode, onSent }),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  api.finishHhApply.mockResolvedValue(undefined);
});
afterEach(() => {
  stopHhWindowWatch();
  vi.useRealTimers();
});

describe('B708: отклик, завершённый в окне hh.ru', () => {
  it('ждёт признака и отмечает один раз', async () => {
    desktop.readHhApplyWindow.mockResolvedValueOnce('waiting').mockResolvedValue('sent');
    const { onSent, done } = watch();
    await vi.advanceTimersByTimeAsync(HH_WATCH_STEP_MS * 3);
    expect(await done).toBe(true);
    expect(desktop.readHhApplyWindow).toHaveBeenCalledTimes(2);
    expect(onSent).toHaveBeenCalledOnce();
  });

  it('срок конечный', async () => {
    desktop.readHhApplyWindow.mockResolvedValue('waiting');
    const { onSent, done } = watch();
    await vi.advanceTimersByTimeAsync(HH_WATCH_LIMIT_MS + HH_WATCH_STEP_MS);
    expect(await done).toBe(false);
    expect(desktop.readHhApplyWindow.mock.calls.length).toBeLessThanOrEqual(
      HH_WATCH_LIMIT_MS / HH_WATCH_STEP_MS + 1,
    );
    expect(onSent).not.toHaveBeenCalled();
  });

  it('окно закрыто или приложение старое — чтение прекращается', async () => {
    desktop.readHhApplyWindow.mockRejectedValue(new Error('session_window_missing'));
    expect(await watch().done).toBe(false);
    expect(desktop.readHhApplyWindow).toHaveBeenCalledOnce();
  });

  it('исход без окна вакансии не читается', async () => {
    expect(await watch(undefined, 'no_response_button').done).toBe(false);
    expect(desktop.readHhApplyWindow).not.toHaveBeenCalled();
  });

  it('новая попытка останавливает чтение прежней', async () => {
    desktop.readHhApplyWindow.mockResolvedValue('waiting');
    const first = watch();
    await vi.advanceTimersByTimeAsync(HH_WATCH_STEP_MS);
    desktop.readHhApplyWindow.mockResolvedValue('sent');
    stopHhWindowWatch();
    await vi.advanceTimersByTimeAsync(HH_WATCH_STEP_MS);
    expect(await first.done).toBe(false);
    expect(api.finishHhApply).not.toHaveBeenCalled();
    expect(first.onSent).not.toHaveBeenCalled();
  });

  it('сбой сети при записи исхода повторяется на следующем шаге', async () => {
    desktop.readHhApplyWindow.mockResolvedValue('sent');
    api.finishHhApply.mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const { onSent, done } = watch();
    await vi.advanceTimersByTimeAsync(HH_WATCH_STEP_MS * 2);
    expect(await done).toBe(true);
    expect(onSent).toHaveBeenCalledOnce();
  });
});
