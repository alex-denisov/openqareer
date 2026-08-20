import { describe, expect, it } from 'vitest';
import { resolvedDesktopSessionPath } from './desktopSessionRouting';

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
