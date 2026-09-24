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
import type { RecordVisitResult } from './sqliteCandidateVisitRepository';

/**
 * Every `CandidateStore` method that only checks the candidate exists and
 * forwards to `ApplicationTrackerController` (B251, S1–S2). Pulled out of
 * `SqliteCandidateStore` to keep that file under the 800-line gate; wired in
 * via `Object.assign(this, createApplicationTrackerMethods(...))` in its
 * constructor, with the fields declared there for `implements CandidateStore`.
 */
export interface ApplicationTrackerMethods {
  listVacancyApplications(candidateId: string): VacancyApplication[];
  recordVacancyApplication(candidateId: string, input: VacancyApplicationInput): VacancyApplication;
  listApplications(candidateId: string, options?: ReadApplicationOptions): ApplicationView[];
  createApplication(
    candidateId: string,
    input: CreateApplicationInput & { manualVacancy?: VacancyApplicationSnapshot },
  ): ApplicationView;
  patchApplication(candidateId: string, applicationId: string, input: PatchApplicationInput): ApplicationView;
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
  | 'createApplication'
  | 'patchApplication'
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
    createApplication(candidateId, input) {
      requireCandidate(candidateId);
      return tracker.create(candidateId, input);
    },
    patchApplication(candidateId, applicationId, input) {
      requireCandidate(candidateId);
      return tracker.patch(candidateId, applicationId, input);
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

function createArtifactApplicationMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: RequireCandidate,
): Pick<
  ApplicationTrackerMethods,
  | 'linkApplicationMaterial'
  | 'createApplicationInterview'
  | 'patchApplicationInterview'
  | 'putApplicationOffer'
  | 'listVacancySkips'
  | 'createVacancySkip'
  | 'deleteVacancySkip'
  | 'listVacancyDecisions'
  | 'recordCandidateVisit'
  | 'getSinceLastVisit'
  | 'countSystemClosuresSince'
> {
  return {
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
  };
}

export function createApplicationTrackerMethods(
  tracker: ApplicationTrackerController,
  requireCandidate: RequireCandidate,
): ApplicationTrackerMethods {
  return {
    ...createCoreApplicationMethods(tracker, requireCandidate),
    ...createArtifactApplicationMethods(tracker, requireCandidate),
  };
}
