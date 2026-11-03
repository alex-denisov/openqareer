import type { DatabaseSync } from 'node:sqlite';

/**
 * How long a kept snapshot outlives commits made through other connections.
 *
 * Prod CPU profile 03.11: the fit queue, sessions and the mechanics worker commit every second
 * through their own connections, so a memo dropped on any commit re-read and decrypted the dossier
 * on every `/fit` call and every sweep chunk — 11.5 of 40 busy seconds, runs up to 2.2 s. The
 * snapshot tables are written only through the web process's candidate store connection; a
 * foreign commit (a worker's start-up migration) is seen within this window. Opt-in per store.
 */
export const FOREIGN_COMMIT_GRACE_MS = 15_000;

interface Kept<T> {
  readonly snapshot: T;
  readonly readAt: number;
  readonly sharedVersion: number;
}

/**
 * The decrypted candidate snapshot, kept while the database is unchanged.
 *
 * Prod CPU profile 02.11: getSnapshot took 12 of 20 busy seconds. One
 * matched-vacancies page opened the same dossier several times, and the client
 * reads the pool as ~25 pages. `total_changes()` moves on every write through
 * this connection and drops every kept snapshot at once; `PRAGMA data_version`
 * moves on every commit by another one and drops the snapshots read more than
 * `foreignCommitGraceMs` ago (0 by default: at once). A snapshot is shared: callers must not
 * change it. Reads inside a transaction are never kept.
 */
export class SnapshotMemo<T> {
  private readonly kept = new Map<string, Kept<T>>();
  private localVersion = -1;

  private readonly graceMs: number;
  private readonly now: () => number;

  constructor(
    private readonly database: DatabaseSync,
    options: { readonly foreignCommitGraceMs?: number; readonly now?: () => number } = {},
  ) {
    this.graceMs = options.foreignCommitGraceMs ?? 0;
    this.now = options.now ?? Date.now;
  }

  read(candidateId: string, load: () => T): T {
    // Inside a transaction the snapshot may hold writes a rollback will undo.
    if (this.database.isTransaction) return load();
    const { local, shared } = this.currentVersion();
    if (local !== this.localVersion) this.kept.clear();
    this.localVersion = local;
    const hit = this.kept.get(candidateId);
    if (hit && (hit.sharedVersion === shared || this.now() - hit.readAt < this.graceMs)) {
      return hit.snapshot;
    }
    this.kept.delete(candidateId);
    const snapshot = load();
    // A write during load (lazy migration, repair) means the result may be older than the data.
    if (this.currentVersion().local === local) {
      this.kept.set(candidateId, { snapshot, readAt: this.now(), sharedVersion: shared });
    }
    return snapshot;
  }

  private currentVersion(): { local: number; shared: number } {
    const local = this.database.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    const shared = this.database.prepare('PRAGMA data_version').get() as { data_version: number };
    return { local: local.changes, shared: shared.data_version };
  }
}
