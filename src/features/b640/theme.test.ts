// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { B640_THEME_KEY, B640_THEMES, readStoredTheme } from './theme';

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
