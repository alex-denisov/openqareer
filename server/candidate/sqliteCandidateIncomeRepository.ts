import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { SealedText } from '../data/sealedText';

/**
 * B673: нынешний доход и ожидания кандидата. Отдельная таблица: эти числа не
 * лежат ни в профиле, ни в условиях поиска, поэтому сами не попадают в резюме,
 * письма, анкеты, подбор и к консультанту. Значения запечатаны.
 */
export const CANDIDATE_INCOME_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_income (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  income_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

export interface CandidateIncome {
  /** Доход сейчас, ₽ в месяц на руки; `null` — не указан. */
  readonly current: number | null;
  /** Ожидания, ₽ в месяц на руки; `null` — не указаны. */
  readonly expected: number | null;
}

export const EMPTY_INCOME: CandidateIncome = { current: null, expected: null };

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export class SqliteCandidateIncomeRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  constructor(
    options: DatabaseSync | { databasePath: string; encryptionKey: Buffer },
    key?: Buffer,
  ) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database =
      options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('candidate_income_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    if (this.ownsDatabase)
      this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(CANDIDATE_INCOME_SCHEMA);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  get(candidateId: string): CandidateIncome {
    const row = this.database
      .prepare('SELECT income_cipher FROM candidate_income WHERE candidate_id = ?')
      .get(candidateId) as { income_cipher: string } | undefined;
    if (!row) return EMPTY_INCOME;
    const parsed = JSON.parse(this.sealedText.open(row.income_cipher, this.aad(candidateId))) as {
      current?: unknown;
      expected?: unknown;
    };
    return { current: amount(parsed.current), expected: amount(parsed.expected) };
  }

  put(candidateId: string, income: CandidateIncome, updatedAt: string): CandidateIncome {
    const stored = { current: amount(income.current), expected: amount(income.expected) };
    this.database
      .prepare(
        `INSERT INTO candidate_income (candidate_id, income_cipher, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           income_cipher = excluded.income_cipher, updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        this.sealedText.seal(JSON.stringify(stored), this.aad(candidateId)),
        updatedAt,
      );
    return stored;
  }

  private aad(candidateId: string): string {
    return `candidate:${candidateId}:income`;
  }
}
