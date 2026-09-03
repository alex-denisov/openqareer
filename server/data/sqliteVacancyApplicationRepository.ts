import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import type {
  VacancyApplication,
  VacancyApplicationSnapshot,
  VacancyApplicationStatus,
} from '../../shared/vacancyApplication';

export interface VacancyApplicationInput {
  readonly clusterId: string;
  readonly status: VacancyApplicationStatus;
  readonly vacancy: VacancyApplicationSnapshot;
}

interface ApplicationRow {
  cluster_id: string;
  status: string;
  vacancy_cipher: string;
  opened_at: string | null;
  applied_at: string | null;
}

/**
 * Ручные отклики кандидата (B165, срез 1).
 *
 * Запись идемпотентна по `clusterId` и **не понижает** состояние: кандидат
 * открывает одну и ту же вакансию по нескольку раз, и повторное открытие
 * ссылки не имеет права откатить уже подтверждённый отклик.
 */
export class SqliteVacancyApplicationRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  record(
    candidateId: string,
    input: VacancyApplicationInput,
    now = new Date().toISOString(),
  ): VacancyApplication {
    const existing = this.get(candidateId, input.clusterId);
    const next: VacancyApplication = {
      clusterId: input.clusterId,
      status: existing?.status === 'applied' ? 'applied' : input.status,
      vacancy: input.vacancy,
      openedAt: existing?.openedAt ?? now,
      appliedAt:
        existing?.appliedAt ?? (input.status === 'applied' ? now : null),
      confirmedBy: null,
    };
    const stored: VacancyApplication = {
      ...next,
      confirmedBy: next.status === 'applied' ? 'candidate' : null,
    };
    this.database
      .prepare(
        `INSERT INTO vacancy_applications
          (candidate_id, cluster_id, status, vacancy_cipher, opened_at, applied_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, cluster_id) DO UPDATE SET
           status = excluded.status,
           vacancy_cipher = excluded.vacancy_cipher,
           opened_at = excluded.opened_at,
           applied_at = excluded.applied_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        stored.clusterId,
        stored.status,
        this.sealedText.seal(JSON.stringify(stored.vacancy), associatedData(candidateId)),
        stored.openedAt,
        stored.appliedAt,
        now,
      );
    return stored;
  }

  get(candidateId: string, clusterId: string): VacancyApplication | null {
    const row = this.database
      .prepare(
        `SELECT cluster_id, status, vacancy_cipher, opened_at, applied_at
           FROM vacancy_applications
          WHERE candidate_id = ? AND cluster_id = ?`,
      )
      .get(candidateId, clusterId) as ApplicationRow | undefined;
    return row ? this.toApplication(candidateId, row) : null;
  }

  list(candidateId: string): VacancyApplication[] {
    const rows = this.database
      .prepare(
        `SELECT cluster_id, status, vacancy_cipher, opened_at, applied_at
           FROM vacancy_applications
          WHERE candidate_id = ?
          ORDER BY updated_at DESC`,
      )
      .all(candidateId) as unknown as ApplicationRow[];
    return rows.map((row) => this.toApplication(candidateId, row));
  }

  private toApplication(candidateId: string, row: ApplicationRow): VacancyApplication {
    const status = row.status as VacancyApplicationStatus;
    return {
      clusterId: row.cluster_id,
      status,
      vacancy: JSON.parse(
        this.sealedText.open(row.vacancy_cipher, associatedData(candidateId)),
      ) as VacancyApplicationSnapshot,
      openedAt: row.opened_at,
      appliedAt: row.applied_at,
      confirmedBy: status === 'applied' ? 'candidate' : null,
    };
  }
}

/** Candidate-scoped, so a row can never be replayed under another candidate. */
function associatedData(candidateId: string): string {
  return `candidate:${candidateId}:vacancy-application`;
}
