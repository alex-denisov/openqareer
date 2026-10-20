import { describe, expect, it } from 'vitest';
import { createTtlMemo } from './ttlMemo';

describe('createTtlMemo', () => {
  it('builds once inside the window and again after it expires', () => {
    let now = 1_000;
    let builds = 0;
    const memo = createTtlMemo<string>(900_000, () => now);
    const build = () => `xml-${++builds}`;

    expect(memo.get(build)).toBe('xml-1');
    now += 899_999;
    expect(memo.get(build)).toBe('xml-1');
    now += 1;
    expect(memo.get(build)).toBe('xml-2');
    expect(builds).toBe(2);
  });

  it('does not keep a failed build', () => {
    const memo = createTtlMemo<string>(900_000, () => 0);
    expect(() =>
      memo.get(() => {
        throw new Error('pool not ready');
      }),
    ).toThrow('pool not ready');
    expect(memo.get(() => 'xml')).toBe('xml');
  });
});
