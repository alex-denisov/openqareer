// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../coach/coachApi';
import { BrowserSignInButton } from './BrowserSignInButton';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Partial<React.ComponentProps<typeof BrowserSignInButton>>) =>
  act(() => root.render(<BrowserSignInButton onSignedIn={vi.fn()} available {...props} />));

describe('B755: «Войти через браузер» в приложении', () => {
  it('на сайте кнопки нет', () => {
    render({ available: false });
    expect(container.querySelector('button')).toBeNull();
  });

  it('вход через лист передаёт пользователя дальше', async () => {
    const onSignedIn = vi.fn();
    const user = { username: 'candidate.test' } as AuthUser;
    render({ onSignedIn, signIn: async () => user });
    await act(async () => container.querySelector('button')!.click());
    expect(onSignedIn).toHaveBeenCalledWith(user);
  });

  it('закрытый лист — ни входа, ни ошибки; сбой — строка ошибки', async () => {
    const onSignedIn = vi.fn();
    render({ onSignedIn, signIn: async () => null });
    await act(async () => container.querySelector('button')!.click());
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    render({ onSignedIn, signIn: async () => Promise.reject(new Error('x')) });
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось войти');
  });
});
