import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import { MIGRATION_39 } from './starPrepSchema';

export interface StarPrepParagraphRecord {
  readonly questionId: string;
  readonly field: 'situation' | 'task' | 'action' | 'result';
  readonly text: string;
  readonly sourceFactId: string;
}

export interface StoredStarPrep {
  readonly applicationId: string;
  readonly paragraphs: readonly StarPrepParagraphRecord[];
  readonly version: number;
  readonly updatedAt: string;
}

interface StarPrepRow {
  application_id: string;
  candidate_id: string;
  body_cipher: string;
  version: number;
  updated_at: string;
}

/** Подготовка STAR на отклик (B392). Текст кандидата хранится запечатанным. */
export class SqliteStarPrepRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(MIGRATION_39);
  }

  get(candidateId: string, applicationId: string): StoredStarPrep | null {
    const row = this.database
      .prepare(
        `SELECT application_id, candidate_id, body_cipher, version, updated_at
         FROM application_star_prep WHERE candidate_id = ? AND application_id = ?`,
      )
      .get(candidateId, applicationId) as unknown as StarPrepRow | undefined;
    if (!row) return null;
    const body = this.sealedText.open(row.body_cipher, associatedData(candidateId, applicationId));
    return {
      applicationId,
      paragraphs: JSON.parse(body) as StarPrepParagraphRecord[],
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  put(
    candidateId: string,
    applicationId: string,
    paragraphs: readonly StarPrepParagraphRecord[],
    now: string,
  ): StoredStarPrep {
    const cipher = this.sealedText.seal(
      JSON.stringify(paragraphs),
      associatedData(candidateId, applicationId),
    );
    this.database
      .prepare(
        `INSERT INTO application_star_prep (application_id, candidate_id, body_cipher, version, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(application_id) DO UPDATE SET
           body_cipher = excluded.body_cipher,
           version = application_star_prep.version + 1,
           updated_at = excluded.updated_at
         WHERE application_star_prep.candidate_id = excluded.candidate_id`,
      )
      .run(applicationId, candidateId, cipher, now);
    const stored = this.get(candidateId, applicationId);
    if (!stored) throw new Error('star prep was not stored');
    return stored;
  }
}

function associatedData(candidateId: string, applicationId: string): string {
  return `candidate:${candidateId}:application:${applicationId}:star-prep`;
}
