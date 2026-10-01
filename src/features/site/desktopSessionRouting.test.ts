import { describe, expect, it } from 'vitest';
import {
  desktopSessionFailureRequiresSignOut,
  resolvedDesktopSessionPath,
} from './desktopSessionRouting';

describe('resolvedDesktopSessionPath', () => {
  it('returns an expired desktop workspace session to login', () => {
    expect(resolvedDesktopSessionPath('/app', null)).toBe('/login');
  });

  it('returns an authenticated desktop session to the workspace', () => {
    expect(resolvedDesktopSessionPath('/login', { candidateId: 'c-1' })).toBe('/app');
  });

  it('keeps a signed-in administrator, who has no candidate profile, out of the login form', () => {
    const admin = { candidateId: null };
    expect(resolvedDesktopSessionPath('/login', admin)).toBe('/app');
    expect(resolvedDesktopSessionPath('/app', admin)).toBeUndefined();
  });

  it('does not rewrite unrelated routes', () => {
    expect(resolvedDesktopSessionPath('/signup', null)).toBeUndefined();
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
