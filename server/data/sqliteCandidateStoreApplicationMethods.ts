import type { VacancyApplication, VacancyApplicationSnapshot } from '../../shared/vacancyApplication';
import type { VacancyApplicationInput } from './sqliteVacancyApplicationRepository';
import type { CreateApplicationInput, PatchApplicationInput } from './sqliteApplicationRepository';
import type { ApplicationStage } from '../../shared/applicationStage';
import type { SkipReasonId } from '../../shared/skipReasons';
import type { VacancyDecision } from '../vacancies/applyVacancyDecisions';
import type { ApplicationView } from '../domain/applicationDerivedFields';
import type {
  ApplicationTrackerController,
  ReadApplicationOptions,
} from './store/applicationTrackerController';
import type { ApplicationMaterialRole, StoredApplicationMaterial } from './sqliteApplicationMaterialsRepository';
import type {
  CreateInterviewInput,
  PatchInterviewInput,
  StoredApplicationInterview,
} from './sqliteApplicationInterviewRepository';
import type { ApplicationOfferTerms, StoredApplicationOffer } from './sqliteApplicationOfferRepository';
import type { StoredVacancySkip, VacancySkipOrigin } from './sqliteVacancySkipRepository';
import type { DatabaseSync } from 'node:sqlite';
import type { CandidateInterviewSubject } from './candidateStore';
import type { RecordVisitResult } from './sqliteCandidateVisitRepository';

/**
 * Every `CandidateStore` method that only checks the candidate exists and
 * forwards to `ApplicationTrackerController` (B251, S1–S2). Pulled out of
 * `SqliteCandidateStore` to keep that file under the 800-line gate; wired in
 * via `Object.assign(this, createApplicationTrackerMethods(...))` in its
 * constructor, with the fields declared there for `implements CandidateStore`.
 */
export interface ApplicationTrackerMethods {
  getInterviewSubject(
    candidateId: string,
    interviewId: string,
  ): CandidateInterviewSubject | null;
  listVacancyApplications(candidateId: string): VacancyApplication[];
  recordVacancyApplication(candidateId: string, input: VacancyApplicationInput): VacancyApplication;
  listApplications(candidateId: string, options?: ReadApplicationOptions): ApplicationView[];
  getApplication(candidateId: string, applicationId: string): ApplicationView | null;
  createApplication(
    candidateId: string,
    input: CreateApplicationInput & { manualVacancy?: VacancyApplicationSnapshot },
  ): ApplicationView;
  patchApplication(
    candidateId: string,
    applicationId: string,
    input: PatchApplicationInput,
    archiveStaleDays?: number,
  ): ApplicationView;
  restoreApplication(
    candidateId: string,
    applicationId: string,
    expectedVersion: number,
    archiveStaleDays?: number,
  ): ApplicationView;
  recordApplicationEvent(
    candidateId: string,
    applicationId: string,
    input: { kind: 'follow_up_sent' | 'thank_you_sent' | 'promise'; occurredAt: string; note?: string | null },
  ): ApplicationView;
  applicationFunnel(candidateId: string): Record<ApplicationStage, number> & { opened: number };
  linkApplicationMaterial(
    candidateId: string,
    applicationId: string,
    role: ApplicationMaterialRole,
    documentId: string,
  ): StoredApplicationMaterial;
  createApplicationInterview(
    candidateId: string,
    applicationId: string,
    input: CreateInterviewInput,
  ): StoredApplicationInterview;
  patchApplicationInterview(
    candidateId: string,
    applicationId: string,
    interviewId: string,
    input: PatchInterviewInput,
  ): StoredApplicationInterview;
  putApplicationOffer(
    candidateId: string,
    applicationId: string,
    terms: ApplicationOfferTerms,
    respondBy: string | null,
  ): StoredApplicationOffer;
  getApplicationOffer(
    candidateId: string,
    applicationId: string,
  ): StoredApplicationOffer | null;
  listApplicationOffers(
    candidateId: string,
  ): StoredApplicationOffer[];
  listVacancySkips(candidateId: string): StoredVacancySkip[];
  createVacancySkip(
    candidateId: string,
    input: { clusterId: string; reasonId: SkipReasonId; origin: VacancySkipOrigin },
  ): StoredVacancySkip;
  deleteVacancySkip(candidateId: string, clusterId: string): boolean;
  listVacancyDecisions(candidateId: string): VacancyDecision[];
  recordCandidateVisit(candidateId: string, now: string): RecordVisitResult;
  getSinceLastVisit(candidateId: string): string | null;
  countSystemClosuresSince(candidateId: string, since: string): number;
  countCompanyEventsSince(candidateId: string, since: string): number;
}

type RequireCandidate = (candidateId: string) => void;

function createCoreApplicationMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: RequireCandidate,
): Pick<
  ApplicationTrackerMethods,
  | 'listVacancyApplications'
  | 'recordVacancyApplication'
  | 'listApplications'
  | 'getApplication'
  | 'createApplication'
  | 'recordApplicationEvent'
  | 'applicationFunnel'
> {
  return {
    listVacancyApplications(candidateId) {
      requireCandidate(candidateId);
      return tracker.listLegacy(candidateId);
    },
    recordVacancyApplication(candidateId, input) {
      requireCandidate(candidateId);
      return tracker.recordLegacy(candidateId, input);
    },
    listApplications(candidateId, options) {
      requireCandidate(candidateId);
      return tracker.list(candidateId, options);
    },
    getApplication(candidateId, applicationId) {
      requireCandidate(candidateId);
      return tracker.get(candidateId, applicationId);
    },
    createApplication(candidateId, input) {
      requireCandidate(candidateId);
      return tracker.create(candidateId, input);
    },
    recordApplicationEvent(candidateId, applicationId, input) {
      requireCandidate(candidateId);
      return tracker.recordEvent(candidateId, applicationId, input);
    },
    applicationFunnel(candidateId) {
      requireCandidate(candidateId);
      return tracker.funnel(candidateId);
    },
  };
}

function createApplicationMutationMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: RequireCandidate,
): Pick<ApplicationTrackerMethods, 'patchApplication' | 'restoreApplication'> {
  return {
    patchApplication(candidateId, applicationId, input, archiveStaleDays) {
      requireCandidate(candidateId);
      return tracker.patch(candidateId, applicationId, input, archiveStaleDays);
    },
    restoreApplication(candidateId, applicationId, expectedVersion, archiveStaleDays) {
      requireCandidate(candidateId);
      return tracker.restoreFromArchive(candidateId, applicationId, expectedVersion, archiveStaleDays);
    },
  };
}

function parseInterviewSnapshot(raw: string | null) {
  if (!raw) return {};
  try {
    const snap = JSON.parse(raw) as { title?: string; company?: string };
    return { vacancyTitle: snap.title, vacancyCompany: snap.company };
  } catch {
    return {};
  }
}

function queryInterviewSubject(
  database: DatabaseSync,
  candidateId: string,
  interviewId: string,
) {
  const row = database
    .prepare(
      `SELECT i.id, i.application_id, i.round, i.scheduled_at,
              a.stage, a.vacancy_snapshot, a.cluster_id
       FROM application_interviews i
       JOIN applications a ON a.id = i.application_id
       WHERE i.id = ? AND a.candidate_id = ?`,
    )
    .get(interviewId, candidateId) as
    | {
        id: string;
        application_id: string;
        round: number;
        scheduled_at: string | null;
        stage: string;
        vacancy_snapshot: string | null;
        cluster_id: string | null;
      }
    | undefined;
  if (!row) return null;
  const { vacancyTitle, vacancyCompany } = parseInterviewSnapshot(row.vacancy_snapshot);
  return {
    id: row.id,
    applicationId: row.application_id,
    round: row.round,
    scheduledAt: row.scheduled_at,
    stage: row.stage,
    vacancyTitle,
    vacancyCompany,
  };
}

function createInterviewApplicationMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<
  ApplicationTrackerMethods,
  | 'linkApplicationMaterial'
  | 'createApplicationInterview'
  | 'patchApplicationInterview'
  | 'putApplicationOffer'
  | 'getApplicationOffer'
  | 'listApplicationOffers'
  | 'getInterviewSubject'
> {
  return {
    getInterviewSubject(candidateId, interviewId) {
      requireCandidate(candidateId);
      return queryInterviewSubject(database, candidateId, interviewId);
    },
    linkApplicationMaterial(candidateId, applicationId, role, documentId) {
      requireCandidate(candidateId);
      return tracker.linkMaterial(candidateId, applicationId, role, documentId);
    },
    createApplicationInterview(candidateId, applicationId, input) {
      requireCandidate(candidateId);
      return tracker.createInterview(candidateId, applicationId, input);
    },
    patchApplicationInterview(candidateId, applicationId, interviewId, input) {
      requireCandidate(candidateId);
      return tracker.patchInterview(candidateId, applicationId, interviewId, input);
    },
    putApplicationOffer(candidateId, applicationId, terms, respondBy) {
      requireCandidate(candidateId);
      return tracker.putOffer(candidateId, applicationId, terms, respondBy);
    },
    getApplicationOffer(candidateId, applicationId) {
      requireCandidate(candidateId);
      return tracker.getOffer(candidateId, applicationId);
    },
    listApplicationOffers(candidateId) {
      requireCandidate(candidateId);
      return tracker.listOffers(candidateId);
    },
  };
}

function createVacancyJourneyMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: RequireCandidate,
): Pick<
  ApplicationTrackerMethods,
  | 'listVacancySkips'
  | 'createVacancySkip'
  | 'deleteVacancySkip'
  | 'listVacancyDecisions'
  | 'recordCandidateVisit'
  | 'getSinceLastVisit'
  | 'countSystemClosuresSince'
  | 'countCompanyEventsSince'
> {
  return {
    listVacancySkips(candidateId) {
      requireCandidate(candidateId);
      return tracker.listSkips(candidateId);
    },
    createVacancySkip(candidateId, input) {
      requireCandidate(candidateId);
      return tracker.createSkip(candidateId, input);
    },
    deleteVacancySkip(candidateId, clusterId) {
      requireCandidate(candidateId);
      return tracker.deleteSkip(candidateId, clusterId);
    },
    listVacancyDecisions(candidateId) {
      requireCandidate(candidateId);
      return tracker.listVacancyDecisions(candidateId);
    },
    recordCandidateVisit(candidateId, now) {
      requireCandidate(candidateId);
      return tracker.recordVisit(candidateId, now);
    },
    getSinceLastVisit(candidateId) {
      requireCandidate(candidateId);
      return tracker.getSinceLastVisit(candidateId);
    },
    countSystemClosuresSince(candidateId, since) {
      requireCandidate(candidateId);
      return tracker.countSystemClosuresSince(candidateId, since);
    },
    countCompanyEventsSince(candidateId, since) {
      requireCandidate(candidateId);
      return tracker.countCompanyEventsSince(candidateId, since);
    },
  };
}

export function createApplicationTrackerMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): ApplicationTrackerMethods {
  return {
    ...createCoreApplicationMethods(tracker, requireCandidate),
    ...createApplicationMutationMethods(tracker, requireCandidate),
    ...createInterviewApplicationMethods(tracker, requireCandidate, database),
    ...createVacancyJourneyMethods(tracker, requireCandidate),
  };
}
