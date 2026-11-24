import { describe, expect, it, vi } from 'vitest';
import { RoleContextCache } from './roleAssessmentContextCache';

describe('RoleContextCache', () => {
  it('builds a role context once per snapshot and role version', async () => {
    const cache = new RoleContextCache<string>();
    const snapshot = {};
    const build = vi.fn(() => 'context');

    await cache.read(snapshot, 'cto\u00001', build);
    await cache.read(snapshot, 'cto\u00001', build);
    await cache.read(snapshot, 'cto\u00002', build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it('a rebuilt snapshot and an expired entry are built again', async () => {
    let now = 0;
    const cache = new RoleContextCache<string>(1_000, () => now);
    const build = vi.fn(() => 'context');
    const snapshot = {};

    await cache.read(snapshot, 'cto', build);
    await cache.read({}, 'cto', build);
    now = 1_000;
    await cache.read(snapshot, 'cto', build);

    expect(build).toHaveBeenCalledTimes(3);
  });

  it('B775: a settled context lives as long as its snapshot; an unsettled one expires', async () => {
    let now = 0;
    const cache = new RoleContextCache<string>(1_000, () => now);
    const build = vi.fn(() => 'context');
    const snapshot = {};

    await cache.read(snapshot, 'cto', build, () => true);
    await cache.read(snapshot, 'coo', build, () => false);
    now = 10_000_000;
    await cache.read(snapshot, 'cto', build, () => true);
    await cache.read(snapshot, 'coo', build, () => false);

    expect(build).toHaveBeenCalledTimes(3);
  });

  it('B770: a second reader waits for the build under way; a failed one is built again', async () => {
    const cache = new RoleContextCache<string>();
    const snapshot = {};
    let finish: (value: string) => void = () => undefined;
    const build = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));

    const reads = [cache.read(snapshot, 'cto', build), cache.read(snapshot, 'cto', build)];
    finish('context');
    expect(await Promise.all(reads)).toEqual(['context', 'context']);
    expect(build).toHaveBeenCalledTimes(1);

    const failing = async () => Promise.reject(new Error('read failed'));
    await expect(cache.read(snapshot, 'coo', failing)).rejects.toThrow('read failed');
    expect(await cache.read(snapshot, 'coo', async () => 'again')).toBe('again');
  });
});
