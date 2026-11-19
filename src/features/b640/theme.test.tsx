// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { B640_THEME_KEY, B640_THEMES, readStoredTheme, useB640Theme, type B640Theme, type B640ThemeState } from './theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('тема нового кабинета (B649)', () => {
  afterEach(() => window.localStorage.clear());

  it('по умолчанию светлая', () => {
    expect(readStoredTheme()).toBe('light');
  });

  it('читает сохранённый выбор: светлая, тёмная, системная', () => {
    expect([...B640_THEMES]).toEqual(['light', 'dark', 'system']);
    for (const theme of B640_THEMES) {
      window.localStorage.setItem(B640_THEME_KEY, theme);
      expect(readStoredTheme()).toBe(theme);
    }
  });

  it('чужое значение в хранилище не ломает тему', () => {
    window.localStorage.setItem(B640_THEME_KEY, 'neon');
    expect(readStoredTheme()).toBe('light');
  });
});

function probe(readServerTheme: () => Promise<B640Theme | null>) {
  const host = document.createElement('div');
  const root = createRoot(host);
  const state: { current: B640ThemeState | null } = { current: null };
  function Probe() {
    state.current = useB640Theme(readServerTheme);
    return null;
  }
  act(() => root.render(<Probe />));
  return { state, unmount: () => act(() => root.unmount()) };
}

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });

describe('B593: тема кандидата с сервера при запуске', () => {
  afterEach(() => window.localStorage.clear());

  it('applies the theme the candidate chose on another device and keeps it locally', async () => {
    const view = probe(async () => 'dark');
    expect(view.state.current?.theme).toBe('light');
    await settle();
    expect(view.state.current?.theme).toBe('dark');
    expect(window.localStorage.getItem(B640_THEME_KEY)).toBe('dark');
    view.unmount();
  });

  it('a choice made on this screen wins over a late server answer', async () => {
    let answer: (theme: B640Theme | null) => void = () => undefined;
    const view = probe(() => new Promise((done) => (answer = done)));
    act(() => view.state.current?.setTheme('system'));
    answer('dark');
    await settle();
    expect(view.state.current?.theme).toBe('system');
    view.unmount();
  });

  it('no server choice or a failed read keeps the local theme', async () => {
    window.localStorage.setItem(B640_THEME_KEY, 'dark');
    const empty = probe(async () => null);
    await settle();
    expect(empty.state.current?.theme).toBe('dark');
    empty.unmount();
    const failed = probe(() => Promise.reject(new Error('offline')));
    await settle();
    expect(failed.state.current?.theme).toBe('dark');
    failed.unmount();
  });
});
