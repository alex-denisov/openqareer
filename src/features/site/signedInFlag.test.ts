// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN_ATTRIBUTE,
  ROLE_FLAG_KEY,
  SIGNED_IN_ATTRIBUTE,
  SIGNED_IN_FLAG_KEY,
  rememberSignedIn,
} from './signedInFlag';

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

  it('remembers the admin role and clears it on sign-out (B575)', () => {
    rememberSignedIn(true, 'admin');
    expect(window.localStorage.getItem(ROLE_FLAG_KEY)).toBe('admin');
    expect(document.documentElement.hasAttribute(ADMIN_ATTRIBUTE)).toBe(true);
    rememberSignedIn(true, 'candidate');
    expect(window.localStorage.getItem(ROLE_FLAG_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute(ADMIN_ATTRIBUTE)).toBe(false);
    rememberSignedIn(true, 'admin');
    rememberSignedIn(false);
    expect(window.localStorage.getItem(SIGNED_IN_FLAG_KEY)).toBeNull();
    expect(window.localStorage.getItem(ROLE_FLAG_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute(ADMIN_ATTRIBUTE)).toBe(false);
  });
});
