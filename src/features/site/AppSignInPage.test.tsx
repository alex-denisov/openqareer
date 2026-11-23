// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../coach/coachApi';
import { AppSignInPage } from './AppSignInPage';
import { appSignInReturnPath, readAppSignInRequest } from './appSignIn';

const CHALLENGE = 'C'.repeat(43);
const STATE = 's'.repeat(22);
const QUERY = `?challenge=${CHALLENGE}&state=${STATE}`;
const USER = { username: 'candidate.test', email: 'owner@example.test' } as AuthUser;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', `/app-sign-in${QUERY}`);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(session: AuthUser | null, onNavigate = vi.fn(), openCallback = vi.fn()) {
  act(() =>
    root.render(
      <AppSignInPage session={session} onNavigate={onNavigate} openCallback={openCallback} />,
    ),
  );
  return { onNavigate, openCallback };
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent === name)!;

describe('B755: «Войти в приложение openqareer на этом Mac»', () => {
  it('с сессией ничего не отправляет сам: код уходит только по «Войти»', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { code: 'oqa_code' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { openCallback } = render(USER);
    expect(container.textContent).toContain('Аккаунт owner@example.test');
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => button('Войти').click());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/app-code');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('authorization')).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual({ challenge: CHALLENGE });
    expect(openCallback).toHaveBeenCalledWith(
      `openqareer://signed-in?code=oqa_code&state=${STATE}`,
    );
    expect(container.textContent).toContain('Можно вернуться в приложение.');
    expect(container.innerHTML).not.toContain('oqa_code');
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/']);
    act(() => button('Открыть приложение').click());
    expect(openCallback).toHaveBeenCalledTimes(2);
    expect(openCallback).toHaveBeenLastCalledWith(
      `openqareer://signed-in?code=oqa_code&state=${STATE}`,
    );
  });

  it('отладочная сборка — своя схема openqareer-dev://, чужое значение client — отказ', async () => {
    window.history.replaceState(null, '', `/app-sign-in${QUERY}&client=dev`);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ data: { code: 'oqa_dev' } }), { status: 200 }),
      ),
    );
    const { openCallback } = render(USER);
    await act(async () => button('Войти').click());
    expect(openCallback).toHaveBeenCalledWith(
      `openqareer-dev://signed-in?code=oqa_dev&state=${STATE}`,
    );
    expect(readAppSignInRequest(`${QUERY}&client=evil`)).toBeNull();
    expect(
      appSignInReturnPath(`?from=app-sign-in&challenge=${CHALLENGE}&state=${STATE}&client=dev`),
    ).toBe(`/app-sign-in${QUERY}&client=dev`);
  });

  it('«Отмена» возвращает в приложение без кода', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { openCallback } = render(USER);
    act(() => button('Отмена').click());
    expect(openCallback).toHaveBeenCalledWith(`openqareer://signed-in?error=cancel&state=${STATE}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('отказ сервера — строка ошибки, приложение не открывается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    const { openCallback } = render(USER);
    await act(async () => button('Войти').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось войти');
    expect(openCallback).not.toHaveBeenCalled();
  });

  it('без входа на сайте ведёт на вход и обратно сюда же', () => {
    const { onNavigate } = render(null);
    expect(onNavigate).toHaveBeenCalledWith(
      `/login?from=app-sign-in&challenge=${CHALLENGE}&state=${STATE}`,
    );
    expect(appSignInReturnPath(`?from=app-sign-in&challenge=${CHALLENGE}&state=${STATE}`)).toBe(
      `/app-sign-in${QUERY}`,
    );
  });

  it('неверные параметры — без кнопки «Войти»', () => {
    window.history.replaceState(null, '', '/app-sign-in?challenge=short&state=x');
    render(USER);
    expect(button('Войти')).toBeUndefined();
    expect(readAppSignInRequest('?challenge=short&state=x')).toBeNull();
    expect(appSignInReturnPath('?from=app-sign-in&challenge=short')).toBeNull();
  });
});
