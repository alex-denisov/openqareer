import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ invokeDesktopCommand: vi.fn(), isTauriEnvironment: vi.fn() }));
const api = vi.hoisted(() => ({ claimHhRaise: vi.fn(), sendHhRaiseResult: vi.fn() }));
vi.mock('../../../../services/desktop/desktopBridge', () => bridge);
vi.mock('../../platforms/hh/hhRaiseApi', () => api);
const hhWindow = vi.hoisted(() => ({ ensureHhWindow: vi.fn() }));
vi.mock('./hhWindow', () => hhWindow);

const { HH_RAISE_POLL_MS, runHhRaiseOnce, startHhRaisePoller } = await import('./hhRaisePoller');
const task = { taskId: 't1', resumeId: 'abc123' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  bridge.isTauriEnvironment.mockReturnValue(true);
  hhWindow.ensureHhWindow.mockResolvedValue('ready');
  api.claimHhRaise.mockResolvedValue({ task: null });
  api.sendHhRaiseResult.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('B699: опрос поднятия резюме', () => {
  it('нет задания — команда не запускается', async () => {
    await runHhRaiseOnce();
    expect(bridge.invokeDesktopCommand).not.toHaveBeenCalled();
    expect(api.sendHhRaiseResult).not.toHaveBeenCalled();
  });

  it('есть задание — команда с резюме и исход уходит на сервер', async () => {
    api.claimHhRaise.mockResolvedValue({ task });
    bridge.invokeDesktopCommand.mockResolvedValue({ outcome: 'captcha' });
    await runHhRaiseOnce();
    expect(bridge.invokeDesktopCommand).toHaveBeenCalledWith('run_hh_raise', { request: { resumeId: 'abc123' } });
    expect(api.sendHhRaiseResult).toHaveBeenCalledWith('t1', 'captcha');
  });

  it('сбой команды или чужой исход — error; занятое окно — без отправки', async () => {
    api.claimHhRaise.mockResolvedValue({ task });
    bridge.invokeDesktopCommand.mockRejectedValueOnce('session_window_missing');
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'error');
    bridge.invokeDesktopCommand.mockResolvedValueOnce({ outcome: 'weird' });
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'error');
    api.sendHhRaiseResult.mockClear();
    bridge.invokeDesktopCommand.mockResolvedValueOnce({ outcome: 'busy' });
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).not.toHaveBeenCalled();
  });

  it('B708: окна нет — открывается до команды; страница входа — logged_out, сбой окна — error', async () => {
    api.claimHhRaise.mockResolvedValue({ task });
    hhWindow.ensureHhWindow.mockResolvedValueOnce('signed_out');
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'logged_out');
    hhWindow.ensureHhWindow.mockRejectedValueOnce(new Error('hh_window_not_opened'));
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'error');
    expect(bridge.invokeDesktopCommand).not.toHaveBeenCalled();
  });

  it('в браузере не запускается', () => {
    bridge.isTauriEnvironment.mockReturnValue(false);
    const stop = startHhRaisePoller();
    vi.advanceTimersByTime(HH_RAISE_POLL_MS * 3);
    expect(api.claimHhRaise).not.toHaveBeenCalled();
    stop();
  });

  it('в приложении спрашивает сразу и раз в 5 минут, пока не остановлен', async () => {
    const stop = startHhRaisePoller();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HH_RAISE_POLL_MS);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(HH_RAISE_POLL_MS * 2);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(2);
  });

  it('ошибка сервера не роняет опрос', async () => {
    api.claimHhRaise.mockRejectedValueOnce(new Error('offline'));
    const stop = startHhRaisePoller();
    await vi.advanceTimersByTimeAsync(HH_RAISE_POLL_MS);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(2);
    stop();
  });
});
