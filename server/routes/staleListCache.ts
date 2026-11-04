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

function createListBuilder<V>(entries: Map<string, Entry<V>>, now: () => number): BuildList<V> {
  const building = new Map<string, Promise<V>>();
  return (address, compute) => {
    const key = `${address.candidateId}|${address.choice}|${address.data}`;
    const running = building.get(key);
    if (running) return running;
    const startedAt = now();
    const work = compute()
      .then((value) => {
        const held = entries.get(address.candidateId);
        // An older build that finished late must not replace what a newer read stored.
        if (!held || held.at <= startedAt) {
          entries.set(address.candidateId, { ...address, at: startedAt, value });
        }
        return value;
      })
      .finally(() => building.delete(key));
    building.set(key, work);
    return work;
  };
}

/**
 * PRB-041 (prod 04.11): the list window expired under a reader, who waited 1.3 s for a rebuild that
 * also held the event loop. Same scheme as the pool snapshot (#379): the old list answers at once
 * and the new one is built behind it, one build per key. Only what the candidate chose decides
 * whether the old list may answer; pool data and landed percents never make a reader wait.
 * One list per candidate: memory does not grow with filter changes.
 */
export function createStaleListCache<V>(options: {
  readonly windowMs: number;
  readonly maxAgeMs: number;
  readonly now?: () => number;
}) {
  const { windowMs, maxAgeMs, now = () => Date.now() } = options;
  const entries = new Map<string, Entry<V>>();
  const build = createListBuilder(entries, now);
  const rebuildingBehind = new Set<string>();

  const rebuildBehind = (
    address: StaleListAddress,
    compute: () => Promise<V>,
    { onRebuilt, onRebuildFailed }: ReadOptions<V>,
  ): void => {
    if (rebuildingBehind.has(address.candidateId)) return;
    rebuildingBehind.add(address.candidateId);
    void build(address, compute)
      .then((value) => onRebuilt?.(value))
      .catch((error: unknown) => onRebuildFailed?.(error))
      .finally(() => rebuildingBehind.delete(address.candidateId));
  };

  return {
    async read(
      address: StaleListAddress,
      compute: () => Promise<V>,
      readOptions: ReadOptions<V> = {},
    ): Promise<{ readonly value: V; readonly served: StaleListServed }> {
      const held = entries.get(address.candidateId);
      const age = held ? now() - held.at : 0;
      if (!held || held.choice !== address.choice || age >= maxAgeMs) {
        return { value: await build(address, compute), served: 'built' };
      }
      if (held.data === address.data && age < windowMs) return { value: held.value, served: 'fresh' };
      if (!readOptions.continuing) rebuildBehind(address, compute, readOptions);
      return { value: held.value, served: 'stale' };
    },
    size: () => entries.size,
  };
}
