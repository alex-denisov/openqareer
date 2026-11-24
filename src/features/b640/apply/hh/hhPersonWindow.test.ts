import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  inspectSessionPage: vi.fn(),
  isConnectorSessionOpen: vi.fn(),
  openConnectorSession: vi.fn(),
  parkConnectorSession: vi.fn(),
  showConnectorSession: vi.fn(),
}));
vi.mock('../../../connections/connectorSession', () => session);

const { hideHhWindow, openHhSignIn, showHhCaptcha, showHhResponse } = await import('./hhPersonWindow');

const home = { ready: true, url: 'https://hh.ru/', signedInApplicant: true, login: false, otp: false, captcha: false };
const login = { ...home, signedInApplicant: false, login: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  session.isConnectorSessionOpen.mockResolvedValue(true);
  session.openConnectorSession.mockResolvedValue({ opened: true });
  session.parkConnectorSession.mockResolvedValue(true);
  session.showConnectorSession.mockResolvedValue(true);
});
afterEach(async () => {
  await hideHhWindow();
  vi.useRealTimers();
});

describe('окно hh.ru на экране — только по нажатию и пока нужен человек', () => {
  it('вход: окно показано, после входа скрыто', async () => {
    session.inspectSessionPage.mockResolvedValue(login);
    await openHhSignIn();
    expect(session.openConnectorSession).toHaveBeenCalledWith('hh', 'https://hh.ru/account/login');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.parkConnectorSession).not.toHaveBeenCalled();
    session.inspectSessionPage.mockResolvedValue(home);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.parkConnectorSession).toHaveBeenCalledOnce();
  });

  it('капча: без перехода, скрыто после её прохождения; страница без просьб не скрывается', async () => {
    session.inspectSessionPage.mockResolvedValue(home);
    await showHhCaptcha();
    expect(session.openConnectorSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.parkConnectorSession).not.toHaveBeenCalled();
    session.inspectSessionPage.mockResolvedValue({ ...home, captcha: true });
    await vi.advanceTimersByTimeAsync(3_000);
    session.inspectSessionPage.mockResolvedValue(home);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.parkConnectorSession).toHaveBeenCalledOnce();
  });

  it('незавершённый отклик: окно само не скрывается', async () => {
    session.inspectSessionPage.mockResolvedValue(home);
    await showHhResponse();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.parkConnectorSession).not.toHaveBeenCalled();
  });

  it('окна нет — вход; закрытое человеком окно больше не читается', async () => {
    session.showConnectorSession.mockResolvedValue(false);
    await showHhCaptcha();
    expect(session.openConnectorSession).toHaveBeenCalledOnce();
    session.isConnectorSessionOpen.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.inspectSessionPage).not.toHaveBeenCalled();
  });
});
