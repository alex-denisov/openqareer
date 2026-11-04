import { describe, expect, it, vi } from 'vitest';
import { MatchedPoolSnapshots } from './matchedPoolSnapshot';
import { VacancyMatchUnavailable } from './vacancyMatchReader';
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

  it('a read that has to wait gets the old snapshot when the pool read fails, even past 20 minutes', async () => {
    const now = { value: 0 };
    const log = vi.fn();
    const { snapshots, first } = stored(now, log);
    const old = await first;
    now.value = TWENTY;
    const failure = new VacancyMatchUnavailable('vacancy_match_timeout', 12_000, 1);

    expect(await snapshots.readAsync('one', 'profile', () => Promise.reject(failure))).toBe(old);
    expect(log).toHaveBeenCalledWith(failure);
  });

  it('readers joined to a failing rebuild all get the old snapshot', async () => {
    const now = { value: 0 };
    const { snapshots, first } = stored(now);
    const old = await first;
    now.value = TWENTY;
    let fail!: (error: Error) => void;
    const compute = () => new Promise<MatchedVacancyItem[]>((_, reject) => (fail = reject));

    const reads = [
      snapshots.readAsync('one', 'profile', compute),
      snapshots.readAsync('one', 'profile', compute),
    ];
    await turn();
    fail(new VacancyMatchUnavailable('vacancy_match_timeout', 12_000, 2));

    expect(await Promise.all(reads)).toEqual([old, old]);
  });

  it('with no snapshot at all the failure reaches the reader, and the next read tries again', async () => {
    const now = { value: 0 };
    const snapshots = new MatchedPoolSnapshots({ clock: () => now.value });
    const failure = new VacancyMatchUnavailable('vacancy_match_timeout', 12_000, 1);

    await expect(
      snapshots.readAsync('one', 'profile', () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    const read = await snapshots.readAsync('one', 'profile', async () => [item('new')]);
    expect(read[0]?.cluster.id).toBe('new');
  });

  it('a full queue gives the old snapshot too, and a typed refusal without one', async () => {
    const now = { value: 0 };
    const snapshots = new MatchedPoolSnapshots({ maxEntries: 1, clock: () => now.value });
    const old = await snapshots.readAsync('one', 'profile', async () => [item('old')]);
    now.value = TWENTY;
    void snapshots.readAsync('two', 'profile', () => new Promise(() => undefined));
    await turn();

    expect(await snapshots.readAsync('one', 'profile', async () => [item('new')])).toBe(old);
    await expect(
      snapshots.readAsync('three', 'profile', async () => [item('new')]),
    ).rejects.toBeInstanceOf(VacancyMatchUnavailable);
  });
});

/**
 * PRB-041 (prod 04.11): one candidate's text preload wiped the snapshots of all six active
 * candidates, so the next read of each waited 7–8 s, and nothing old was left to serve.
 */
describe('MatchedPoolSnapshots: a shared text write marks snapshots stale', () => {
  const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;
  const TEN = 10 * 60_000;
  const FIVE = 5 * 60_000;
  const turn = () => new Promise((resolve) => setImmediate(resolve));

  async function stored(now: { value: number }) {
    const snapshots = new MatchedPoolSnapshots({
      ttlMs: TEN,
      minStaleRebuildMs: FIVE,
      clock: () => now.value,
    });
    await snapshots.readAsync('one', 'profile', async () => [item('old')]);
    return snapshots;
  }

  it('keeps serving the snapshot without a rebuild until the minimum interval passed', async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);
    const compute = vi.fn(async () => [item('new')]);

    snapshots.markAllStale();
    now.value = FIVE - 1;
    const read = await snapshots.readAsync('one', 'profile', compute);
    await turn();

    expect(read[0]?.cluster.id).toBe('old');
    expect(compute).not.toHaveBeenCalled();
  });

  it('past the interval serves the old snapshot at once and rebuilds it behind the read', async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);
    const compute = vi.fn(async () => [item('new')]);

    snapshots.markAllStale();
    now.value = FIVE;
    const read = await snapshots.readAsync('one', 'profile', compute);
    expect(read[0]?.cluster.id).toBe('old');
    await turn();

    expect(compute).toHaveBeenCalledTimes(1);
    expect(snapshots.peek('one', 'profile')?.[0]?.cluster.id).toBe('new');
  });

  it('writes in a row cost one rebuild per interval, not one per write', async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);
    const compute = vi.fn(async () => [item('new')]);

    for (let minute = 1; minute <= 9; minute += 1) {
      now.value = minute * 60_000;
      snapshots.markAllStale();
      await snapshots.readAsync('one', 'profile', compute);
      await turn();
    }

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('a snapshot not marked stale is not rebuilt before its own window ends', async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);
    const compute = vi.fn(async () => [item('new')]);

    now.value = TEN - 1;
    await snapshots.readAsync('one', 'profile', compute);
    await turn();

    expect(compute).not.toHaveBeenCalled();
  });

  it('the 20-minute limit still holds: a marked snapshot that old is rebuilt on the read', async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);

    snapshots.markAllStale();
    now.value = 20 * 60_000;
    const read = await snapshots.readAsync('one', 'profile', async () => [item('new')]);

    expect(read[0]?.cluster.id).toBe('new');
  });

  it('a write during a rebuild leaves its result stale: the next interval reads the write', async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);
    now.value = TEN + 1;
    let finish!: (items: MatchedVacancyItem[]) => void;
    await snapshots.readAsync('one', 'profile', () => new Promise((done) => (finish = done)));
    await turn();

    snapshots.markAllStale();
    finish([item('before-write')]);
    await turn();

    const compute = vi.fn(async () => [item('after-write')]);
    expect((await snapshots.readAsync('one', 'profile', compute))[0]?.cluster.id).toBe(
      'before-write',
    );
    now.value = TEN + 1 + FIVE;
    await snapshots.readAsync('one', 'profile', compute);
    await turn();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('the /today peek keeps a marked snapshot: no empty queue because a text landed', async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);

    snapshots.markAllStale();

    expect(snapshots.peek('one', 'profile')?.[0]?.cluster.id).toBe('old');
  });

  it("a candidate's own action still reads fresh, marked or not", async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);

    snapshots.markAllStale();
    snapshots.deleteCandidate('one');
    const read = await snapshots.readAsync('one', 'profile', async () => [item('own-edit')]);

    expect(read[0]?.cluster.id).toBe('own-edit');
  });

  it("a rebuild already running never lands over a candidate's own action", async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);
    now.value = TEN + 1;
    let finish!: (items: MatchedVacancyItem[]) => void;
    await snapshots.readAsync('one', 'profile', () => new Promise((done) => (finish = done)));
    await turn();

    snapshots.deleteCandidate('one');
    const read = await snapshots.readAsync('one', 'profile', async () => [item('own-edit')]);
    finish([item('before-edit')]);
    await turn();

    expect(read[0]?.cluster.id).toBe('own-edit');
    expect(snapshots.peek('one', 'profile')?.[0]?.cluster.id).toBe('own-edit');
  });

  it("another candidate's own action leaves this candidate's snapshot alone", async () => {
    const now = { value: 0 };
    const snapshots = await stored(now);

    snapshots.deleteCandidate('two');

    expect(snapshots.peek('one', 'profile')?.[0]?.cluster.id).toBe('old');
  });
});
