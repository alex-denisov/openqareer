/** Where a list belongs: `choice` is what the candidate decided, `data` what the pool and sweep produced. */
export interface StaleListAddress {
  readonly candidateId: string;
  readonly choice: string;
  readonly data: string;
}

export type StaleListServed = 'fresh' | 'stale' | 'built';

interface ReadOptions<V> {
  /** A later page of a read that already began: it keeps its list and starts no rebuild. */
  readonly continuing?: boolean;
  readonly onRebuilt?: (value: V) => void;
  readonly onRebuildFailed?: (error: unknown) => void;
}

interface Entry<V> {
  readonly choice: string;
  readonly data: string;
  readonly at: number;
  readonly value: V;
}

type BuildList<V> = (address: StaleListAddress, compute: () => Promise<V>) => Promise<V>;

/**
 * B770 (prod 23.11): s07 «Вакансии по роли» and s09 read two choices of one candidate in turn, and
 * one list per candidate rebuilt each on every switch: 4-5 s, 40 of 41 slow reads of a night.
 * A few choices per candidate stay; memory grows with them, not with every filter ever tried.
 */
export const CHOICES_PER_CANDIDATE = 4;

type Lists<V> = Map<string, readonly Entry<V>[]>;

const entryOf = <V>(lists: Lists<V>, address: Pick<StaleListAddress, 'candidateId' | 'choice'>) =>
  lists.get(address.candidateId)?.find((entry) => entry.choice === address.choice);

/** The entry goes first: the one read longest ago is the one a full candidate drops. */
function withFirst<V>(lists: Lists<V>, entry: Entry<V>, candidateId: string): void {
  const others = (lists.get(candidateId) ?? []).filter((held) => held.choice !== entry.choice);
  lists.set(candidateId, [entry, ...others].slice(0, CHOICES_PER_CANDIDATE));
}

function createListBuilder<V>(lists: Lists<V>, now: () => number): BuildList<V> {
  const building = new Map<string, Promise<V>>();
  return (address, compute) => {
    const key = `${address.candidateId}|${address.choice}|${address.data}`;
    const running = building.get(key);
    if (running) return running;
    const startedAt = now();
    const work = compute()
      .then((value) => {
        const held = entryOf(lists, address);
        // An older build that finished late must not replace what a newer read stored.
        if (!held || held.at <= startedAt) {
          withFirst(lists, { ...address, at: startedAt, value }, address.candidateId);
        }
        return value;
      })
      .finally(() => building.delete(key));
    building.set(key, work);
    return work;
  };
}

/** One rebuild behind the old list per candidate and choice; its outcome goes to the read's hooks. */
function createRebuildBehind<V>(build: BuildList<V>) {
  const rebuilding = new Set<string>();
  return (address: StaleListAddress, compute: () => Promise<V>, options: ReadOptions<V>): void => {
    const key = `${address.candidateId}|${address.choice}`;
    if (rebuilding.has(key)) return;
    rebuilding.add(key);
    void build(address, compute)
      .then((value) => options.onRebuilt?.(value))
      .catch((error: unknown) => options.onRebuildFailed?.(error))
      .finally(() => rebuilding.delete(key));
  };
}

/** Every slot holds another choice still young enough to answer its reader. */
function fullOfOtherChoices<V>(
  lists: Lists<V>,
  address: StaleListAddress,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  const held = lists.get(address.candidateId) ?? [];
  return (
    held.length >= CHOICES_PER_CANDIDATE &&
    held.every((entry) => entry.choice !== address.choice && nowMs - entry.at < maxAgeMs)
  );
}

/**
 * PRB-041 (prod 04.11): the list window expired under a reader, who waited 1.3 s for a rebuild that
 * also held the event loop. Same scheme as the pool snapshot (#379): the old list answers at once
 * and the new one is built behind it, one build per key. Only what the candidate chose decides
 * whether the old list may answer; pool data and landed percents never make a reader wait.
 * Up to `CHOICES_PER_CANDIDATE` lists per candidate (B770).
 */
export function createStaleListCache<V>(options: {
  readonly windowMs: number;
  readonly maxAgeMs: number;
  readonly now?: () => number;
}) {
  const { windowMs, maxAgeMs, now = () => Date.now() } = options;
  const lists: Lists<V> = new Map();
  const build = createListBuilder(lists, now);
  const rebuildBehind = createRebuildBehind(build);
  const fullOfOthers = (address: StaleListAddress) =>
    fullOfOtherChoices(lists, address, now(), maxAgeMs);

  return {
    async read(
      address: StaleListAddress,
      compute: () => Promise<V>,
      readOptions: ReadOptions<V> = {},
    ): Promise<{ readonly value: V; readonly served: StaleListServed }> {
      const held = entryOf(lists, address);
      const age = held ? now() - held.at : 0;
      if (!held || age >= maxAgeMs) {
        return { value: await build(address, compute), served: 'built' };
      }
      withFirst(lists, held, address.candidateId);
      if (held.data === address.data && age < windowMs) return { value: held.value, served: 'fresh' };
      if (!readOptions.continuing) rebuildBehind(address, compute, readOptions);
      return { value: held.value, served: 'stale' };
    },
    /** A list built with no reader waiting; it takes no slot a reader's list still needs. */
    async warm(address: StaleListAddress, compute: () => Promise<V>): Promise<V | undefined> {
      if (fullOfOthers(address)) return undefined;
      return build(address, compute);
    },
    holds: (candidateId: string, choice: string) =>
      entryOf(lists, { candidateId, choice }) !== undefined,
    clear: () => lists.clear(),
    size: () => lists.size,
  };
}
