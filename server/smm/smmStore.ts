import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * Память SMM-агента владельца: черновики постов Threads, их судьба, правки
 * владельца, выученные правила и цифры охватов. Только тексты владельца и
 * агента; данных кандидатов здесь нет.
 */
export const SMM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS smm_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ms INTEGER NOT NULL,
  cluster TEXT NOT NULL,
  hook TEXT NOT NULL,
  parts_json TEXT NOT NULL,
  link TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected','revised')),
  origin TEXT NOT NULL,
  owner_note TEXT,
  metrics TEXT,
  decided_ms INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_smm_posts_created ON smm_posts(created_ms DESC);
CREATE TABLE IF NOT EXISTS smm_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ms INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('style','correction','strategy','performance','pain')),
  text TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_smm_notes_kind ON smm_notes(kind, created_ms DESC);
CREATE TABLE IF NOT EXISTS smm_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`;

export type SmmPostStatus = 'proposed' | 'accepted' | 'rejected' | 'revised';
export type SmmNoteKind = 'style' | 'correction' | 'strategy' | 'performance' | 'pain';

export interface SmmPost {
  readonly id: number;
  readonly createdMs: number;
  readonly cluster: string;
  readonly hook: string;
  readonly parts: readonly string[];
  readonly link: string | null;
  readonly status: SmmPostStatus;
  readonly origin: string;
  readonly ownerNote: string | null;
  readonly metrics: string | null;
}

export interface SmmDraft {
  readonly cluster: string;
  readonly hook: string;
  readonly parts: readonly string[];
  readonly link: string | null;
  readonly origin: string;
}

interface PostRow {
  id: number;
  created_ms: number;
  cluster: string;
  hook: string;
  parts_json: string;
  link: string | null;
  status: SmmPostStatus;
  origin: string;
  owner_note: string | null;
  metrics: string | null;
}

function toPost(row: PostRow): SmmPost {
  const parsed: unknown = JSON.parse(row.parts_json);
  const parts = Array.isArray(parsed)
    ? parsed.filter((p): p is string => typeof p === 'string')
    : [];
  return {
    id: row.id,
    createdMs: row.created_ms,
    cluster: row.cluster,
    hook: row.hook,
    parts,
    link: row.link,
    status: row.status,
    origin: row.origin,
    ownerNote: row.owner_note,
    metrics: row.metrics,
  };
}

const NOTE_MAX_CHARS = 1_000;

export class SmmStore {
  constructor(private readonly database: DatabaseSync) {
    database.exec(SMM_SCHEMA_SQL);
  }

  addPost(draft: SmmDraft, nowMs: number): SmmPost {
    const row = this.database
      .prepare(
        `INSERT INTO smm_posts (created_ms, cluster, hook, parts_json, link, status, origin)
         VALUES (?, ?, ?, ?, ?, 'proposed', ?) RETURNING *`,
      )
      .get(
        nowMs,
        draft.cluster,
        draft.hook,
        JSON.stringify(draft.parts),
        draft.link,
        draft.origin,
      ) as unknown as PostRow;
    return toPost(row);
  }

  getPost(id: number): SmmPost | null {
    const row = this.database.prepare('SELECT * FROM smm_posts WHERE id = ?').get(id) as unknown as
      PostRow | undefined;
    return row ? toPost(row) : null;
  }

  decide(
    id: number,
    status: Exclude<SmmPostStatus, 'proposed'>,
    note: string | null,
    nowMs: number,
  ): void {
    this.database
      .prepare(
        'UPDATE smm_posts SET status = ?, owner_note = COALESCE(?, owner_note), decided_ms = ? WHERE id = ?',
      )
      .run(status, note?.slice(0, NOTE_MAX_CHARS) ?? null, nowMs, id);
  }

  setMetrics(id: number, metrics: string): void {
    this.database
      .prepare('UPDATE smm_posts SET metrics = ? WHERE id = ?')
      .run(metrics.slice(0, NOTE_MAX_CHARS), id);
  }

  recentPosts(limit: number): SmmPost[] {
    const rows = this.database
      .prepare('SELECT * FROM smm_posts ORDER BY created_ms DESC, id DESC LIMIT ?')
      .all(limit) as unknown as PostRow[];
    return rows.map(toPost);
  }

  countCreatedSince(sinceMs: number, origin: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS n FROM smm_posts WHERE created_ms >= ? AND origin = ?')
      .get(sinceMs, origin) as { n: number };
    return row.n;
  }

  countPending(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS n FROM smm_posts WHERE status = 'proposed'")
      .get() as {
      n: number;
    };
    return row.n;
  }

  countAccepted(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS n FROM smm_posts WHERE status = 'accepted'")
      .get() as {
      n: number;
    };
    return row.n;
  }

  addNote(kind: SmmNoteKind, text: string, nowMs: number): void {
    const trimmed = text.trim().slice(0, NOTE_MAX_CHARS);
    if (!trimmed) return;
    this.database
      .prepare('INSERT INTO smm_notes (created_ms, kind, text) VALUES (?, ?, ?)')
      .run(nowMs, kind, trimmed);
  }

  recentNotes(kind: SmmNoteKind, limit: number): string[] {
    const rows = this.database
      .prepare(
        'SELECT text FROM smm_notes WHERE kind = ? ORDER BY created_ms DESC, id DESC LIMIT ?',
      )
      .all(kind, limit) as { text: string }[];
    return rows.map((row) => row.text);
  }

  getState(key: string): string | null {
    const row = this.database.prepare('SELECT value FROM smm_state WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  setState(key: string, value: string | null): void {
    if (value === null) {
      this.database.prepare('DELETE FROM smm_state WHERE key = ?').run(key);
      return;
    }
    this.database
      .prepare(
        'INSERT INTO smm_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }
}

export function openSmmStore(databasePath: string): SmmStore {
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  applySqliteBusyTimeout(database);
  return new SmmStore(database);
}
