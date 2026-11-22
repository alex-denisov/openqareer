import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_GOAL_DETAILS,
  EMPTY_ADAPTATION_DETAILS,
  type CareerDiaryAdaptationDetails,
  type CareerDiaryGoalDetails,
} from '../../shared/careerDiaryCards';
import { openPayload, sealPayload } from './careerDiaryRepositoryHelpers';
import { SealedText } from './sealedText';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from './sqliteBusyTimeout';

/**
 * B684: поля цели и плана адаптации из макетов B640, которых нет у прежних записей
 * дневника. Только две новые таблицы: прежние цели и планы не меняются и читаются как
 * раньше, а детали дописываются рядом по номеру цели и места работы. Содержимое
 * зашифровано; пустые до первой записи, поэтому создание таблиц ничего не стоит.
 */
export const DIARY_DETAILS_SCHEMA = `
CREATE TABLE IF NOT EXISTS career_diary_goal_details (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, goal_id)
) STRICT;
CREATE TABLE IF NOT EXISTS career_diary_adaptation_details (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  workplace_id TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, workplace_id)
) STRICT;
`;

type DetailsTable = 'career_diary_goal_details' | 'career_diary_adaptation_details';
const KEY_COLUMN: Readonly<Record<DetailsTable, string>> = {
  career_diary_goal_details: 'goal_id',
  career_diary_adaptation_details: 'workplace_id',
};
const COLLECTION: Readonly<Record<DetailsTable, string>> = {
  career_diary_goal_details: 'goal-details',
  career_diary_adaptation_details: 'adaptation-details',
};

interface CipherRow {
  readonly key: string;
  readonly payload_cipher: string;
}

export class SqliteDiaryDetailsRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database =
      options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('diary_details_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    try {
      // Сначала ожидание чужой записи (как у остальных соединений HTTP), потом всё остальное.
      // Чужое соединение (хранилища) живёт со своими настройками ожидания и журнала.
      if (this.ownsDatabase) {
        applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
        this.database.exec('PRAGMA journal_mode = WAL;');
      }
      this.database.exec(DIARY_DETAILS_SCHEMA);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  /** Детали целей кандидата по номеру цели; у цели без записи — значения по умолчанию. */
  goalDetails(candidateId: string): Map<string, CareerDiaryGoalDetails> {
    const rows = this.rows('career_diary_goal_details', candidateId);
    return new Map(
      rows.map((row) => [
        row.key,
        { ...DEFAULT_GOAL_DETAILS, ...this.open<CareerDiaryGoalDetails>('career_diary_goal_details', candidateId, row) },
      ]),
    );
  }

  /** B689: сохранённые детали целей и планов адаптации — для выгрузки данных. */
  exportAll(candidateId: string): {
    goals: Array<{ goalId: string; details: CareerDiaryGoalDetails }>;
    adaptation: Array<{ workplaceId: string; details: CareerDiaryAdaptationDetails }>;
  } {
    return {
      goals: [...this.goalDetails(candidateId)].map(([goalId, details]) => ({ goalId, details })),
      adaptation: this.rows('career_diary_adaptation_details', candidateId).map((row) => ({
        workplaceId: row.key,
        details: this.adaptationDetails(candidateId, row.key),
      })),
    };
  }

  goalDetail(candidateId: string, goalId: string): CareerDiaryGoalDetails {
    return this.goalDetails(candidateId).get(goalId) ?? DEFAULT_GOAL_DETAILS;
  }

  /** Убирает детали целей, которых у кандидата уже нет (цель удалена прежним маршрутом). */
  dropGoalDetailsExcept(candidateId: string, goalIds: ReadonlySet<string>): void {
    const remove = this.database.prepare(
      'DELETE FROM career_diary_goal_details WHERE candidate_id = ? AND goal_id = ?',
    );
    for (const row of this.rows('career_diary_goal_details', candidateId)) {
      if (!goalIds.has(row.key)) remove.run(candidateId, row.key);
    }
  }

  saveGoalDetail(candidateId: string, goalId: string, details: CareerDiaryGoalDetails): void {
    this.save('career_diary_goal_details', candidateId, goalId, details);
  }

  adaptationDetails(candidateId: string, workplaceId: string): CareerDiaryAdaptationDetails {
    const row = this.database
      .prepare(
        `SELECT workplace_id AS key, payload_cipher FROM career_diary_adaptation_details
         WHERE candidate_id = ? AND workplace_id = ?`,
      )
      .get(candidateId, workplaceId) as CipherRow | undefined;
    if (!row) return EMPTY_ADAPTATION_DETAILS;
    const stored = this.open<CareerDiaryAdaptationDetails>('career_diary_adaptation_details', candidateId, row);
    return { ...EMPTY_ADAPTATION_DETAILS, ...stored };
  }

  saveAdaptationDetails(
    candidateId: string,
    workplaceId: string,
    details: CareerDiaryAdaptationDetails,
  ): void {
    this.save('career_diary_adaptation_details', candidateId, workplaceId, details);
  }

  private rows(table: DetailsTable, candidateId: string): CipherRow[] {
    return this.database
      .prepare(`SELECT ${KEY_COLUMN[table]} AS key, payload_cipher FROM ${table} WHERE candidate_id = ?`)
      .all(candidateId) as unknown as CipherRow[];
  }

  private open<T>(table: DetailsTable, candidateId: string, row: CipherRow): T {
    return openPayload<T>(this.sealedText, candidateId, COLLECTION[table], row.key, row.payload_cipher);
  }

  private save(table: DetailsTable, candidateId: string, key: string, payload: object): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO ${table} (candidate_id, ${KEY_COLUMN[table]}, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, ${KEY_COLUMN[table]}) DO UPDATE SET
           payload_cipher = excluded.payload_cipher, updated_at = excluded.updated_at`,
      )
      .run(candidateId, key, sealPayload(this.sealedText, candidateId, COLLECTION[table], key, payload), now, now);
  }
}
