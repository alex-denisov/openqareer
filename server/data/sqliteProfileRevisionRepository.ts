import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import { MIGRATION_37 } from './profileRevisionSchema';

export type ProfileRevisionRepoOptions = DatabaseSync | { databasePath: string };

export interface ProfileRevisionRecord {
  readonly id: string;
  readonly candidateId: string;
  readonly commandId: string;
  readonly section: 'headline' | 'about' | 'experience';
  readonly experienceId?: string | null;
  readonly previousText: string;
  readonly appliedText: string;
  readonly createdAt: string;
  readonly revertedAt?: string | null;
}

interface RevisionRow {
  id: string;
  candidate_id: string;
  command_id: string;
  section: 'headline' | 'about' | 'experience';
  experience_id: string | null;
  previous_text: string;
  applied_text: string;
  created_at: string;
  reverted_at: string | null;
}

function mapRow(row: RevisionRow): ProfileRevisionRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    commandId: row.command_id,
    section: row.section,
    experienceId: row.experience_id,
    previousText: row.previous_text,
    appliedText: row.applied_text,
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
  };
}

export class SqliteProfileRevisionRepository {
  private readonly database: DatabaseSync;

  constructor(options: ProfileRevisionRepoOptions) {
    if (options instanceof DatabaseSync) {
      this.database = options;
    } else {
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
    }
    this.database.exec(MIGRATION_37);
  }

  recordRevision(input: {
    readonly id: string;
    readonly candidateId: string;
    readonly commandId: string;
    readonly section: 'headline' | 'about' | 'experience';
    readonly experienceId?: string | null;
    readonly previousText: string;
    readonly appliedText: string;
    readonly createdAt: string;
  }): ProfileRevisionRecord {
    this.database
      .prepare(
        `INSERT INTO profile_revisions (id, candidate_id, command_id, section, experience_id, previous_text, applied_text, created_at, reverted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.candidateId,
        input.commandId,
        input.section,
        input.experienceId ?? null,
        input.previousText,
        input.appliedText,
        input.createdAt,
      );
    return {
      ...input,
      experienceId: input.experienceId ?? null,
      revertedAt: null,
    };
  }

  listRevisions(candidateId: string): ProfileRevisionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, candidate_id, command_id, section, experience_id, previous_text, applied_text, created_at, reverted_at
         FROM profile_revisions
         WHERE candidate_id = ?
         ORDER BY created_at DESC`,
      )
      .all(candidateId) as unknown as RevisionRow[];
    return rows.map(mapRow);
  }

  getRevisionByCommandId(candidateId: string, commandId: string): ProfileRevisionRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, candidate_id, command_id, section, experience_id, previous_text, applied_text, created_at, reverted_at
         FROM profile_revisions
         WHERE candidate_id = ? AND command_id = ?`,
      )
      .get(candidateId, commandId) as unknown as RevisionRow | undefined;
    return row ? mapRow(row) : null;
  }

  markReverted(candidateId: string, commandId: string, revertedAt: string): void {
    this.database
      .prepare(
        `UPDATE profile_revisions
         SET reverted_at = ?
         WHERE candidate_id = ? AND command_id = ? AND reverted_at IS NULL`,
      )
      .run(revertedAt, candidateId, commandId);
  }

  close(): void {
    this.database.close();
  }
}
