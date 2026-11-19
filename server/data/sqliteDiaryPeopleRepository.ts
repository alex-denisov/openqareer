import { DatabaseSync } from 'node:sqlite';
import type { CareerDiaryPerson } from '../../shared/careerDiaryPeople';
import { openPayload, sealPayload } from './careerDiaryRepositoryHelpers';
import { SealedText } from './sealedText';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from './sqliteBusyTimeout';

/**
 * B685: люди на новом месте работы. Одна новая таблица; имя, роль и группа лежат
 * в зашифрованном содержимом, поэтому их видит только сам кандидат. Таблица пустая
 * до первой записи и уходит вместе с кандидатом.
 */
export const DIARY_PEOPLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS career_diary_people (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, person_id)
) STRICT;
CREATE INDEX IF NOT EXISTS career_diary_people_workplace
  ON career_diary_people (candidate_id, workplace_id, created_at);
`;

const COLLECTION = 'diary-person';

interface Row {
  readonly person_id: string;
  readonly payload_cipher: string;
}

export class SqliteDiaryPeopleRepository {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(options: { databasePath: string; encryptionKey: Buffer }) {
    this.database = new DatabaseSync(options.databasePath);
    this.sealedText = new SealedText(options.encryptionKey);
    try {
      applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
      this.database.exec('PRAGMA journal_mode = WAL;');
      this.database.exec(DIARY_PEOPLE_SCHEMA);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  /** Люди места работы в порядке добавления. */
  list(candidateId: string, workplaceId: string): CareerDiaryPerson[] {
    const rows = this.database
      .prepare(
        `SELECT person_id, payload_cipher FROM career_diary_people
         WHERE candidate_id = ? AND workplace_id = ? ORDER BY created_at, rowid`,
      )
      .all(candidateId, workplaceId) as unknown as Row[];
    return rows.map((row) => this.open(candidateId, row));
  }

  get(candidateId: string, workplaceId: string, personId: string): CareerDiaryPerson | null {
    const row = this.database
      .prepare(
        `SELECT person_id, payload_cipher FROM career_diary_people
         WHERE candidate_id = ? AND workplace_id = ? AND person_id = ?`,
      )
      .get(candidateId, workplaceId, personId) as Row | undefined;
    return row ? this.open(candidateId, row) : null;
  }

  /** Место работы, где у кандидата уже есть строка с этим номером; `null` — номера нет. */
  workplaceOf(candidateId: string, personId: string): string | null {
    const row = this.database
      .prepare('SELECT workplace_id FROM career_diary_people WHERE candidate_id = ? AND person_id = ?')
      .get(candidateId, personId) as { workplace_id: string } | undefined;
    return row?.workplace_id ?? null;
  }

  count(candidateId: string, workplaceId: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS total FROM career_diary_people WHERE candidate_id = ? AND workplace_id = ?')
      .get(candidateId, workplaceId) as { total: number };
    return row.total;
  }

  save(candidateId: string, workplaceId: string, person: CareerDiaryPerson): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO career_diary_people
           (candidate_id, person_id, workplace_id, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, person_id) DO UPDATE SET
           payload_cipher = excluded.payload_cipher, updated_at = excluded.updated_at
         WHERE career_diary_people.workplace_id = excluded.workplace_id`,
      )
      .run(
        candidateId,
        person.id,
        workplaceId,
        sealPayload(this.sealedText, candidateId, COLLECTION, person.id, person),
        person.createdAt,
        now,
      );
  }

  delete(candidateId: string, workplaceId: string, personId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM career_diary_people WHERE candidate_id = ? AND workplace_id = ? AND person_id = ?')
      .run(candidateId, workplaceId, personId);
    return Number(result.changes) > 0;
  }

  private open(candidateId: string, row: Row): CareerDiaryPerson {
    return openPayload<CareerDiaryPerson>(this.sealedText, candidateId, COLLECTION, row.person_id, row.payload_cipher);
  }
}
