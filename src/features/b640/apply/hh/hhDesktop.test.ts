import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  inspectSessionPage: vi.fn(),
  isConnectorSessionOpen: vi.fn(),
  openConnectorSession: vi.fn(),
  parkConnectorSession: vi.fn(async () => true),
  showConnectorSession: vi.fn(),
  readSessionPage: vi.fn(),
}));
vi.mock('../../../connections/connectorSession', () => session);
const bridge = vi.hoisted(() => ({ invokeDesktopCommand: vi.fn() }));
vi.mock('../../../../services/desktop/desktopBridge', () => bridge);

const { applyHhResumeEditInSession, readHhResumeContent, readHhResumes, runHhApplyInSession } = await import('./hhDesktop');
const { HH_WINDOW_READY_MS } = await import('./hhWindow');

beforeEach(() => {
  vi.resetAllMocks();
  session.parkConnectorSession.mockResolvedValue(true);
});

describe('B704/B708: список резюме hh.ru в приложении', () => {
  const login = {
    ready: true, url: 'https://hh.ru/account/login', signedInApplicant: false, login: true, otp: false, captcha: false,
  };
  const home = { ...login, url: 'https://hh.ru/', signedInApplicant: true, login: false };
  const list = { ok: true, url: 'https://hh.ru/applicant/resumes', body: '<a href="/resume/abc1">COO</a>' };
  beforeEach(() => {
    vi.useFakeTimers();
    session.isConnectorSessionOpen.mockResolvedValue(false);
    session.openConnectorSession.mockResolvedValue({ opened: true });
    session.inspectSessionPage.mockResolvedValue(home);
    session.readSessionPage.mockResolvedValue(list);
  });
  afterEach(() => vi.useRealTimers());

  it('окна нет, вход жив — окно открывается в фоне и список читается', async () => {
    await expect(readHhResumes()).resolves.toMatchObject({ kind: 'ready', resumes: [{ id: 'abc1' }] });
    expect(session.openConnectorSession).toHaveBeenCalledOnce();
  });

  it('страница, которая ещё дорисовывается, входа не просит — и в открытом окне', async () => {
    session.isConnectorSessionOpen.mockResolvedValue(true);
    session.inspectSessionPage
      .mockResolvedValueOnce({ ...home, ready: false })
      .mockResolvedValueOnce({ ...home, signedInApplicant: false });
    const reading = readHhResumes();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(reading).resolves.toMatchObject({ kind: 'ready' });
    expect(session.openConnectorSession).not.toHaveBeenCalled();
  });

  it('страница входа осталась — «нужен вход»', async () => {
    session.inspectSessionPage.mockResolvedValue(login);
    const reading = readHhResumes();
    await vi.advanceTimersByTimeAsync(HH_WINDOW_READY_MS);
    await expect(reading).resolves.toEqual({ kind: 'signed_out' });
  });

  it('капча и неоткрытое окно — сбой, а не «нужен вход»', async () => {
    session.inspectSessionPage.mockResolvedValue({ ...home, captcha: true });
    await expect(readHhResumes()).rejects.toThrow('hh_captcha');
    session.openConnectorSession.mockResolvedValue({ opened: false });
    await expect(readHhResumes()).rejects.toThrow('hh_window_not_opened');
  });

  it('одновременные действия открывают окно один раз', async () => {
    const item = { id: 'abc1', title: 'COO', url: 'https://hh.ru/resume/abc1' };
    await Promise.allSettled([readHhResumes(), readHhResumeContent(item)]);
    expect(session.openConnectorSession).toHaveBeenCalledOnce();
  });

  it('правка резюме: окно открывается сначала; страница входа — not_signed_in без команды', async () => {
    const edit = { resumeId: 'abc1', section: 'title' as const, text: 'COO', skills: [] };
    bridge.invokeDesktopCommand.mockResolvedValue({ outcome: 'applied' });
    await expect(applyHhResumeEditInSession(edit)).resolves.toEqual({ outcome: 'applied' });
    expect(session.openConnectorSession).toHaveBeenCalledOnce();
    expect(bridge.invokeDesktopCommand).toHaveBeenCalledOnce();
    session.inspectSessionPage.mockResolvedValue(login);
    const refused = applyHhResumeEditInSession(edit);
    await vi.advanceTimersByTimeAsync(HH_WINDOW_READY_MS);
    await expect(refused).resolves.toEqual({ outcome: 'failed', failureCode: 'not_signed_in' });
    expect(bridge.invokeDesktopCommand).toHaveBeenCalledOnce();
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
