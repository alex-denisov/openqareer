import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { B640ContactState } from '../../shared/b640Contacts';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import { CANDIDATE_CONTACT_STATUS_TABLE } from './sqliteSchema';

export interface StoredContactStatus {
  readonly state: Exclude<B640ContactState, 'none'>;
  readonly at: string;
}

interface StatusRow {
  contact_id: string;
  state: string;
  at: string;
}

/** B697: статус «писали / ответили» контактов кандидата; `none` — строки нет. */
export class SqliteContactStatusRepository {
  private readonly database: DatabaseSync;

  constructor(options: { databasePath: string }) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    }
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(CANDIDATE_CONTACT_STATUS_TABLE);
  }

  list(candidateId: string): ReadonlyMap<string, StoredContactStatus> {
    const rows = this.database
      .prepare('SELECT contact_id, state, at FROM candidate_contact_status WHERE candidate_id = ?')
      .all(candidateId) as unknown as StatusRow[];
    return new Map(
      rows.flatMap((row) =>
        row.state === 'written' || row.state === 'replied'
          ? [[row.contact_id, { state: row.state, at: row.at }] as const]
          : [],
      ),
    );
  }

  set(candidateId: string, contactId: string, state: B640ContactState, now: string): string | null {
    if (state === 'none') {
      this.database
        .prepare('DELETE FROM candidate_contact_status WHERE candidate_id = ? AND contact_id = ?')
        .run(candidateId, contactId);
      return null;
    }
    this.database
      .prepare(
        `INSERT INTO candidate_contact_status (candidate_id, contact_id, state, at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id, contact_id) DO UPDATE SET state = excluded.state, at = excluded.at`,
      )
      .run(candidateId, contactId, state, now);
    return now;
  }

  close(): void {
    this.database.close();
  }
}
