import { describe, expect, it } from 'vitest';
import { shouldHandleInApp, type ClickLike } from './siteLinkClick';

describe('shouldHandleInApp', () => {
  const baseEvent: ClickLike = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it('returns true for a standard left click with no modifiers', () => {
    expect(shouldHandleInApp(baseEvent)).toBe(true);
  });

  it('returns false when default is already prevented', () => {
    expect(shouldHandleInApp({ ...baseEvent, defaultPrevented: true })).toBe(false);
  });

  it('returns false for non-primary mouse buttons', () => {
    expect(shouldHandleInApp({ ...baseEvent, button: 1 })).toBe(false);
    expect(shouldHandleInApp({ ...baseEvent, button: 2 })).toBe(false);
  });

  it('returns false when metaKey is pressed', () => {
    expect(shouldHandleInApp({ ...baseEvent, metaKey: true })).toBe(false);
  });

  it('returns false when ctrlKey is pressed', () => {
    expect(shouldHandleInApp({ ...baseEvent, ctrlKey: true })).toBe(false);
  });

  it('returns false when shiftKey is pressed', () => {
    expect(shouldHandleInApp({ ...baseEvent, shiftKey: true })).toBe(false);
  });

  it('returns false when altKey is pressed', () => {
    expect(shouldHandleInApp({ ...baseEvent, altKey: true })).toBe(false);
  });
});
