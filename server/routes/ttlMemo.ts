/**
 * One value rebuilt at most once per window. The sitemap read takes ~2 s of
 * the event loop on the prod pool; crawlers ask for it repeatedly (B535).
 * A failed build is not kept, so the next request tries again.
 */
export interface TtlMemo<T> {
  get(build: () => T): T;
}

export function createTtlMemo<T>(ttlMs: number, now: () => number = Date.now): TtlMemo<T> {
  let entry: { value: T; builtAt: number } | null = null;
  return {
    get(build) {
      const time = now();
      if (entry && time - entry.builtAt < ttlMs) return entry.value;
      const value = build();
      entry = { value, builtAt: time };
      return value;
    },
  };
}
