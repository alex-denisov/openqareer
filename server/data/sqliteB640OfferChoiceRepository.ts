import { DatabaseSync } from 'node:sqlite';
import type { B640OfferDecision } from '../../shared/b640Offers';
import type { OfferChoice } from '../domain/b640Offers';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';

/**
 * B680: налог и решение кандидата по офферу. Только новая таблица; пустая до
 * первой записи, поэтому `CREATE TABLE IF NOT EXISTS` ничего не стоит в окне
 * здоровья выката. Строка оффера (`application_offers`) не меняется.
 */
export const B640_OFFER_CHOICES_SCHEMA = `
CREATE TABLE IF NOT EXISTS b640_offer_choices (
  application_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  decision TEXT CHECK (decision IS NULL OR decision IN ('accepted', 'declined')),
  decided_at TEXT,
  tax_percent REAL CHECK (tax_percent IS NULL OR (tax_percent >= 0 AND tax_percent <= 60)),
  updated_at TEXT NOT NULL
) STRICT;
`;

interface ChoiceRow {
  application_id: string;
  decision: B640OfferDecision | null;
  decided_at: string | null;
  tax_percent: number | null;
}

const toChoice = (row: ChoiceRow): OfferChoice => ({
  taxPercent: row.tax_percent,
  decision: row.decision,
  decidedAt: row.decided_at,
});

export class SqliteB640OfferChoiceRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(options: DatabaseSync | { databasePath: string }) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database = options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    if (this.ownsDatabase) this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(B640_OFFER_CHOICES_SCHEMA);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  /** Выборы кандидата по его откликам, по id отклика. */
  listFor(candidateId: string): ReadonlyMap<string, OfferChoice> {
    const rows = this.database
      .prepare(
        'SELECT application_id, decision, decided_at, tax_percent FROM b640_offer_choices WHERE candidate_id = ?',
      )
      .all(candidateId) as unknown as ChoiceRow[];
    return new Map(rows.map((row) => [row.application_id, toChoice(row)]));
  }

  get(candidateId: string, applicationId: string): OfferChoice | null {
    return this.listFor(candidateId).get(applicationId) ?? null;
  }

  setTax(candidateId: string, applicationId: string, taxPercent: number | null, now: string): void {
    this.database
      .prepare(
        `INSERT INTO b640_offer_choices (application_id, candidate_id, tax_percent, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (application_id) DO UPDATE SET tax_percent = excluded.tax_percent, updated_at = excluded.updated_at
         WHERE b640_offer_choices.candidate_id = excluded.candidate_id`,
      )
      .run(applicationId, candidateId, taxPercent, now);
  }

  setDecision(
    candidateId: string,
    applicationId: string,
    decision: B640OfferDecision,
    now: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO b640_offer_choices (application_id, candidate_id, decision, decided_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (application_id) DO UPDATE SET
           decision = excluded.decision, decided_at = excluded.decided_at, updated_at = excluded.updated_at
         WHERE b640_offer_choices.candidate_id = excluded.candidate_id`,
      )
      .run(applicationId, candidateId, decision, now, now);
  }

  /**
   * Отклики кандидата, отправленные автооткликом: id есть в очереди и строка
   * не снята. Только чтение; таблицы ещё может не быть — тогда автооткликов нет.
   */
  autoApplicationIds(candidateId: string): ReadonlySet<string> {
    try {
      const rows = this.database
        .prepare(
          `SELECT DISTINCT application_id FROM candidate_auto_apply_queue
           WHERE candidate_id = ? AND application_id IS NOT NULL AND status <> 'removed'`,
        )
        .all(candidateId) as unknown as Array<{ application_id: string }>;
      return new Set(rows.map((row) => row.application_id));
    } catch (error) {
      if (error instanceof Error && /no such table/u.test(error.message)) return new Set();
      throw error;
    }
  }
}
