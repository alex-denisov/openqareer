// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { OPEN_VIEW_EVENT } from '../desktopNotify/openViewEvent';
import { openProfileView } from './openProfileView';

describe('openProfileView', () => {
  it('closes the trainer, then asks the shell to open «Профиль»', () => {
    const calls: string[] = [];
    const close = vi.fn(() => calls.push('close'));
    const listener = vi.fn((event: Event) => {
      calls.push((event as CustomEvent<{ view: string }>).detail.view);
    });
    window.addEventListener(OPEN_VIEW_EVENT, listener);
    openProfileView(close);
    window.removeEventListener(OPEN_VIEW_EVENT, listener);
    expect(calls).toEqual(['close', 'profile']);
  });
});
