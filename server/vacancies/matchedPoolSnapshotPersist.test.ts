import { describe, expect, it, vi } from 'vitest';
import {
  MatchedPoolSnapshots,
  type MatchedSnapshotStore,
  type PersistedMatchedSnapshot,
} from './matchedPoolSnapshot';
import { VacancyMatchUnavailable } from './vacancyMatchReader';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Prod 19.11: the first selection read of the day took 45 s. One candidate's pool query read
 * 2.5 GB of pages; on a 32 GB database with 7.9 GB of memory they leave the page cache within
 * minutes, and the reader was killed at 12 s, so the snapshot was never built and every screen
 * reading the selection got 503 `vacancy_match_busy`.
 */
const item = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;
const TWENTY = 20 * 60_000;
const turn = () => new Promise((resolve) => setImmediate(resolve));

function memoryStore(
  initial?: { candidateId: string; profileKey: string } & PersistedMatchedSnapshot,
) {
  const rows = new Map<string, { profileKey: string } & PersistedMatchedSnapshot>();
  if (initial) rows.set(initial.candidateId, initial);
  const store: MatchedSnapshotStore & { rows: typeof rows } = {
    rows,
    read: vi.fn((candidateId: string, profileKey: string) => {
      const row = rows.get(candidateId);
      return row && row.profileKey === profileKey
        ? { items: row.items, storedAt: row.storedAt }
        : null;
    }),
    write: vi.fn((candidateId: string, profileKey: string, snapshot: PersistedMatchedSnapshot) => {
      rows.set(candidateId, { profileKey, ...snapshot });
    }),
    delete: vi.fn((candidateId: string) => {
      rows.delete(candidateId);
    }),
    keys: vi.fn((candidateId: string) => {
      const row = rows.get(candidateId);
      return row ? [row.profileKey] : [];
    }),
  };
  return store;
}

describe('MatchedPoolSnapshots: the reader waits a bounded time, the build does not stop', () => {
  it('a slow first build answers a typed refusal in time, keeps running, and the retry gets it', async () => {
    const snapshots = new MatchedPoolSnapshots({ waitMs: 5 });
    let finish!: (items: MatchedVacancyItem[]) => void;
    const compute = vi.fn(() => new Promise<MatchedVacancyItem[]>((done) => (finish = done)));

    const refused = await snapshots
      .readAsync('one', 'profile', compute)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(VacancyMatchUnavailable);
    expect((refused as VacancyMatchUnavailable).message).toBe('vacancy_match_timeout');

    finish([item('built')]);
    await turn();
    const read = await snapshots.readAsync('one', 'profile', compute);
    expect(read[0]?.cluster.id).toBe('built');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('a background pass that asks to wait is not cut by the reader budget', async () => {
    const snapshots = new MatchedPoolSnapshots({ waitMs: 1 });
    const compute = () =>
      new Promise<MatchedVacancyItem[]>((done) => setTimeout(() => done([item('slow')]), 20));

    const read = await snapshots.readAsync('one', 'profile', compute, { awaitRebuild: true });

    expect(read[0]?.cluster.id).toBe('slow');
  });

  it('B770: a reader that names its own wait refuses after it, and the build goes on for the retry', async () => {
    const snapshots = new MatchedPoolSnapshots({ waitMs: 60_000 });
    let finish!: (items: MatchedVacancyItem[]) => void;
    const compute = vi.fn(() => new Promise<MatchedVacancyItem[]>((done) => (finish = done)));
    const started = performance.now();

    const refused = await snapshots
      .readAsync('one', 'role', compute, { waitMs: 5 })
      .catch((error: unknown) => error);

    expect((refused as VacancyMatchUnavailable).message).toBe('vacancy_match_timeout');
    expect(performance.now() - started).toBeLessThan(1_000);
    finish([item('built')]);
    await turn();
    expect((await snapshots.readAsync('one', 'role', compute))[0]?.cluster.id).toBe('built');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('an old snapshot past 20 minutes is served after the short stale budget, not after the full one', async () => {
    const now = { value: 0 };
    const snapshots = new MatchedPoolSnapshots({
      clock: () => now.value,
      waitMs: 60_000,
      staleWaitMs: 5,
    });
    const old = await snapshots.readAsync('one', 'profile', async () => [item('old')]);
    now.value = TWENTY;
    const started = performance.now();

    const read = await snapshots.readAsync('one', 'profile', () => new Promise(() => undefined));

    expect(read).toBe(old);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('MatchedPoolSnapshots: a snapshot outlives the process', () => {
  it('a new process answers from the stored snapshot at once and rebuilds behind it', async () => {
    const now = { value: 10 * 60_000 + 1 };
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'profile',
      items: [item('stored')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots({ clock: () => now.value });
    snapshots.setStore(store);
    let finish!: (items: MatchedVacancyItem[]) => void;
    const rebuild = vi.fn(() => new Promise<MatchedVacancyItem[]>((done) => (finish = done)));

    const read = await snapshots.readAsync('one', 'profile', rebuild);

    expect(read[0]?.cluster.id).toBe('stored');
    await turn();
    expect(rebuild).toHaveBeenCalledTimes(1);
    finish([item('fresh')]);
    await turn();
    await turn();
    expect(store.rows.get('one')?.items[0]?.cluster.id).toBe('fresh');
    expect(store.rows.get('one')?.storedAt).toBe(now.value);
  });

  it('a stored snapshot past 20 minutes is served at once after a deploy, rebuilt behind', async () => {
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'profile',
      items: [item('stored')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots({ clock: () => 30 * 60_000, staleWaitMs: 60_000 });
    snapshots.setStore(store);
    const rebuild = vi.fn(() => new Promise<MatchedVacancyItem[]>(() => undefined));
    const started = performance.now();

    expect((await snapshots.readAsync('one', 'profile', rebuild))[0]?.cluster.id).toBe('stored');
    expect(performance.now() - started).toBeLessThan(1_000);
    await turn();
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('a fresh stored snapshot is served without any rebuild', async () => {
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'profile',
      items: [item('stored')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots({ clock: () => 60_000 });
    snapshots.setStore(store);
    const compute = vi.fn(async () => [item('new')]);

    expect((await snapshots.readAsync('one', 'profile', compute))[0]?.cluster.id).toBe('stored');
    await turn();
    expect(compute).not.toHaveBeenCalled();
  });

  it('a stored snapshot of another profile is never served', async () => {
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'old-profile',
      items: [item('stored')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots({ clock: () => 60_000 });
    snapshots.setStore(store);

    const read = await snapshots.readAsync('one', 'new-profile', async () => [item('new')]);

    expect(read[0]?.cluster.id).toBe('new');
  });

  it('a stored snapshot from the day before answers within the stale budget', async () => {
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'profile',
      items: [item('yesterday')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots({ clock: () => 24 * 60 * 60_000, staleWaitMs: 5 });
    snapshots.setStore(store);

    const read = await snapshots.readAsync('one', 'profile', () => new Promise(() => undefined));

    expect(read[0]?.cluster.id).toBe('yesterday');
  });

  it('a changed campaign drops the stored snapshot too', () => {
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'profile',
      items: [item('stored')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots();
    snapshots.setStore(store);

    snapshots.deleteCandidate('one');

    expect(store.delete).toHaveBeenCalledWith('one');
  });

  it('a store that fails to read or write leaves the selection working', async () => {
    const failures: unknown[] = [];
    const broken: MatchedSnapshotStore = {
      read: () => {
        throw new Error('database is locked');
      },
      write: () => {
        throw new Error('database is locked');
      },
      delete: () => undefined,
      keys: () => [],
    };
    const snapshots = new MatchedPoolSnapshots({
      onRebuildFailed: (error) => failures.push(error),
    });
    snapshots.setStore(broken);

    const read = await snapshots.readAsync('one', 'profile', async () => [item('new')]);
    await turn();

    expect(read[0]?.cluster.id).toBe('new');
    expect(failures).toHaveLength(2);
  });
});

describe('MatchedPoolSnapshots: a new process loads the stored snapshots before the first read', () => {
  it('preloads every stored profile of a candidate, so the read does not open the store', async () => {
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'role-cto',
      items: [item('cto')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots({ clock: () => 60_000 });
    snapshots.setStore(store);

    expect(await snapshots.preload(['one', 'nobody'])).toBe(1);
    vi.mocked(store.read).mockClear();
    const compute = vi.fn(async () => [item('new')]);

    expect((await snapshots.readAsync('one', 'role-cto', compute))[0]?.cluster.id).toBe('cto');
    expect(store.read).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
  });

  it('does not replace a snapshot the process already holds', async () => {
    const store = memoryStore({
      candidateId: 'one',
      profileKey: 'profile',
      items: [item('stored')],
      storedAt: 0,
    });
    const snapshots = new MatchedPoolSnapshots({ clock: () => 60_000 });
    await snapshots.readAsync('one', 'profile', async () => [item('held')]);
    snapshots.setStore(store);

    expect(await snapshots.preload(['one'])).toBe(0);
    expect(
      (await snapshots.readAsync('one', 'profile', async () => [item('x')]))[0]?.cluster.id,
    ).toBe('held');
  });
});

describe('MatchedPoolSnapshots: a miss says why (B770)', () => {
  function storeWith(keys: string[]): MatchedSnapshotStore {
    return { read: () => null, write: () => undefined, delete: () => undefined, keys: () => keys };
  }

  it('a reader with no snapshot logs whether its key was stored and how many seals there are', async () => {
    const snapshots = new MatchedPoolSnapshots({ waitMs: 1 });
    const misses: unknown[] = [];
    snapshots.setStore(storeWith(['other', 'role']));
    snapshots.setMissLog((miss) => misses.push(miss));
    await snapshots
      .readAsync('one', 'role', () => new Promise(() => undefined))
      .catch(() => undefined);
    await snapshots
      .readAsync('one', 'fresh', () => new Promise(() => undefined))
      .catch(() => undefined);
    expect(misses).toEqual([
      { candidateId: 'one', keyInStore: true, seals: 2 },
      { candidateId: 'one', keyInStore: false, seals: 2 },
    ]);
  });

  it('the warm pass and a reader with a snapshot log nothing', async () => {
    const snapshots = new MatchedPoolSnapshots();
    const misses: unknown[] = [];
    snapshots.setMissLog((miss) => misses.push(miss));
    await snapshots.readAsync('one', 'role', async () => [item('a')], { awaitRebuild: true });
    await snapshots.readAsync('one', 'role', async () => [item('b')]);
    expect(misses).toEqual([]);
  });
});
