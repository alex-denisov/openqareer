import { describe, expect, it } from 'vitest';
import {
  desktopSessionFailureRequiresSignOut,
  resolvedDesktopSessionPath,
} from './desktopSessionRouting';

describe('resolvedDesktopSessionPath', () => {
  it('returns an expired desktop workspace session to login', () => {
    expect(resolvedDesktopSessionPath('/app', false)).toBe('/login');
  });

  it('returns an authenticated desktop session to the workspace', () => {
    expect(resolvedDesktopSessionPath('/login', true)).toBe('/app');
  });

  it('does not rewrite unrelated routes', () => {
    expect(resolvedDesktopSessionPath('/signup', false)).toBeUndefined();
  });
});

describe('desktopSessionFailureRequiresSignOut', () => {
  it('keeps the token for a temporary network failure', () => {
    expect(desktopSessionFailureRequiresSignOut(true, 'network_error')).toBe(false);
  });

  it('clears the token only for an explicit expired-session response', () => {
    expect(desktopSessionFailureRequiresSignOut(true, 'http_401')).toBe(true);
    expect(desktopSessionFailureRequiresSignOut(true, 'session_expired')).toBe(true);
  });

  it('never signs out a browser session through the desktop-only guard', () => {
    expect(desktopSessionFailureRequiresSignOut(false, 'http_401')).toBe(false);
  });
});
