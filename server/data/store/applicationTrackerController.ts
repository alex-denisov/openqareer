import type { DatabaseSync } from 'node:sqlite';
import {
  SqliteApplicationRepository,
  type CreateApplicationInput,
  type PatchApplicationInput,
  type StoredApplication,
} from '../sqliteApplicationRepository';
import type { SqliteVacancyApplicationRepository, VacancyApplicationInput } from '../sqliteVacancyApplicationRepository';
import type { SealedText } from '../sealedText';
import type { VacancyApplication } from '../../../shared/vacancyApplication';

/**
 * Связывает старый фасад (`vacancy_applications`) с трекером откликов
 * (B251, S1, architecture.md §4–5). Владеет своим репозиторием, чтобы
 * `SqliteCandidateStore` не разрастался сверх гейта 800 строк.
 */
export class ApplicationTrackerController {
  private readonly applications: SqliteApplicationRepository;

  constructor(
    database: DatabaseSync,
    sealedText: SealedText,
    private readonly legacyApplications: SqliteVacancyApplicationRepository,
  ) {
    this.applications = new SqliteApplicationRepository(database, sealedText);
  }

  listLegacy(candidateId: string): VacancyApplication[] {
    return this.legacyApplications.list(candidateId);
  }

  /**
   * Записывает старый отклик и, если он подтверждён, дублирует его в трекер
   * — но никогда не понижает карточку, продвинувшуюся дальше `applied`.
   */
  recordLegacy(candidateId: string, input: VacancyApplicationInput): VacancyApplication {
    const stored = this.legacyApplications.record(candidateId, input);
    if (input.status === 'applied') {
      this.applications.recordLegacyApplied(candidateId, input.clusterId, input.vacancy);
    }
    return stored;
  }

  /** Ленивый перенос старых `applied` перед каждым чтением; идемпотентен. */
  list(candidateId: string): StoredApplication[] {
    const legacyApplied = this.legacyApplications
      .list(candidateId)
      .filter((application) => application.status === 'applied')
      .map((application) => ({
        clusterId: application.clusterId,
        vacancy: application.vacancy,
        appliedAt: application.appliedAt,
      }));
    this.applications.migrateLegacyApplied(candidateId, legacyApplied);
    return this.applications.list(candidateId);
  }

  create(candidateId: string, input: CreateApplicationInput): StoredApplication {
    return this.applications.create(candidateId, input);
  }

  patch(
    candidateId: string,
    applicationId: string,
    input: PatchApplicationInput,
  ): StoredApplication {
    return this.applications.patch(candidateId, applicationId, input);
  }
}
