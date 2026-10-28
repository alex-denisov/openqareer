// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SIGNED_IN_ATTRIBUTE, SIGNED_IN_FLAG_KEY, rememberSignedIn } from './signedInFlag';

describe('signed-in header hint (B574)', () => {
  afterEach(() => rememberSignedIn(false));

  it('keeps the flag for the next load and marks this page at once', () => {
    rememberSignedIn(true);
    expect(window.localStorage.getItem(SIGNED_IN_FLAG_KEY)).toBe('1');
    expect(document.documentElement.hasAttribute(SIGNED_IN_ATTRIBUTE)).toBe(true);
    rememberSignedIn(false);
    expect(window.localStorage.getItem(SIGNED_IN_FLAG_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute(SIGNED_IN_ATTRIBUTE)).toBe(false);
  });
});
