import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import type { CareerStrategy } from '../../shared/careerStrategy';

interface StrategyRow {
  strategy_cipher: string;
}

/**
 * Хранит выбранную роль кандидата вместе с историей решений (B180, срез 2).
 *
 * Запечатано тем же приёмом, что и рабочее пространство: роль, причина смены и
 * опора на факты резюме — это данные о человеке, а не служебная запись.
 */
export class SqliteCareerStrategyRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(candidateId: string, strategy: CareerStrategy): CareerStrategy {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO career_strategies
          (candidate_id, strategy_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           strategy_cipher = excluded.strategy_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        this.sealedText.seal(JSON.stringify(strategy), associatedData(candidateId)),
        now,
        now,
      );
    return strategy;
  }

  get(candidateId: string): CareerStrategy | null {
    const row = this.database
      .prepare('SELECT strategy_cipher FROM career_strategies WHERE candidate_id = ?')
      .get(candidateId) as StrategyRow | undefined;
    if (!row) return null;
    return JSON.parse(
      this.sealedText.open(row.strategy_cipher, associatedData(candidateId)),
    ) as CareerStrategy;
  }
}

/** Candidate-scoped, so a row can never be replayed under another candidate. */
function associatedData(candidateId: string): string {
  return `candidate:${candidateId}:career-strategy`;
}
