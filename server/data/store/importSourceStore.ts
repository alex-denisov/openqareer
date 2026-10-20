import type { DatabaseSync } from 'node:sqlite';
import type { StoredNativeSourceConnection } from '../candidateStore';
import { withImportProvenance } from '../snapshotProvenance';
import type {
  ImportPlatform,
  ImportWalk,
  RecordedImportSource,
  SourcePlatform,
} from '../../domain/factProvenance';

/**
 * B541 — the platform and size of each import, and the last section walk per
 * source. New small tables only: CREATE TABLE IF NOT EXISTS, never ALTER
 * (the deploy health window is 20 s).
 */
export const IMPORT_SOURCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_import_sources (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'hh', 'file')),
  imported_at TEXT NOT NULL,
  fact_count INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, message_id)
);
CREATE TABLE IF NOT EXISTS candidate_import_walks (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'hh')),
  state TEXT NOT NULL CHECK (state IN ('running', 'done')),
  sections_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, platform)
);
`;

interface SourceRow {
  message_id: string;
  platform: ImportPlatform;
  imported_at: string;
  fact_count: number;
}

interface WalkRow {
  platform: SourcePlatform;
  state: ImportWalk['state'];
  sections_json: string;
  updated_at: string;
}

export class ImportSourceStore {
  // SQLite does not resolve `REFERENCES candidates` at creation, so the tables
  // can be created before the migrations that create `candidates` run.
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(IMPORT_SOURCE_SCHEMA);
  }

  /** No platform (an older caller) records nothing: provenance then reads the legacy label. */
  record(
    candidateId: string,
    platform: ImportPlatform | undefined,
    messageId: string,
    importedAt: string,
    factCount: number,
  ): void {
    if (!platform) return;
    this.database
      .prepare(
        `INSERT INTO candidate_import_sources
           (candidate_id, message_id, platform, imported_at, fact_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (candidate_id, message_id) DO UPDATE SET
           platform = excluded.platform,
           imported_at = excluded.imported_at,
           fact_count = excluded.fact_count`,
      )
      .run(candidateId, messageId, platform, importedAt, factCount);
  }

  list(candidateId: string): RecordedImportSource[] {
    const rows = this.database
      .prepare(
        `SELECT message_id, platform, imported_at, fact_count
           FROM candidate_import_sources WHERE candidate_id = ?`,
      )
      .all(candidateId) as unknown as SourceRow[];
    return rows.map((row) => ({
      messageId: row.message_id,
      platform: row.platform,
      importedAt: row.imported_at,
      factCount: row.fact_count,
    }));
  }

  saveWalk(candidateId: string, walk: ImportWalk): void {
    this.database
      .prepare(
        `INSERT INTO candidate_import_walks
           (candidate_id, platform, state, sections_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (candidate_id, platform) DO UPDATE SET
           state = excluded.state,
           sections_json = excluded.sections_json,
           updated_at = excluded.updated_at`,
      )
      .run(candidateId, walk.platform, walk.state, JSON.stringify(walk.sections), walk.updatedAt);
  }

  /** B541: the snapshot's sources with «N из M» and walk, and each fact with its origin. */
  withProvenance(
    candidateId: string,
    parts: Parameters<typeof withImportProvenance>[0],
    native: readonly StoredNativeSourceConnection[],
  ): ReturnType<typeof withImportProvenance> {
    return withImportProvenance(parts, {
      native,
      recorded: this.list(candidateId),
      walks: this.listWalks(candidateId),
    });
  }

  listWalks(candidateId: string): ImportWalk[] {
    const rows = this.database
      .prepare(
        `SELECT platform, state, sections_json, updated_at
           FROM candidate_import_walks WHERE candidate_id = ?`,
      )
      .all(candidateId) as unknown as WalkRow[];
    return rows.map((row) => ({
      platform: row.platform,
      state: row.state,
      updatedAt: row.updated_at,
      sections: JSON.parse(row.sections_json) as ImportWalk['sections'],
    }));
  }
}
