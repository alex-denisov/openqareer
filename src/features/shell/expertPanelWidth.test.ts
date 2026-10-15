import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_EXPERT_PREFERENCE_KEY,
  expertPanelOpenOnWidthChange,
  initialExpertPanelOpen,
} from './CareerWorkspaceShellHelpers';

describe('expertPanelOpenOnWidthChange', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts folded for both migrated closed and explicit strip preferences', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    for (const preference of ['closed', 'strip']) {
      store.set(DESKTOP_EXPERT_PREFERENCE_KEY, preference);
      expect(initialExpertPanelOpen(true, 'today')).toBe(false);
    }
  });

  it('collapses the consultant when the window narrows below the desktop width', () => {
    expect(expertPanelOpenOnWidthChange(false)).toBe(false);
  });

  it('reopens it on a wide window unless the candidate closed it on purpose', () => {
    expect(expertPanelOpenOnWidthChange(true)).toBe(true);
    store.set(DESKTOP_EXPERT_PREFERENCE_KEY, 'open');
    expect(expertPanelOpenOnWidthChange(true)).toBe(true);
    store.set(DESKTOP_EXPERT_PREFERENCE_KEY, 'strip');
    expect(expertPanelOpenOnWidthChange(true)).toBe(false);
    store.set(DESKTOP_EXPERT_PREFERENCE_KEY, 'closed');
    expect(expertPanelOpenOnWidthChange(true)).toBe(false);
  });
});

describe('initialExpertPanelOpen while the session is still being checked', () => {
  const stubWidth = (width: number) =>
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
      matchMedia: (query: string) => {
        const min = /min-width: (\d+)px/.exec(query);
        const max = /max-width: (\d+)px/.exec(query);
        return {
          matches: min ? width >= Number(min[1]) : max ? width <= Number(max[1]) : false,
        };
      },
    });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the panel open on a wide desktop window', () => {
    stubWidth(1440);
    expect(initialExpertPanelOpen(true, 'today')).toBe(true);
  });

  it('keeps the panel folded on a narrowed desktop window such as 1176 px', () => {
    stubWidth(1176);
    expect(initialExpertPanelOpen(true, 'today')).toBe(false);
  });

  it('starts in a strip on narrow desktop even on vacancies', () => {
    stubWidth(1024);
    expect(initialExpertPanelOpen(false, 'opportunities')).toBe(false);
  });

  it('keeps the phone sheet behaviour untouched', () => {
    stubWidth(390);
    expect(initialExpertPanelOpen(true, 'today')).toBe(true);
  });
});
