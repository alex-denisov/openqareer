import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GROWTH_GOALS, type GrowthGoalKind } from '../domain/growthGoal';

/**
 * B670: цели роста у нынешнего места работы. Каждый выбор — новая строка с
 * датой выбора; текущая цель — последняя строка этого места работы. Новое
 * место работы — цель спрашивается заново.
 */
export const GROWTH_GOAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_growth_goals (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  workplace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('promotion', 'raise', 'other_role', 'stay')),
  chosen_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_growth_goals_by_workplace
  ON candidate_growth_goals(candidate_id, workplace_id, chosen_at);
`;

export interface GrowthGoalChoice {
  readonly kind: GrowthGoalKind;
  readonly chosenAt: string;
}

const isKind = (value: unknown): value is GrowthGoalKind =>
  GROWTH_GOALS.some((kind) => kind === value);

export class SqliteGrowthGoalRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(GROWTH_GOAL_SCHEMA);
  }

  current(candidateId: string, workplaceId: string): GrowthGoalChoice | null {
    const row = this.database
      .prepare(
        `SELECT kind, chosen_at FROM candidate_growth_goals
         WHERE candidate_id = ? AND workplace_id = ?
         ORDER BY chosen_at DESC, rowid DESC LIMIT 1`,
      )
      .get(candidateId, workplaceId) as { kind: string; chosen_at: string } | undefined;
    return row && isKind(row.kind) ? { kind: row.kind, chosenAt: row.chosen_at } : null;
  }

  choose(
    candidateId: string,
    workplaceId: string,
    kind: GrowthGoalKind,
    chosenAt: string,
  ): GrowthGoalChoice {
    this.database
      .prepare(
        `INSERT INTO candidate_growth_goals (id, candidate_id, workplace_id, kind, chosen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), candidateId, workplaceId, kind, chosenAt);
    return { kind, chosenAt };
  }
}
