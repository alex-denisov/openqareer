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

  constructor(
    private readonly ttlMs = CONTEXT_TTL_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  read(snapshot: object, key: string, build: () => T, settled: (value: T) => boolean = () => false): T {
    const now = this.clock();
    const known = this.bySnapshot.get(snapshot) ?? new Map<string, Cached<T>>();
    const cached = known.get(key);
    if (cached && (cached.settled || now - cached.at < this.ttlMs)) return cached.value;
    const value = build();
    known.set(key, { at: now, value, settled: settled(value) });
    this.bySnapshot.set(snapshot, known);
    return value;
  }
}
