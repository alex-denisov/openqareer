import { describe, expect, it, vi } from 'vitest';
import { MatchedPoolSnapshots } from './matchedPoolSnapshot';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Страницы одного чтения обязаны приходить из одного снимка.
 *
 * Кабинет читает пул шестьюдесятью запросами (PRB-023). Пересчитывать подбор
 * на каждый из них — это, во-первых, шестьдесят проходов по всему пулу
 * (замер на проде `1e2436e`: круг вырос с 1.2 с до 3.4 с, и параллельное
 * чтение съело почти весь выигрыш), а во-вторых — сдвиг смещений, если между
 * страницами прошёл опрос площадок.
 */
describe('MatchedPoolSnapshots', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;

  it('второй запрос того же чтения не пересчитывает подбор', () => {
    const snapshots = new MatchedPoolSnapshots();
    let computed = 0;
    const compute = () => {
      computed += 1;
      return [item('a'), item('b')];
    };
    const first = snapshots.read('cand-1', 'профиль-1', compute);
    const second = snapshots.read('cand-1', 'профиль-1', compute);
    expect(computed).toBe(1);
    expect(second).toBe(first);
  });

  it('peek reads a hot snapshot without computing (B251, S4: /today never recomputes the pool)', () => {
    const snapshots = new MatchedPoolSnapshots();
    let computed = 0;
    const compute = () => {
      computed += 1;
      return [item('a')];
    };
    expect(snapshots.peek('cand-1', 'профиль-1')).toBeUndefined();
    const items = snapshots.read('cand-1', 'профиль-1', compute);
    expect(snapshots.peek('cand-1', 'профиль-1')).toBe(items);
    expect(computed).toBe(1);
  });

  it('peek returns undefined once the snapshot expired', () => {
    let now = 0;
    const snapshots = new MatchedPoolSnapshots({ ttlMs: 10, clock: () => now });
    snapshots.read('cand-1', 'профиль-1', () => [item('a')]);
    now = 11;
    expect(snapshots.peek('cand-1', 'профиль-1')).toBeUndefined();
  });

  it('изменившийся профиль кандидата считается заново', () => {
    const snapshots = new MatchedPoolSnapshots();
    let computed = 0;
    const compute = () => {
      computed += 1;
      return [item('a')];
    };
    snapshots.read('cand-1', 'профиль-1', compute);
    snapshots.read('cand-1', 'профиль-2', compute);
    expect(computed).toBe(2);
  });

  it('снимок живёт отведённое время, а не вечно', () => {
    let now = 1_000;
    const snapshots = new MatchedPoolSnapshots({ ttlMs: 500, clock: () => now });
    let computed = 0;
    const compute = () => {
      computed += 1;
      return [item('a')];
    };
    snapshots.read('cand-1', 'профиль-1', compute);
    now += 499;
    snapshots.read('cand-1', 'профиль-1', compute);
    expect(computed).toBe(1);
    now += 2;
    snapshots.read('cand-1', 'профиль-1', compute);
    expect(computed).toBe(2);
  });

  it('снимки разных кандидатов не смешиваются', () => {
    const snapshots = new MatchedPoolSnapshots();
    const first = snapshots.read('cand-1', 'профиль', () => [item('a')]);
    const second = snapshots.read('cand-2', 'профиль', () => [item('b')]);
    expect(first[0].cluster.id).toBe('a');
    expect(second[0].cluster.id).toBe('b');
  });

  it('invalidates shared vacancy snapshots for every candidate, including in-flight reads', async () => {
    const snapshots = new MatchedPoolSnapshots();
    let finishOldRead!: (items: MatchedVacancyItem[]) => void;
    const oldRead = snapshots.readAsync(
      'cand-1',
      'profile',
      () => new Promise((resolve) => (finishOldRead = resolve)),
    );
    await Promise.resolve();
    snapshots.read('cand-2', 'profile', () => [item('stale-two')]);

    snapshots.invalidateAll();
    const refreshed = await snapshots.readAsync('cand-2', 'profile', async () => [
      item('fresh-two'),
    ]);
    finishOldRead([item('stale-one')]);
    await oldRead;

    expect(snapshots.peek('cand-2', 'profile')).toBe(refreshed);
    expect(snapshots.peek('cand-1', 'profile')).toBeUndefined();
    expect(refreshed[0]?.cluster.id).toBe('fresh-two');
  });

  it('память не растёт без предела: старые снимки вытесняются', () => {
    let now = 0;
    const snapshots = new MatchedPoolSnapshots({ maxEntries: 2, clock: () => now });
    snapshots.read('cand-1', 'профиль', () => [item('a')]);
    now += 1;
    snapshots.read('cand-2', 'профиль', () => [item('b')]);
    now += 1;
    snapshots.read('cand-3', 'профиль', () => [item('c')]);
    expect(snapshots.size).toBe(2);
    let recomputed = 0;
    snapshots.read('cand-1', 'профиль', () => {
      recomputed += 1;
      return [item('a')];
    });
    expect(recomputed).toBe(1);
  });

  it('coalesces concurrent role and vacancy reads while keeping candidate scope', async () => {
    const snapshots = new MatchedPoolSnapshots();
    let resolve!: (items: MatchedVacancyItem[]) => void;
    let calls = 0;
    const compute = () => {
      calls++;
      return new Promise<MatchedVacancyItem[]>((done) => {
        resolve = done;
      });
    };
    const first = snapshots.readAsync('one', 'profile', compute);
    const second = snapshots.readAsync('one', 'profile', compute);
    const other = snapshots.readAsync('two', 'profile', async () => [item('private-two')]);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolve([item('private-one')]);
    expect(await first).toBe(await second);
    expect((await other)[0].cluster.id).toBe('private-two');
  });

  it('does not cache failures or expire a snapshot before its computation completes', async () => {
    let now = 0;
    const snapshots = new MatchedPoolSnapshots({ ttlMs: 10, clock: () => now });
    await expect(
      snapshots.readAsync('one', 'profile', async () => {
        throw new Error('unavailable');
      }),
    ).rejects.toThrow('unavailable');
    const first = await snapshots.readAsync('one', 'profile', async () => {
      now = 100;
      return [item('one')];
    });
    expect(await snapshots.readAsync('one', 'profile', async () => [item('wrong')])).toBe(first);
    expect(
      (await snapshots.readAsync('one', 'changed', async () => [item('changed')]))[0].cluster.id,
    ).toBe('changed');
  });
});

/**
 * PRB-041 (prod 03.11): the first read after the 10-minute window waited 5–6 s for the rebuild.
 * Offsets landed on it at random; the event loop was free, the reader was not.
 */
describe('MatchedPoolSnapshots: an expired snapshot is served while it rebuilds', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;
  const TEN = 10 * 60_000;
  const TWENTY = 20 * 60_000;
  const turn = () => new Promise((resolve) => setImmediate(resolve));

  function stored(now: { value: number }, log?: (error: unknown) => void) {
    const snapshots = new MatchedPoolSnapshots({
      ttlMs: TEN,
      clock: () => now.value,
      ...(log ? { onRebuildFailed: log } : {}),
    });
    return { snapshots, first: snapshots.readAsync('one', 'profile', async () => [item('old')]) };
  }

  it('serves the old snapshot at once and starts exactly one rebuild', async () => {
    const now = { value: 0 };
    const { snapshots, first } = stored(now);
    const old = await first;
    now.value = TEN + 1;
    let finish!: (items: MatchedVacancyItem[]) => void;
    const rebuild = vi.fn(() => new Promise<MatchedVacancyItem[]>((done) => (finish = done)));

    expect(await snapshots.readAsync('one', 'profile', rebuild)).toBe(old);
    expect(await snapshots.readAsync('one', 'profile', rebuild)).toBe(old);
    await turn();
    expect(rebuild).toHaveBeenCalledTimes(1);

    finish([item('new')]);
    await turn();
    const next = await snapshots.readAsync('one', 'profile', rebuild);
    expect(next[0]?.cluster.id).toBe('new');
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('a changed profile key never gets the old snapshot', async () => {
    const now = { value: 0 };
    const { snapshots, first } = stored(now);
    await first;
    now.value = TEN + 1;

    const changed = await snapshots.readAsync('one', 'changed', async () => [item('changed')]);

    expect(changed[0]?.cluster.id).toBe('changed');
  });

  it('a snapshot of 20 minutes or older is rebuilt on the read', async () => {
    const now = { value: 0 };
    const { snapshots, first } = stored(now);
    await first;
    now.value = TWENTY;

    const read = await snapshots.readAsync('one', 'profile', async () => [item('rebuilt')]);

    expect(read[0]?.cluster.id).toBe('rebuilt');
  });

  it('another candidate storing a snapshot does not evict an expired one still being served', async () => {
    const now = { value: 0 };
    const { snapshots, first } = stored(now);
    const old = await first;
    now.value = TEN + 1;
    await snapshots.readAsync('two', 'profile', async () => [item('two')]);

    expect(await snapshots.readAsync('one', 'profile', async () => [item('new')])).toBe(old);
  });

  it('a failed rebuild is logged, the old snapshot stays and the next read tries again', async () => {
    const now = { value: 0 };
    const log = vi.fn();
    const { snapshots, first } = stored(now, log);
    const old = await first;
    now.value = TEN + 1;
    const failure = new Error('pool busy');

    expect(await snapshots.readAsync('one', 'profile', () => Promise.reject(failure))).toBe(old);
    await turn();
    expect(log).toHaveBeenCalledWith(failure);

    const retry = vi.fn(async () => [item('new')]);
    expect(await snapshots.readAsync('one', 'profile', retry)).toBe(old);
    await turn();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a caller that asks to wait gets the rebuilt snapshot, as the precompute round does', async () => {
    const now = { value: 0 };
    const { snapshots, first } = stored(now);
    await first;
    now.value = TEN + 1;

    const read = await snapshots.readAsync('one', 'profile', async () => [item('new')], {
      awaitRebuild: true,
    });

    expect(read[0]?.cluster.id).toBe('new');
  });

  it('a pool write during a rebuild keeps its result out, as with any in-flight read', async () => {
    const now = { value: 0 };
    const { snapshots, first } = stored(now);
    await first;
    now.value = TEN + 1;
    let finish!: (items: MatchedVacancyItem[]) => void;
    await snapshots.readAsync('one', 'profile', () => new Promise((done) => (finish = done)));
    await turn();

    snapshots.invalidateAll();
    finish([item('before-write')]);
    await turn();

    const read = await snapshots.readAsync('one', 'profile', async () => [item('after-write')]);
    expect(read[0]?.cluster.id).toBe('after-write');
  });
});
