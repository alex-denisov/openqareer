import { useCallback, useEffect, useState } from 'react';

/** B649: тема нового кабинета. Светлая по умолчанию; «system» следует за устройством. */
export const B640_THEMES = ['light', 'dark', 'system'] as const;
export type B640Theme = (typeof B640_THEMES)[number];

export const B640_THEME_KEY = 'oq_b640_theme';
const DEFAULT_THEME: B640Theme = 'light';

function isTheme(value: unknown): value is B640Theme {
  return typeof value === 'string' && (B640_THEMES as readonly string[]).includes(value);
}

export function readStoredTheme(): B640Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(B640_THEME_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function storeTheme(theme: B640Theme): void {
  try {
    window.localStorage.setItem(B640_THEME_KEY, theme);
  } catch {
    // Хранилище закрыто: тема действует до перезагрузки.
  }
}

export interface B640ThemeState {
  readonly theme: B640Theme;
  readonly setTheme: (theme: B640Theme) => void;
}

export function useB640Theme(): B640ThemeState {
  const [theme, setThemeState] = useState<B640Theme>(readStoredTheme);
  const setTheme = useCallback((next: B640Theme) => {
    storeTheme(next);
    setThemeState(next);
  }, []);
  return { theme, setTheme };
}

/**
 * Фон за пределами корня (прокрутка «с резинкой», полоса прокрутки) берётся из
 * темы нового кабинета, пока он открыт. Стиль ставится через CSSOM: атрибут
 * `style` в разметке запрещён политикой страницы.
 */
export function useDocumentTheme(root: HTMLElement | null, theme: B640Theme): void {
  useEffect(() => {
    if (!root) return undefined;
    const page = document.documentElement;
    const apply = () => {
      const styles = window.getComputedStyle(root);
      page.style.backgroundColor = styles.backgroundColor;
      page.style.colorScheme = styles.colorScheme;
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
      page.style.removeProperty('background-color');
      page.style.removeProperty('color-scheme');
    };
  }, [root, theme]);
}
