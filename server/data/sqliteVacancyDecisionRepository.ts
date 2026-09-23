import type { DatabaseSync } from 'node:sqlite';
import type { VacancyDecision, VacancyDecisionStatus } from '../../shared/vacancyDecision';
import { isVacancySkipReasonId, type VacancySkipReasonId } from '../../shared/vacancySkipReasons';

export interface VacancyDecisionInput {
  readonly clusterId: string;
  readonly status: VacancyDecisionStatus;
  /** Обязателен для `status: 'skipped'`, игнорируется для `'saved'`. */
  readonly skipReasonId?: VacancySkipReasonId | null;
}

interface DecisionRow {
  cluster_id: string;
  status: string;
  skip_reason_id: string | null;
  decided_at: string;
}

/**
 * Узкая таблица для решений «Сохранить» / «Пропустить с причиной» (B248).
 *
 * Отдельная от `vacancy_applications` (B165): это выбор кандидата до
 * отклика, а не наблюдение, что он ушёл на площадку. Архитектор проектирует
 * модель откликов с этапами (B251) поверх тех же кластеров — эта таблица
 * не трогается тем срезом и не ссылается на его сущности.
 *
 * `CREATE TABLE IF NOT EXISTS` — прод-база 3,8 ГБ, окно проверки здоровья при
 * выкате 20 с не переживает `ALTER TABLE` (B230), а создание пустой таблицы
 * не читает существующие строки.
 */
const VACANCY_DECISIONS_TABLE = `
CREATE TABLE IF NOT EXISTS vacancy_decisions (
  candidate_id TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('saved', 'skipped')),
  skip_reason_id TEXT,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, cluster_id)
) STRICT;
`;

export class SqliteVacancyDecisionRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(VACANCY_DECISIONS_TABLE);
  }

  record(
    candidateId: string,
    input: VacancyDecisionInput,
    now = new Date().toISOString(),
  ): VacancyDecision {
    const skipReasonId =
      input.status === 'skipped' && input.skipReasonId && isVacancySkipReasonId(input.skipReasonId)
        ? input.skipReasonId
        : null;
    if (input.status === 'skipped' && !skipReasonId) {
      throw new Error('a skipped vacancy decision requires a known skip reason id');
    }

    this.database
      .prepare(
        `INSERT INTO vacancy_decisions (candidate_id, cluster_id, status, skip_reason_id, decided_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, cluster_id) DO UPDATE SET
           status = excluded.status,
           skip_reason_id = excluded.skip_reason_id,
           decided_at = excluded.decided_at`,
      )
      .run(candidateId, input.clusterId, input.status, skipReasonId, now);

    return {
      clusterId: input.clusterId,
      status: input.status,
      skipReasonId,
      decidedAt: now,
    };
  }

  list(candidateId: string): VacancyDecision[] {
    const rows = this.database
      .prepare(
        `SELECT cluster_id, status, skip_reason_id, decided_at
           FROM vacancy_decisions
          WHERE candidate_id = ?`,
      )
      .all(candidateId) as unknown as DecisionRow[];
    return rows.map(toDecision);
  }
}

function toDecision(row: DecisionRow): VacancyDecision {
  return {
    clusterId: row.cluster_id,
    status: row.status as VacancyDecisionStatus,
    skipReasonId: row.skip_reason_id as VacancySkipReasonId | null,
    decidedAt: row.decided_at,
  };
}
