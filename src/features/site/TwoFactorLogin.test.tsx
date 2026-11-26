// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ login: vi.fn(), complete: vi.fn() }));
vi.mock('../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../coach/coachApi')>()),
  login: api.login,
  completeTwoFactorLogin: api.complete,
}));

import { CoachApiError, TwoFactorRequiredError } from '../coach/coachApi';
import { LoginPage } from './AuthPages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = { username: 'f.test', role: 'candidate', emailVerified: true };
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

function render() {
  const onNavigate = vi.fn();
  const onSessionChange = vi.fn();
  root = createRoot(host);
  act(() => root?.render(<LoginPage onNavigate={onNavigate} onSessionChange={onSessionChange} />));
  return { onNavigate, onSessionChange };
}

function type(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function password() {
  type('login-identifier', 'f.test');
  type('login-password', 'secret-password');
  await submit();
}

describe('B401: шаг кода во входе', () => {
  it('without 2FA the password signs in at once: no code step', async () => {
    api.login.mockResolvedValue(user);
    const { onNavigate, onSessionChange } = render();
    await password();
    expect(onSessionChange).toHaveBeenCalledWith(user);
    expect(onNavigate).toHaveBeenCalledWith('/app');
    expect(host.querySelector('#login-code')).toBeNull();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('with 2FA the same card asks for the code and signs in with it', async () => {
    api.login.mockRejectedValue(new TwoFactorRequiredError('oq2_challenge'));
    api.complete.mockResolvedValue(user);
    const { onNavigate, onSessionChange } = render();
    await password();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(host.querySelector('h1')?.textContent).toBe('Вход в кабинет');
    expect(host.querySelector('.auth-card-header p')).toBeNull();
    expect(host.querySelector('#login-password')).toBeNull();
    expect(host.querySelector('label[for="login-code"]')?.textContent).toBe('Код из приложения или резервный код');
    expect(host.textContent).toContain('← Войти с другим аккаунтом');
    expect(host.textContent).not.toContain('Зарегистрироваться');
    type('login-code', ' 123456 ');
    await submit();
    expect(api.complete).toHaveBeenCalledWith('oq2_challenge', ' 123456 ');
    expect(onSessionChange).toHaveBeenCalledWith(user);
    expect(onNavigate).toHaveBeenCalledWith('/app');
  });

  it('a wrong code stays on the step and says so', async () => {
    api.login.mockRejectedValue(new TwoFactorRequiredError('oq2_challenge'));
    api.complete.mockRejectedValue(new CoachApiError('Код не подошёл.', 'two_factor_invalid', false));
    render();
    await password();
    type('login-code', '000000');
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Код не подошёл.');
    expect(host.querySelector('#login-code')).not.toBeNull();
  });

  it('an expired step returns to the password with the server notice', async () => {
    api.login.mockRejectedValue(new TwoFactorRequiredError('oq2_challenge'));
    api.complete.mockRejectedValue(new CoachApiError('Войдите заново.', 'two_factor_challenge_expired', false));
    render();
    await password();
    type('login-code', '123456');
    await submit();
    expect(host.querySelector('#login-password')).not.toBeNull();
    expect(host.querySelector('.auth-notice')?.textContent).toBe('Войдите заново.');
  });

  it('«← Войти с другим аккаунтом» returns to the password form', async () => {
    api.login.mockRejectedValue(new TwoFactorRequiredError('oq2_challenge'));
    render();
    await password();
    const back = [...host.querySelectorAll('button')].find((item) => item.textContent === '← Войти с другим аккаунтом');
    act(() => back?.click());
    expect(host.querySelector('#login-identifier')).not.toBeNull();
    expect(host.querySelector('#login-code')).toBeNull();
  });
});
