import type { DatabaseSync } from 'node:sqlite';
import type { SkipReasonId } from '../../shared/skipReasons';

export type VacancySkipOrigin = 'vacancy_card' | 'kanban';

export interface StoredVacancySkip {
  readonly clusterId: string;
  readonly reasonId: SkipReasonId;
  readonly origin: VacancySkipOrigin;
  readonly createdAt: string;
}

interface SkipRow {
  cluster_id: string;
  reason_id: string;
  origin: string;
  created_at: string;
}

/**
 * `GET|POST|DELETE /vacancy-skips` (B251, S2, architecture.md §4). A skip
 * hides exactly one vacancy from the matched pool (owner decision, no
 * lowering of similar roles in v1). Posting a skip for a card that is still
 * `saved` archives that card in the same transaction so the tracker and the
 * pool never disagree about a vacancy the candidate declined.
 */
export class SqliteVacancySkipRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(candidateId: string): StoredVacancySkip[] {
    const rows = this.database
      .prepare(
        `SELECT cluster_id, reason_id, origin, created_at FROM vacancy_skips
          WHERE candidate_id = ? ORDER BY created_at DESC`,
      )
      .all(candidateId) as unknown as SkipRow[];
    return rows.map(toSkip);
  }

  /**
   * Inserts the skip and, in the same transaction, archives any `saved`
   * card for this `clusterId` with `closed_reason = reasonId`. A card that
   * already moved past `saved` is left untouched.
   */
  create(
    candidateId: string,
    input: { clusterId: string; reasonId: SkipReasonId; origin: VacancySkipOrigin },
    archiveSavedCard: (candidateId: string, clusterId: string, reasonId: SkipReasonId) => void,
    now = new Date().toISOString(),
  ): StoredVacancySkip {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `INSERT INTO vacancy_skips (candidate_id, cluster_id, reason_id, origin, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (candidate_id, cluster_id) DO UPDATE SET
             reason_id = excluded.reason_id, origin = excluded.origin, created_at = excluded.created_at`,
        )
        .run(candidateId, input.clusterId, input.reasonId, input.origin, now);
      archiveSavedCard(candidateId, input.clusterId, input.reasonId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { clusterId: input.clusterId, reasonId: input.reasonId, origin: input.origin, createdAt: now };
  }

  delete(candidateId: string, clusterId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM vacancy_skips WHERE candidate_id = ? AND cluster_id = ?')
      .run(candidateId, clusterId);
    return result.changes === 1;
  }
}

function toSkip(row: SkipRow): StoredVacancySkip {
  return {
    clusterId: row.cluster_id,
    reasonId: row.reason_id as SkipReasonId,
    origin: row.origin as VacancySkipOrigin,
    createdAt: row.created_at,
  };
}
