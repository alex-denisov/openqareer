import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ invokeDesktopCommand: vi.fn(), isTauriEnvironment: vi.fn() }));
const api = vi.hoisted(() => ({ claimHhRaise: vi.fn(), sendHhRaiseResult: vi.fn() }));
vi.mock('../../../../services/desktop/desktopBridge', () => bridge);
vi.mock('../../platforms/hh/hhRaiseApi', () => api);
const hhWindow = vi.hoisted(() => ({ ensureHhWindow: vi.fn() }));
vi.mock('./hhWindow', () => hhWindow);

const { HH_RAISE_POLL_MS, requestHhRaiseStep, runHhRaiseOnce, startHhRaisePoller } = await import('./hhRaisePoller');
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
    expect(api.sendHhRaiseResult).toHaveBeenCalledWith('t1', 'captcha', undefined);
  });

  it('сбой команды или чужой исход — error; занятое окно — без отправки', async () => {
    api.claimHhRaise.mockResolvedValue({ task });
    bridge.invokeDesktopCommand.mockRejectedValueOnce('session_window_missing');
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'error', undefined);
    bridge.invokeDesktopCommand.mockResolvedValueOnce({ outcome: 'weird' });
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'error', undefined);
    api.sendHhRaiseResult.mockClear();
    bridge.invokeDesktopCommand.mockResolvedValueOnce({ outcome: 'busy' });
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).not.toHaveBeenCalled();
  });

  it('B708: окна нет — открывается до команды; страница входа — logged_out, сбой окна — error', async () => {
    api.claimHhRaise.mockResolvedValue({ task });
    hhWindow.ensureHhWindow.mockResolvedValueOnce('signed_out');
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'logged_out', undefined);
    hhWindow.ensureHhWindow.mockRejectedValueOnce(new Error('hh_window_not_opened'));
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'error', undefined);
    expect(bridge.invokeDesktopCommand).not.toHaveBeenCalled();
  });

  it('«ещё рано»: время с кнопки уходит на сервер, негодное — нет', async () => {
    api.claimHhRaise.mockResolvedValue({ task });
    bridge.invokeDesktopCommand.mockResolvedValueOnce({ outcome: 'too_early', availableAt: '20:55' });
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'too_early', '20:55');
    bridge.invokeDesktopCommand.mockResolvedValueOnce({ outcome: 'too_early', availableAt: '25:00' });
    await runHhRaiseOnce();
    expect(api.sendHhRaiseResult).toHaveBeenLastCalledWith('t1', 'too_early', undefined);
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

  it('шаг по требованию: сразу, без наложения; просьба во время шага исполняется после него один раз', async () => {
    let release: (value: { task: null }) => void = () => undefined;
    api.claimHhRaise.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const stop = startHhRaisePoller();
    requestHhRaiseStep();
    requestHhRaiseStep();
    await vi.advanceTimersByTimeAsync(HH_RAISE_POLL_MS);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(1);
    release({ task: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(2);
    requestHhRaiseStep();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(3);
    stop();
  });

  it('шаг по требованию в браузере не запускается', () => {
    bridge.isTauriEnvironment.mockReturnValue(false);
    requestHhRaiseStep();
    expect(api.claimHhRaise).not.toHaveBeenCalled();
  });

  it('ошибка сервера не роняет опрос', async () => {
    api.claimHhRaise.mockRejectedValueOnce(new Error('offline'));
    const stop = startHhRaisePoller();
    await vi.advanceTimersByTimeAsync(HH_RAISE_POLL_MS);
    expect(api.claimHhRaise).toHaveBeenCalledTimes(2);
    stop();
  });
});
