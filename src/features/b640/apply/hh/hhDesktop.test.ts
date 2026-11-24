import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  inspectSessionPage: vi.fn(),
  isConnectorSessionOpen: vi.fn(),
  openConnectorSession: vi.fn(),
  readSessionPage: vi.fn(),
}));
vi.mock('../../../connections/connectorSession', () => session);
const bridge = vi.hoisted(() => ({ invokeDesktopCommand: vi.fn() }));
vi.mock('../../../../services/desktop/desktopBridge', () => bridge);

const { HH_WINDOW_READY_MS, readHhResumes, runHhApplyInSession } = await import('./hhDesktop');

beforeEach(() => vi.resetAllMocks());

describe('B704: список резюме hh.ru в приложении', () => {
  it('окна сессии hh.ru нет — это «нужен вход», а не сбой', async () => {
    // Так отклоняет вызов Rust (`inspect_session_page_for`), когда окна `connector-hh` нет.
    session.inspectSessionPage.mockRejectedValue('session_window_missing');
    await expect(readHhResumes()).resolves.toEqual({ kind: 'signed_out' });
  });

  it('страница входа в окне — тоже «нужен вход»', async () => {
    session.inspectSessionPage.mockResolvedValue({
      ready: true, url: 'https://hh.ru/account/login', signedInApplicant: false, login: true, otp: false, captcha: false,
    });
    await expect(readHhResumes()).resolves.toEqual({ kind: 'signed_out' });
  });

  it('другой сбой окна остаётся сбоем', async () => {
    session.inspectSessionPage.mockRejectedValue('inspection_shape: bad');
    await expect(readHhResumes()).rejects.toBe('inspection_shape: bad');
  });
});

describe('B708: отклик без окна hh.ru', () => {
  const input = { vacancyId: '123', resumeId: 'abc1', letter: 'Здравствуйте' };
  const page = {
    ready: true, url: 'https://hh.ru/', signedInApplicant: true, login: false, otp: false, captcha: false,
  };
  beforeEach(() => {
    vi.useFakeTimers();
    session.isConnectorSessionOpen.mockResolvedValue(false);
    session.openConnectorSession.mockResolvedValue({ opened: true });
    session.inspectSessionPage.mockResolvedValue(page);
    bridge.invokeDesktopCommand.mockResolvedValue({ outcome: 'sent', failureCode: null });
  });
  afterEach(() => vi.useRealTimers());

  it('открывает окно в фоне, ждёт загрузки и отправляет один раз', async () => {
    session.inspectSessionPage.mockRejectedValueOnce('eval_cancelled').mockResolvedValueOnce({ ...page, ready: false });
    const sending = runHhApplyInSession(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.openConnectorSession).toHaveBeenCalledExactlyOnceWith(
      'hh', 'https://hh.ru/account/login', undefined, { background: true },
    );
    expect(bridge.invokeDesktopCommand).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(sending).resolves.toEqual({ outcome: 'sent', failureCode: null });
    expect(bridge.invokeDesktopCommand).toHaveBeenCalledExactlyOnceWith('run_hh_apply', { request: input });
  });

  it('открытое окно не переоткрывает', async () => {
    session.isConnectorSessionOpen.mockResolvedValue(true);
    await runHhApplyInSession(input);
    expect(session.openConnectorSession).not.toHaveBeenCalled();
    expect(session.inspectSessionPage).not.toHaveBeenCalled();
    expect(bridge.invokeDesktopCommand).toHaveBeenCalledOnce();
  });

  it('страница входа в новом окне — «нужен вход», отклик не запускается', async () => {
    session.inspectSessionPage.mockResolvedValue({ ...page, signedInApplicant: false, login: true });
    const sending = runHhApplyInSession(input);
    await vi.advanceTimersByTimeAsync(HH_WINDOW_READY_MS + 1000);
    await expect(sending).resolves.toEqual({ outcome: 'failed', failureCode: 'not_signed_in' });
    expect(bridge.invokeDesktopCommand).not.toHaveBeenCalled();
  });

  it('страница входа, которая сама ведёт вошедшего дальше, входа не просит', async () => {
    session.inspectSessionPage.mockResolvedValueOnce({ ...page, signedInApplicant: false, login: true });
    const sending = runHhApplyInSession(input);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(sending).resolves.toMatchObject({ outcome: 'sent' });
  });

  it('окно не открылось или не загрузилось — ошибка, а не «нужен вход», и отклик не запускается', async () => {
    session.openConnectorSession.mockResolvedValueOnce({ opened: false, reason: 'window_build_failed' });
    await expect(runHhApplyInSession(input)).rejects.toThrow('hh_window_not_opened');
    session.inspectSessionPage.mockRejectedValue('eval_timeout');
    const sending = runHhApplyInSession(input).catch((reason: Error) => reason.message);
    await vi.advanceTimersByTimeAsync(HH_WINDOW_READY_MS + 1000);
    await expect(sending).resolves.toBe('hh_window_not_loaded');
    expect(bridge.invokeDesktopCommand).not.toHaveBeenCalled();
  });
});
