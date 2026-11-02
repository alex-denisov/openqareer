import type { DatabaseSync } from 'node:sqlite';

/**
 * The decrypted candidate snapshot, kept while the database is unchanged.
 *
 * Prod CPU profile 02.11: getSnapshot took 12 of 20 busy seconds. One
 * matched-vacancies page opened the same dossier several times, and the client
 * reads the pool as ~25 pages. `total_changes()` moves on every write through
 * this connection and `PRAGMA data_version` on every commit by another one, so
 * any write anywhere drops every kept snapshot. A snapshot is shared: callers
 * must not change it. Reads inside a transaction are never kept.
 */
export class SnapshotMemo<T> {
  private readonly kept = new Map<string, T>();
  private version = '';

  constructor(private readonly database: DatabaseSync) {}

  read(candidateId: string, load: () => T): T {
    // Inside a transaction the snapshot may hold writes a rollback will undo.
    if (this.database.isTransaction) return load();
    const version = this.currentVersion();
    if (version !== this.version) {
      this.kept.clear();
      this.version = version;
    }
    const hit = this.kept.get(candidateId);
    if (hit !== undefined) return hit;
    const snapshot = load();
    // A write during load (lazy migration, repair) means the result may be older than the data.
    if (this.currentVersion() === version) this.kept.set(candidateId, snapshot);
    return snapshot;
  }

  private currentVersion(): string {
    const local = this.database.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    const shared = this.database.prepare('PRAGMA data_version').get() as { data_version: number };
    return `${local.changes}:${shared.data_version}`;
  }
}
