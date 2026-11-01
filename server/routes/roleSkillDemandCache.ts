/**
 * Per-candidate cache of the role skill demand (B591). The profile block must
 * open at once, and one role's selection read costs 8–30 s on prod, so a
 * request never waits for it: it gets the last result (refreshed in the
 * background once older than the TTL) or `pending` while the first one runs.
 */
export type CachedRead<T> =
  { readonly state: 'pending' } | { readonly state: 'ready'; readonly value: T };

interface Entry<T> {
  readonly key: string;
  readonly computedAt: number;
  readonly value: T;
}

export class RoleSkillDemandCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly running = new Map<string, string>();

  constructor(
    private readonly compute: (roles: readonly string[], candidateId: string) => Promise<T>,
    private readonly options: { readonly ttlMs: number; readonly now?: () => number },
  ) {}

  read(candidateId: string, roles: readonly string[]): CachedRead<T> {
    const key = JSON.stringify(roles);
    const entry = this.entries.get(candidateId);
    const current = entry?.key === key ? entry : undefined;
    if (!current || this.now() - current.computedAt >= this.options.ttlMs) {
      this.refresh(candidateId, roles, key);
    }
    return current ? { state: 'ready', value: current.value } : { state: 'pending' };
  }

  invalidate(candidateId: string): void {
    this.entries.delete(candidateId);
  }

  private refresh(candidateId: string, roles: readonly string[], key: string): void {
    if (this.running.get(candidateId) === key) return;
    this.running.set(candidateId, key);
    void this.compute(roles, candidateId)
      .then(
        (value) => {
          if (this.running.get(candidateId) === key) {
            this.entries.set(candidateId, { key, computedAt: this.now(), value });
          }
        },
        (error: unknown) => {
          console.warn(
            'role skill demand compute failed',
            error instanceof Error ? error.message : error,
          );
        },
      )
      .finally(() => {
        if (this.running.get(candidateId) === key) this.running.delete(candidateId);
      });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
