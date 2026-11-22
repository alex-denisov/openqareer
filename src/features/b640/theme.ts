import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * `readServerTheme` (B593): выбор кандидата, общий для его устройств. Пришёл — тема
 * этого устройства становится им; выбор на экране раньше ответа сервера остаётся,
 * нет ответа — остаётся сохранённая здесь.
 */
export function useB640Theme(readServerTheme?: () => Promise<B640Theme | null>): B640ThemeState {
  const [theme, setThemeState] = useState<B640Theme>(readStoredTheme);
  const chosenHere = useRef(false);
  const setTheme = useCallback((next: B640Theme) => {
    chosenHere.current = true;
    storeTheme(next);
    setThemeState(next);
  }, []);
  useEffect(() => {
    if (!readServerTheme) return undefined;
    let active = true;
    readServerTheme().then(
      (server) => {
        if (!active || chosenHere.current || !isTheme(server)) return;
        storeTheme(server);
        setThemeState(server);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [readServerTheme]);
  return { theme, setTheme };
}

/**
 * Фон за пределами корня (прокрутка «с резинкой», полоса прокрутки) берётся из
 * темы нового кабинета, пока он открыт. Стиль ставится через CSSOM: атрибут
 * `style` в разметке запрещён политикой страницы.
 */
/**
 * Цвет в виде, который понимает `theme-color` любого браузера: точка на холсте
 * переводит oklch в rgb; без холста (тесты, старые движки) — как есть.
 */
function barColor(color: string): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return color;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${red}, ${green}, ${blue})`;
  } catch {
    return color;
  }
}

export function useDocumentTheme(root: HTMLElement | null, theme: B640Theme): void {
  useEffect(() => {
    if (!root) return undefined;
    const page = document.documentElement;
    // Полоса браузера на телефоне (index.html задаёт тёмную) — по действующей теме кабинета.
    const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const barBefore = bar?.content ?? null;
    const apply = () => {
      const styles = window.getComputedStyle(root);
      page.style.backgroundColor = styles.backgroundColor;
      page.style.colorScheme = styles.colorScheme;
      if (bar && styles.backgroundColor) bar.content = barColor(styles.backgroundColor);
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
      page.style.removeProperty('background-color');
      page.style.removeProperty('color-scheme');
      if (bar && barBefore !== null) bar.content = barBefore;
    };
  }, [root, theme]);
}
