import type { DatabaseSync } from 'node:sqlite';
import {
  SqliteApplicationRepository,
  type CreateApplicationInput,
  type PatchApplicationInput,
  type StoredApplication,
  type ApplicationEventKind,
} from '../sqliteApplicationRepository';
import type { SqliteVacancyApplicationRepository, VacancyApplicationInput } from '../sqliteVacancyApplicationRepository';
import { SqliteApplicationMaterialsRepository, type ApplicationMaterialRole, type StoredApplicationMaterial } from '../sqliteApplicationMaterialsRepository';
import {
  SqliteApplicationInterviewRepository,
  type CreateInterviewInput,
  type PatchInterviewInput,
  type StoredApplicationInterview,
} from '../sqliteApplicationInterviewRepository';
import { SqliteApplicationOfferRepository, type ApplicationOfferTerms, type StoredApplicationOffer } from '../sqliteApplicationOfferRepository';
import { SqliteVacancySkipRepository, type StoredVacancySkip, type VacancySkipOrigin } from '../sqliteVacancySkipRepository';
import { SqliteCandidateVisitRepository, type RecordVisitResult } from '../sqliteCandidateVisitRepository';
import type { SealedText } from '../sealedText';
import type { VacancyApplication, VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { SkipReasonId } from '../../../shared/skipReasons';
import type { VacancyDecision } from '../../vacancies/applyVacancyDecisions';
import { deriveApplicationFields, type ApplicationView } from '../../domain/applicationDerivedFields';
import { defaultProcessProfile } from '../../vacancies/processProfileDefault';
import { ApplicationNotFoundError } from './errors';

export interface ReadApplicationOptions {
  readonly now?: string;
  readonly timezoneOffsetMinutes?: number;
  /** `GET /applications` closed-vacancy check (architecture.md §4): reads several clusters by primary key, no pool scan. */
  readonly isVacancyGone?: (clusterId: string) => boolean;
}

/**
 * Связывает старый фасад (`vacancy_applications`) с трекером откликов
 * (B251, S1–S2, architecture.md §3–4). Владеет своими репозиториями, чтобы
 * `SqliteCandidateStore` не разрастался сверх гейта 800 строк.
 */
export class ApplicationTrackerController {
  private readonly applications: SqliteApplicationRepository;
  private readonly materials: SqliteApplicationMaterialsRepository;
  private readonly interviews: SqliteApplicationInterviewRepository;
  private readonly offers: SqliteApplicationOfferRepository;
  private readonly skips: SqliteVacancySkipRepository;
  private readonly visits: SqliteCandidateVisitRepository;

  constructor(
    database: DatabaseSync,
    sealedText: SealedText,
    private readonly legacyApplications: SqliteVacancyApplicationRepository,
  ) {
    this.applications = new SqliteApplicationRepository(database, sealedText);
    this.materials = new SqliteApplicationMaterialsRepository(database);
    this.interviews = new SqliteApplicationInterviewRepository(database, sealedText);
    this.offers = new SqliteApplicationOfferRepository(database, sealedText);
    this.skips = new SqliteVacancySkipRepository(database);
    this.visits = new SqliteCandidateVisitRepository(database);
  }

  listLegacy(candidateId: string): VacancyApplication[] {
    return this.legacyApplications.list(candidateId);
  }

  recordLegacy(candidateId: string, input: VacancyApplicationInput): VacancyApplication {
    const stored = this.legacyApplications.record(candidateId, input);
    if (input.status === 'applied') {
      this.applications.recordLegacyApplied(candidateId, input.clusterId, input.vacancy);
    }
    return stored;
  }

  /**
   * Ленивый перенос старых `applied` перед каждым чтением; идемпотентен.
   * Затем — автоматический архив карточек, чья вакансия пропала с площадки
   * (`options.isVacancyGone`), тоже идемпотентно.
   */
  list(candidateId: string, options: ReadApplicationOptions = {}): ApplicationView[] {
    const legacyApplied = this.legacyApplications
      .list(candidateId)
      .filter((application) => application.status === 'applied')
      .map((application) => ({
        clusterId: application.clusterId,
        vacancy: application.vacancy,
        appliedAt: application.appliedAt,
      }));
    this.applications.migrateLegacyApplied(candidateId, legacyApplied);
    const applications = this.applications.list(candidateId).map((application) => {
      if (!options.isVacancyGone || !application.clusterId) return application;
      if (application.stage === 'archived' || application.stage === 'rejected') return application;
      if (!options.isVacancyGone(application.clusterId)) return application;
      return this.applications.archiveClosedVacancy(candidateId, application, options.now);
    });
    return applications.map((application) => this.toView(application, options));
  }

  get(candidateId: string, id: string, options: ReadApplicationOptions = {}): ApplicationView | null {
    const application = this.applications.get(candidateId, id);
    return application ? this.toView(application, options) : null;
  }

  create(
    candidateId: string,
    input: CreateApplicationInput & { readonly manualVacancy?: VacancyApplicationSnapshot },
  ): ApplicationView {
    const vacancy = input.manualVacancy ?? input.vacancy;
    const created = this.applications.create(candidateId, {
      ...input,
      vacancy,
      processProfile: input.processProfile ?? defaultProcessProfile(vacancy?.title),
    });
    return this.toView(created, {});
  }

  patch(candidateId: string, applicationId: string, input: PatchApplicationInput): ApplicationView {
    return this.toView(this.applications.patch(candidateId, applicationId, input), {});
  }

  recordEvent(
    candidateId: string,
    applicationId: string,
    input: { kind: 'follow_up_sent' | 'thank_you_sent' | 'promise'; occurredAt: string; note?: string | null },
  ): ApplicationView {
    this.applications.recordEvent(candidateId, applicationId, input);
    return this.toView(this.mustGetOwn(candidateId, applicationId), {});
  }

  funnel(candidateId: string): Record<ApplicationStage, number> & { opened: number } {
    const opened = this.legacyApplications.list(candidateId).length;
    return { ...this.applications.funnel(candidateId), opened };
  }

  linkMaterial(
    candidateId: string,
    applicationId: string,
    role: ApplicationMaterialRole,
    documentId: string,
  ): StoredApplicationMaterial {
    this.mustGetOwn(candidateId, applicationId);
    const linked = this.materials.link(applicationId, role, documentId);
    this.applications.recordMaterialEvent(candidateId, applicationId, role, documentId);
    return linked;
  }

  createInterview(candidateId: string, applicationId: string, input: CreateInterviewInput): StoredApplicationInterview {
    this.mustGetOwn(candidateId, applicationId);
    return this.interviews.create(applicationId, input);
  }

  patchInterview(
    candidateId: string,
    applicationId: string,
    interviewId: string,
    input: PatchInterviewInput,
  ): StoredApplicationInterview {
    this.mustGetOwn(candidateId, applicationId);
    const patched = this.interviews.patch(applicationId, interviewId, input);
    if (!patched) throw new ApplicationNotFoundError();
    return patched;
  }

  putOffer(
    candidateId: string,
    applicationId: string,
    terms: ApplicationOfferTerms,
    respondBy: string | null,
  ): StoredApplicationOffer {
    this.mustGetOwn(candidateId, applicationId);
    return this.offers.put(applicationId, terms, respondBy);
  }

  listSkips(candidateId: string): StoredVacancySkip[] {
    return this.skips.list(candidateId);
  }

  createSkip(
    candidateId: string,
    input: { clusterId: string; reasonId: SkipReasonId; origin: VacancySkipOrigin },
  ): StoredVacancySkip {
    return this.skips.create(candidateId, input, (id, clusterId, reasonId) =>
      this.applications.archiveSavedByCluster(id, clusterId, reasonId),
    );
  }

  deleteSkip(candidateId: string, clusterId: string): boolean {
    return this.skips.delete(candidateId, clusterId);
  }

  /**
   * Decisions to apply to the matched pool after its cache read (architecture
   * §4, §7): `saved` cards and skips, never included in the cache key.
   */
  listVacancyDecisions(candidateId: string): VacancyDecision[] {
    const saved = this.applications
      .list(candidateId)
      .filter((application) => application.stage === 'saved' && application.clusterId)
      .map((application) => ({ clusterId: application.clusterId as string, status: 'saved' as const }));
    const skipped = this.skips
      .list(candidateId)
      .map((skip) => ({ clusterId: skip.clusterId, status: 'skipped' as const, skipReasonId: skip.reasonId }));
    return [...saved, ...skipped];
  }

  /** `POST /visits` (architecture.md §4): moves the mark only past 30 minutes. */
  recordVisit(candidateId: string, now: string): RecordVisitResult {
    return this.visits.recordVisit(candidateId, now);
  }

  /** `GET /today` reads the current mark without recording a visit. */
  getSinceLastVisit(candidateId: string): string | null {
    return this.visits.getSinceLastVisit(candidateId);
  }

  private mustGetOwn(candidateId: string, applicationId: string): StoredApplication {
    const application = this.applications.get(candidateId, applicationId);
    if (!application) throw new ApplicationNotFoundError();
    return application;
  }

  private toView(application: StoredApplication, options: ReadApplicationOptions): ApplicationView {
    const events = this.applications.listEvents(application.candidateId, application.id);
    const materials = this.materials.list(application.id);
    const interviews = this.interviews.list(application.id);
    const derived = deriveApplicationFields({
      application,
      events,
      materials,
      interviews,
      now: options.now,
      timezoneOffsetMinutes: options.timezoneOffsetMinutes,
    });
    return { ...application, ...derived };
  }
}

/** Kept for readability at call sites that only need the event-kind union. */
export type { ApplicationEventKind };
