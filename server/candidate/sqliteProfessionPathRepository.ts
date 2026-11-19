import type { DatabaseSync } from 'node:sqlite';
import { LOWER_INCOME_ANSWERS, type LowerIncomeAnswer } from '../domain/professionPath';

/**
 * B669: ответ «Вы готовы к доходу ниже?» на пути в новую профессию. Ответ
 * относится к целевой профессии: другая профессия — вопрос задаётся заново.
 */
export const PROFESSION_PATH_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_profession_path (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  lower_income TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

const isAnswer = (value: unknown): value is LowerIncomeAnswer =>
  LOWER_INCOME_ANSWERS.some((answer) => answer === value);

export class SqliteProfessionPathRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(PROFESSION_PATH_SCHEMA);
  }

  lowerIncome(candidateId: string, targetKey: string): LowerIncomeAnswer | null {
    const row = this.database
      .prepare(
        'SELECT lower_income FROM candidate_profession_path WHERE candidate_id = ? AND target_key = ?',
      )
      .get(candidateId, targetKey) as { lower_income: string } | undefined;
    return isAnswer(row?.lower_income) ? row.lower_income : null;
  }

  putLowerIncome(
    candidateId: string,
    targetKey: string,
    answer: LowerIncomeAnswer,
    updatedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO candidate_profession_path (candidate_id, target_key, lower_income, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           target_key = excluded.target_key, lower_income = excluded.lower_income,
           updated_at = excluded.updated_at`,
      )
      .run(candidateId, targetKey, answer, updatedAt);
  }
}
