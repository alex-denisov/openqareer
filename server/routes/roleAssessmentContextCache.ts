/**
 * Prod 19.11 (B645 s09): a role's assessment context read the requirements of every vacancy of
 * its snapshot, 300–400 ms on the event loop; «Карьера» asks for eleven roles at once. One
 * context per snapshot and role version, for a short while: a rebuilt snapshot is a new object.
 */
const CONTEXT_TTL_MS = 2 * 60_000;

interface Cached<T> {
  readonly at: number;
  readonly value: T;
  /** B775: a settled context changes only with its snapshot, so it does not expire. */
  readonly settled: boolean;
}

export class RoleContextCache<T> {
  private readonly bySnapshot = new WeakMap<object, Map<string, Cached<T>>>();
  /** B770: a build runs in slices, so a second reader waits for the one under way. */
  private readonly underWay = new WeakMap<object, Map<string, Promise<T>>>();

  constructor(
    private readonly ttlMs = CONTEXT_TTL_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  async read(
    snapshot: object,
    key: string,
    build: () => T | Promise<T>,
    settled: (value: T) => boolean = () => false,
  ): Promise<T> {
    const now = this.clock();
    const known = this.bySnapshot.get(snapshot) ?? new Map<string, Cached<T>>();
    const cached = known.get(key);
    if (cached && (cached.settled || now - cached.at < this.ttlMs)) return cached.value;
    const builds = this.underWay.get(snapshot) ?? new Map<string, Promise<T>>();
    this.underWay.set(snapshot, builds);
    const started = builds.get(key);
    if (started) return started;
    const building = this.build(snapshot, key, build, settled).finally(() => builds.delete(key));
    builds.set(key, building);
    return building;
  }

  private async build(
    snapshot: object,
    key: string,
    build: () => T | Promise<T>,
    settled: (value: T) => boolean,
  ): Promise<T> {
    const value = await build();
    const known = this.bySnapshot.get(snapshot) ?? new Map<string, Cached<T>>();
    known.set(key, { at: this.clock(), value, settled: settled(value) });
    this.bySnapshot.set(snapshot, known);
    return value;
  }
}
