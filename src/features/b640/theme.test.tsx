// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
const desktop = vi.hoisted(() => ({
  isTauriEnvironment: vi.fn(() => false),
  invokeDesktopCommand: vi.fn(async () => undefined),
}));
vi.mock('../../services/desktop/desktopBridge', () => desktop);

import {
  B640_THEME_KEY,
  B640_THEMES,
  readStoredTheme,
  useB640Theme,
  useDocumentTheme,
  type B640Theme,
  type B640ThemeState,
} from './theme';

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

describe('B593: фон окна приложения до загрузки страницы', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    desktop.isTauriEnvironment.mockReturnValue(false);
  });

  it('приложение запоминает действующую тему и каждую смену', async () => {
    desktop.isTauriEnvironment.mockReturnValue(true);
    const view = probe(async () => null);
    expect(desktop.invokeDesktopCommand).toHaveBeenLastCalledWith('save_window_theme', { theme: 'light' });
    act(() => view.state.current?.setTheme('dark'));
    expect(desktop.invokeDesktopCommand).toHaveBeenLastCalledWith('save_window_theme', { theme: 'dark' });
    await settle();
    view.unmount();
  });

  it('в браузере команд приложению нет', async () => {
    const view = probe(async () => null);
    await settle();
    expect(desktop.invokeDesktopCommand).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('B593: цвет полосы браузера (theme-color) по действующей теме', () => {
  function mediaStub() {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
    return { fire: () => listeners.forEach((listener) => listener()) };
  }

  function mount(root: HTMLElement, theme: B640Theme) {
    const host = document.createElement('div');
    const react = createRoot(host);
    function Probe({ value }: { readonly value: B640Theme }) {
      useDocumentTheme(root, value);
      return null;
    }
    act(() => react.render(<Probe value={theme} />));
    return {
      rerender: (value: B640Theme) => act(() => react.render(<Probe value={value} />)),
      unmount: () => act(() => react.unmount()),
    };
  }

  it('полоса браузера берёт фон кабинета, следует за сменой темы и системы, после выхода — прежняя', () => {
    const media = mediaStub();
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#090d12';
    document.head.append(meta);
    const root = document.createElement('div');
    document.body.append(root);
    root.style.backgroundColor = 'rgb(250, 251, 251)';
    const view = mount(root, 'light');
    expect(meta.content).toBe('rgb(250, 251, 251)');
    root.style.backgroundColor = 'rgb(20, 24, 28)';
    view.rerender('dark');
    expect(meta.content).toBe('rgb(20, 24, 28)');
    view.rerender('system');
    root.style.backgroundColor = 'rgb(250, 251, 251)';
    act(() => media.fire());
    expect(meta.content).toBe('rgb(250, 251, 251)');
    view.unmount();
    expect(meta.content).toBe('#090d12');
    meta.remove();
    root.remove();
  });

  it('B593: признак первого кадра на <html> следует за темой кабинета и снимается после выхода', () => {
    mediaStub();
    const page = document.documentElement;
    page.setAttribute('data-oq-theme', 'light');
    const root = document.createElement('div');
    document.body.append(root);
    root.style.colorScheme = 'dark';
    const view = mount(root, 'dark');
    expect(page.getAttribute('data-oq-theme')).toBe('dark');
    root.style.colorScheme = 'light';
    view.rerender('light');
    expect(page.getAttribute('data-oq-theme')).toBe('light');
    view.unmount();
    expect(page.hasAttribute('data-oq-theme')).toBe(false);
    root.remove();
  });
});
