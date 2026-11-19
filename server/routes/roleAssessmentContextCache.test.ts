import { describe, expect, it, vi } from 'vitest';
import { RoleContextCache } from './roleAssessmentContextCache';

describe('RoleContextCache', () => {
  it('builds a role context once per snapshot and role version', () => {
    const cache = new RoleContextCache<string>();
    const snapshot = {};
    const build = vi.fn(() => 'context');

    cache.read(snapshot, 'cto\u00001', build);
    cache.read(snapshot, 'cto\u00001', build);
    cache.read(snapshot, 'cto\u00002', build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it('a rebuilt snapshot and an expired entry are built again', () => {
    let now = 0;
    const cache = new RoleContextCache<string>(1_000, () => now);
    const build = vi.fn(() => 'context');
    const snapshot = {};

    cache.read(snapshot, 'cto', build);
    cache.read({}, 'cto', build);
    now = 1_000;
    cache.read(snapshot, 'cto', build);

    expect(build).toHaveBeenCalledTimes(3);
  });
});
