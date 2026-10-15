import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_EXPERT_PREFERENCE_KEY,
  expertPanelOpenOnWidthChange,
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

  it('collapses the consultant when the window narrows below the desktop width', () => {
    expect(expertPanelOpenOnWidthChange(false)).toBe(false);
  });

  it('reopens it on a wide window unless the candidate closed it on purpose', () => {
    expect(expertPanelOpenOnWidthChange(true)).toBe(true);
    store.set(DESKTOP_EXPERT_PREFERENCE_KEY, 'open');
    expect(expertPanelOpenOnWidthChange(true)).toBe(true);
    store.set(DESKTOP_EXPERT_PREFERENCE_KEY, 'closed');
    expect(expertPanelOpenOnWidthChange(true)).toBe(false);
  });
});
