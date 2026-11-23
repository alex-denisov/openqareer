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

  it('B775: a settled context lives as long as its snapshot; an unsettled one expires', () => {
    let now = 0;
    const cache = new RoleContextCache<string>(1_000, () => now);
    const build = vi.fn(() => 'context');
    const snapshot = {};

    cache.read(snapshot, 'cto', build, () => true);
    cache.read(snapshot, 'coo', build, () => false);
    now = 10_000_000;
    cache.read(snapshot, 'cto', build, () => true);
    cache.read(snapshot, 'coo', build, () => false);

    expect(build).toHaveBeenCalledTimes(3);
  });
});
