// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VacanciesScreen } from './VacanciesScreen';

describe('VacanciesScreen saved searches', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(min-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    act(() => root.unmount());
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('keeps the saved-search form mounted when results switch between loading, error and ready', async () => {
    const base = { matched: [], total: 0, subscriptions: [] } as const;
    await act(async () => {
      root.render(<VacanciesScreen {...base} />);
    });

    const createButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Новый запрос к площадке"]',
    );
    expect(createButton).not.toBeNull();
    await act(async () => createButton?.click());
    const queryInput = container.querySelector('.career-vacancy-saved input');
    expect(queryInput).not.toBeNull();

    for (const state of [
      { loading: true },
      { failed: true, failureSourceLabel: 'Remotive' },
      { loading: false, failed: false },
    ]) {
      await act(async () => {
        root.render(<VacanciesScreen {...base} {...state} />);
      });
      expect(container.querySelector('.career-vacancy-saved input')).toBe(queryInput);
    }
  });
});
