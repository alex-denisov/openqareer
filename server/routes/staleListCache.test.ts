import { describe, expect, it, vi } from 'vitest';
import { createStaleListCache } from './staleListCache';

const WINDOW = 60_000;
const MAX_AGE = 300_000;

function deferred<V>() {
  let resolve!: (value: V) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<V>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const clock = { now: 0 };
  const cache = createStaleListCache<string>({
    windowMs: WINDOW,
    maxAgeMs: MAX_AGE,
    now: () => clock.now,
  });
  return { clock, cache };
}
const at = (data = 'd1', choice = 'c1') => ({ candidateId: 'cand', choice, data });

describe('list window: an expired list answers at once, a new one is built behind it (PRB-041)', () => {
  it('builds once for parallel first reads and serves that list inside the window', async () => {
    const { cache } = setup();
    const build = vi.fn(async () => 'list');
    const [first, second] = await Promise.all([cache.read(at(), build), cache.read(at(), build)]);
    expect(first).toEqual({ value: 'list', served: 'built' });
    expect(second).toEqual({ value: 'list', served: 'built' });
    expect(await cache.read(at(), build)).toEqual({ value: 'list', served: 'fresh' });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('past the window answers with the old list without waiting, one rebuild at a time', async () => {
    const { clock, cache } = setup();
    await cache.read(at(), async () => 'old');
    clock.now = WINDOW + 1;
    const gate = deferred<string>();
    const build = vi.fn(() => gate.promise);
    expect(await cache.read(at(), build)).toEqual({ value: 'old', served: 'stale' });
    expect(await cache.read(at(), build)).toEqual({ value: 'old', served: 'stale' });
    expect(build).toHaveBeenCalledTimes(1);
    gate.resolve('new');
    await settle();
    expect(await cache.read(at(), build)).toEqual({ value: 'new', served: 'fresh' });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('new pool data serves the old list and rebuilds behind it, even inside the window', async () => {
    const { cache } = setup();
    await cache.read(at('d1'), async () => 'old');
    const gate = deferred<string>();
    const read = await cache.read(at('d2'), () => gate.promise);
    expect(read).toEqual({ value: 'old', served: 'stale' });
    gate.resolve('new');
    await settle();
    expect(await cache.read(at('d2'), async () => 'unused')).toEqual({ value: 'new', served: 'fresh' });
  });

  it('a candidate choice never sees the old list: the read waits for its own', async () => {
    const { cache } = setup();
    await cache.read(at('d1', 'c1'), async () => 'old');
    const read = await cache.read(at('d1', 'c2'), async () => 'mine');
    expect(read).toEqual({ value: 'mine', served: 'built' });
  });

  it('the old list stops being served at the age limit: the read waits for a new one', async () => {
    const { clock, cache } = setup();
    await cache.read(at(), async () => 'old');
    clock.now = MAX_AGE;
    const read = await cache.read(at(), async () => 'new');
    expect(read).toEqual({ value: 'new', served: 'built' });
  });

  it('a later page keeps the list its read began with and starts no rebuild', async () => {
    const { clock, cache } = setup();
    await cache.read(at('d1'), async () => 'began');
    clock.now = WINDOW + 1;
    const build = vi.fn(async () => 'new');
    const read = await cache.read(at('d2'), build, { continuing: true });
    expect(read).toEqual({ value: 'began', served: 'stale' });
    expect(build).not.toHaveBeenCalled();
  });

  it('a later page past the age limit does not keep the old list either', async () => {
    const { clock, cache } = setup();
    await cache.read(at(), async () => 'began');
    clock.now = MAX_AGE + 1;
    const read = await cache.read(at(), async () => 'new', { continuing: true });
    expect(read).toEqual({ value: 'new', served: 'built' });
  });

  it('a failed rebuild keeps the old list until the age limit and is reported', async () => {
    const { clock, cache } = setup();
    await cache.read(at(), async () => 'old');
    clock.now = WINDOW + 1;
    const onRebuildFailed = vi.fn();
    const failure = new Error('rebuild failed');
    const read = await cache.read(at(), () => Promise.reject(failure), { onRebuildFailed });
    expect(read.value).toBe('old');
    await settle();
    expect(onRebuildFailed).toHaveBeenCalledWith(failure);
    expect((await cache.read(at(), async () => 'retried')).value).toBe('old');
    await settle();
    expect((await cache.read(at(), async () => 'unused')).value).toBe('retried');
  });

  it('a foreground failure reaches the reader and the next read builds again', async () => {
    const { cache } = setup();
    await expect(cache.read(at(), () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(await cache.read(at(), async () => 'list')).toEqual({ value: 'list', served: 'built' });
  });

  it('a slow older build does not overwrite the list of a newer choice', async () => {
    const { clock, cache } = setup();
    const slow = deferred<string>();
    const pending = cache.read(at('d1', 'c1'), () => slow.promise);
    clock.now = 10;
    await cache.read(at('d1', 'c2'), async () => 'newer');
    slow.resolve('older');
    await pending;
    expect(await cache.read(at('d1', 'c2'), async () => 'unused')).toEqual({
      value: 'newer',
      served: 'fresh',
    });
  });

  it('reports a finished rebuild, but not a build the reader waited for', async () => {
    const { clock, cache } = setup();
    const onRebuilt = vi.fn();
    await cache.read(at(), async () => 'old', { onRebuilt });
    expect(onRebuilt).not.toHaveBeenCalled();
    clock.now = WINDOW + 1;
    await cache.read(at(), async () => 'new', { onRebuilt });
    await settle();
    expect(onRebuilt).toHaveBeenCalledWith('new');
  });

  it('keeps one list per candidate', async () => {
    const { cache } = setup();
    await cache.read(at('d1', 'c1'), async () => 'one');
    await cache.read({ candidateId: 'other', choice: 'c1', data: 'd1' }, async () => 'two');
    await cache.read(at('d1', 'c2'), async () => 'three');
    expect(cache.size()).toBe(2);
  });
});

describe('a list built ahead of the reader (PRB-041)', () => {
  it('stores the list, and a read inside the window gets it without a build', async () => {
    const { cache } = setup();
    await cache.warm(at(), async () => 'warmed');

    const compute = vi.fn(async () => 'read');
    expect(await cache.read(at(), compute)).toEqual({ value: 'warmed', served: 'fresh' });
    expect(compute).not.toHaveBeenCalled();
  });

  it('leaves a reader on another choice their list until it ages out', async () => {
    const { clock, cache } = setup();
    await cache.read(at('d1', 'filtered'), async () => 'filtered');

    const compute = vi.fn(async () => 'default');
    await cache.warm(at('d1', 'default'), compute);
    expect(compute).not.toHaveBeenCalled();

    clock.now = MAX_AGE;
    await cache.warm(at('d1', 'default'), compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
