import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  inspectSessionPage: vi.fn(),
  openConnectorSession: vi.fn(),
  readSessionPage: vi.fn(),
}));
vi.mock('../../../connections/connectorSession', () => session);

const { readHhResumes } = await import('./hhDesktop');

beforeEach(() => vi.clearAllMocks());

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
