import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

export type CandidateDraftKind = 'post' | 'comment';
export type CandidateDraftStatus = 'draft' | 'copied' | 'rejected';
export interface CandidateDraft {
  readonly id: string;
  readonly candidateId: string;
  readonly kind: CandidateDraftKind;
  readonly topic: string;
  readonly targetPostUrl: string | null;
  readonly text: string;
  readonly status: CandidateDraftStatus;
  readonly localDate: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
type DraftRow = { id: string; candidate_id: string; kind: CandidateDraftKind; topic: string;
  target_post_url: string | null; text: string; status: CandidateDraftStatus;
  local_date: string; created_at: string; updated_at: string };
function fromRow(row: DraftRow): CandidateDraft {
  return { id: row.id, candidateId: row.candidate_id, kind: row.kind, topic: row.topic,
    targetPostUrl: row.target_post_url, text: row.text, status: row.status,
    localDate: row.local_date, createdAt: row.created_at, updatedAt: row.updated_at };
}
export class SqliteCandidateDraftRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  constructor(options: DatabaseSync | { databasePath: string }) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database = options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    if (this.ownsDatabase) this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(`CREATE TABLE IF NOT EXISTS candidate_drafts (
      id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('post','comment')), topic TEXT NOT NULL,
      target_post_url TEXT, text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','copied','rejected')),
      local_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS candidate_drafts_candidate_date ON candidate_drafts(candidate_id, local_date);`);
    this.installDeletionTrigger();
  }
  private installDeletionTrigger(): void {
    if (!this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'").get()) return;
    this.database.exec(`CREATE TRIGGER IF NOT EXISTS candidate_drafts_delete_candidate
      AFTER DELETE ON candidates BEGIN DELETE FROM candidate_drafts WHERE candidate_id = OLD.id; END;
      CREATE TRIGGER IF NOT EXISTS candidate_drafts_require_candidate BEFORE INSERT ON candidate_drafts
      WHEN NOT EXISTS (SELECT 1 FROM candidates WHERE id = NEW.candidate_id)
      BEGIN SELECT RAISE(ABORT, 'candidate_not_found'); END;`);
  }
  close(): void { if (this.ownsDatabase) this.database.close(); }
  create(input: Omit<CandidateDraft, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'targetPostUrl'> & { readonly targetPostUrl?: string | null }): CandidateDraft {
    const now = new Date().toISOString();
    const draft: CandidateDraft = { ...input, id: randomUUID(), status: 'draft', targetPostUrl: input.targetPostUrl ?? null, createdAt: now, updatedAt: now };
    this.database.prepare(`INSERT INTO candidate_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(draft.id, draft.candidateId, draft.kind, draft.topic, draft.targetPostUrl, draft.text, draft.status, draft.localDate, now, now);
    return draft;
  }
  listRecent(candidateId: string, limit = 20): CandidateDraft[] {
    const bounded = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 20;
    return (this.database.prepare(`SELECT * FROM candidate_drafts WHERE candidate_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(candidateId, bounded) as DraftRow[]).map(fromRow);
  }
  countForDay(candidateId: string, localDate: string, kind: CandidateDraftKind): number {
    return (this.database.prepare(`SELECT COUNT(*) AS count FROM candidate_drafts WHERE candidate_id = ? AND local_date = ? AND kind = ?`)
      .get(candidateId, localDate, kind) as { count: number }).count;
  }
  setStatus(candidateId: string, id: string, status: CandidateDraftStatus): CandidateDraft | null {
    const row = this.database.prepare(`UPDATE candidate_drafts SET status = ?, updated_at = ? WHERE candidate_id = ? AND id = ? RETURNING *`)
      .get(status, new Date().toISOString(), candidateId, id) as DraftRow | undefined;
    return row ? fromRow(row) : null;
  }
}
