import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { CareerStrategy } from '../../shared/careerStrategy';
import type { StoredWorkPreferenceRun } from './sqliteWorkPreferenceRepository';
import type { VacancyApplicationInput } from './sqliteVacancyApplicationRepository';
import type { VacancyApplication } from '../../shared/vacancyApplication';
import type { CreateApplicationInput, PatchApplicationInput } from './sqliteApplicationRepository';
import type { ApplicationStage } from '../../shared/applicationStage';
import type { SkipReasonId } from '../../shared/skipReasons';
import type { VacancyDecision } from '../vacancies/applyVacancyDecisions';
import type { ApplicationView } from '../domain/applicationDerivedFields';
import type { ReadApplicationOptions } from './store/applicationTrackerController';
import type { ApplicationMaterialRole, StoredApplicationMaterial } from './sqliteApplicationMaterialsRepository';
import type {
  CreateInterviewInput,
  PatchInterviewInput,
  StoredApplicationInterview,
} from './sqliteApplicationInterviewRepository';
import type { ApplicationOfferTerms, StoredApplicationOffer } from './sqliteApplicationOfferRepository';
import type { StoredVacancySkip, VacancySkipOrigin } from './sqliteVacancySkipRepository';
import type { RecordVisitResult } from './sqliteCandidateVisitRepository';
import type {
  CoachMessage,
  CoachPhase,
  CoachTurnInput,
  CoachTurnResult,
  MemoryCandidate,
} from '../domain/coach';
import type { ExperienceDossier } from '../domain/dossier';
import type {
  GermanyMarketResult,
  GermanyMarketSubmission,
} from '../domain/germanyMarket';
import type {
  AssessmentId,
  AssessmentResult,
  AssessmentSubmission,
} from '../domain/assessment';
import type { ResumeEvidenceSnapshot } from '../domain/resumeStudio';
import type { ResumeDraft } from '../domain/resumeDraft';
import type { DownloadedMedia } from '../domain/candidateMedia';
import type { StoredCandidateMedia } from './sqliteCandidateMediaRepository';
import type { CoachProviderResult } from '../providers/coachProvider';
import type { ConnectorActionRecord } from '../connectors/connectorActionQueue';
import type {
  CareerCommandRecord,
  VerifiedCareerApproval,
} from '../orchestration/careerCommandPlanner';
import type {
  StoredVacancy,
  StoredVacancySubscription,
  ClaimedVacancySubscription,
  VacancyRefreshResult,
  VacancySample,
  VacancySourceHealth,
  VacancySubscriptionInput,
} from '../domain/vacancy';

export interface CandidateIdentity {
  id: string;
  dataClass: 'synthetic' | 'personal';
  locale: 'ru-RU' | 'en-US';
  createdAt: string;
}

export interface CandidateCredentials extends CandidateIdentity {
  accessToken: string;
}

/**
 * Safe metadata about a platform import, carried by the snapshot the cabinet
 * already reads. Resume Studio needs to name the source of the document it
 * shows (B172), and the connection catalogue is deliberately not loaded until
 * the candidate opens account settings — so the fact travels with the dossier,
 * not as a second request.
 */
export interface ImportedSourceSummary {
  readonly platform: NativeSourceReceiptInput['platform'];
  readonly connectedAt: string;
  readonly lastImportedAt: string;
  readonly factCount: number;
}

export interface CandidateSnapshot {
  candidate: CandidateIdentity;
  importedSources: ImportedSourceSummary[];
  messages: CoachMessage[];
  memory: StoredMemory[];
  turns: StoredTurn[];
  dossier: ExperienceDossier;
  assessments: StoredAssessment[];
  germanyMarket: StoredGermanyMarket | null;
  resume: StoredResumeDraft | null;
  documents: StoredCandidateDocument[];
  vacancySubscriptions: StoredVacancySubscription[];
}

export interface CandidateExport extends CandidateSnapshot {
  documentContents: CandidateDocumentWithContent[];
  sourceConnections: ExportedNativeSourceConnection[];
  /** Выбранная роль с историей решений (B180, срез 2). */
  careerStrategy: CareerStrategy | null;
  /** Ответы на задания «Какие роли мне подходят» (B180, срез 3). */
  workPreferences: StoredWorkPreferenceRun | null;
}

type CandidateDocumentKind =
  | 'resume'
  | 'cover_letter'
  | 'certificate'
  | 'portfolio'
  | 'profile_export'
  | 'other';

export interface CandidateDocumentInput {
  kind: CandidateDocumentKind;
  source: 'upload' | 'generated' | 'import';
  fileName: string;
  mimeType: string;
  contentBase64: string;
  extractedText?: string;
  parseStatus: 'pending' | 'ready' | 'failed' | 'not_applicable';
  replacesDocumentId?: string;
}

export interface StoredCandidateDocument {
  id: string;
  familyId: string;
  version: number;
  kind: CandidateDocumentKind;
  source: CandidateDocumentInput['source'];
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  parseStatus: CandidateDocumentInput['parseStatus'];
  retentionUntil: string | null;
  supersedesDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateDocumentWithContent extends StoredCandidateDocument {
  contentBase64: string;
  extractedText: string | null;
}

export interface StoredResumeDraft {
  draft: ResumeDraft;
  evidenceSnapshot: ResumeEvidenceSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredGermanyMarket {
  country: 'DE';
  submission: GermanyMarketSubmission;
  result: GermanyMarketResult;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAssessment {
  assessmentId: AssessmentId;
  submission: AssessmentSubmission;
  result: AssessmentResult;
  completedAt: string;
  updatedAt: string;
}

export interface StoredMemory extends MemoryCandidate {
  id: string;
  status: 'proposed' | 'confirmed' | 'corrected';
  createdAt: string;
  updatedAt: string;
}

export interface StoredTurn {
  idempotencyKey: string;
  phase: CoachPhase;
  status: 'pending' | 'failed' | 'completed';
  result: CoachTurnResult | null;
  provenance: {
    provider: CoachProviderResult['provider'];
    model: string;
    responseId: string;
    usage: CoachProviderResult['usage'];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnRequest {
  messageId: string;
  content: string;
  marketQuery?: string;
  phase: CoachPhase;
}

export type StartedTurn =
  | {
      state: 'ready';
      input: {
        candidateReference: string;
        dataClass: CandidateIdentity['dataClass'];
        locale: CandidateIdentity['locale'];
        phase: CoachPhase;
        messages: CoachMessage[];
        knowledgeContext: NonNullable<CoachTurnInput['knowledgeContext']>;
      };
    }
  | {
      state: 'completed';
      output: CoachProviderResult;
    };

export interface MemoryChange {
  action: 'confirm' | 'correct' | 'delete';
  statement?: string;
}

export interface ResumeEvidenceImport {
  /** Shown in the conversation so the candidate sees where the facts came from. */
  readonly sourceLabel: string;
  /**
   * A stable identifier of the source document (candidate-scoped hash of its
   * raw text). Reimporting the same digest reuses the same conversation
   * message instead of appending a duplicate "Импорт: ..." line (B247 S6).
   * Omitted callers keep the old always-insert behaviour.
   */
  readonly sourceDigest?: string;
  readonly entries: ReadonlyArray<{
    readonly memoryId: string;
    readonly domain: StoredMemory['domain'];
    readonly statement: string;
  }>;
}

export interface ImportedResumeEvidence {
  readonly messageId: string;
  readonly memoryIds: readonly string[];
}

export interface NativeSourceReceiptInput {
  readonly platform: 'hh' | 'linkedin';
  readonly accessMode: 'native_session_snapshot';
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly importDigest: string;
}

export interface StoredNativeSourceConnection {
  readonly id: string;
  readonly candidateId: string;
  readonly platform: NativeSourceReceiptInput['platform'];
  readonly accessMode: NativeSourceReceiptInput['accessMode'];
  readonly connectedAt: string;
  readonly lastImportedAt: string;
  readonly receipt: {
    readonly sourceUrl: string;
    readonly capturedAt: string;
    readonly sourceMessageId: string;
    readonly memoryIds: readonly string[];
    readonly factCount: number;
  };
}

type ExportedNativeSourceConnection = Pick<
  StoredNativeSourceConnection,
  'id' | 'platform' | 'accessMode' | 'connectedAt' | 'lastImportedAt'
> & {
  readonly capturedAt: string;
  readonly factCount: number;
};

export interface ResumeImportCommit {
  readonly evidence: ResumeEvidenceImport;
  readonly draft: ResumeDraft;
  readonly sourceReceipt?: NativeSourceReceiptInput;
  /**
   * Photo/logo bytes already downloaded by the caller (B265 §4) — the fetch
   * itself never runs inside this transaction, only the sealed write of what
   * came back.
   */
  readonly media?: readonly DownloadedMedia[];
}

export interface CommittedResumeImport {
  readonly evidence: ImportedResumeEvidence;
  readonly resume: StoredResumeDraft;
  readonly sourceConnection?: StoredNativeSourceConnection;
  readonly idempotentReplay: boolean;
}

export interface CandidateStore {
  createCandidate(input: {
    dataClass: CandidateIdentity['dataClass'];
    locale: CandidateIdentity['locale'];
  }): CandidateCredentials;
  authenticate(accessToken: string): CandidateIdentity | null;
  startTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): StartedTurn;
  completeTurn(
    candidateId: string,
    idempotencyKey: string,
    output: CoachProviderResult,
  ): void;
  failTurn(
    candidateId: string,
    idempotencyKey: string,
    errorCode: string,
  ): void;
  getCoachTurn(candidateId: string, key: string): { status: StoredTurn['status']; result: CoachTurnResult | null } | null;
  getSnapshot(candidateId: string): CandidateSnapshot;
  changeMemory(
    candidateId: string,
    memoryId: string,
    change: MemoryChange,
  ): StoredMemory | null;
  /**
   * One candidate decision over a whole imported batch. An import can state
   * dozens of facts, and reviewing them one request at a time is not a review
   * the candidate would ever finish (B166). Returns `null` when any id is not
   * in this dossier — the batch is then applied to nothing at all.
   */
  reviewMemories(
    candidateId: string,
    memoryIds: readonly string[],
    action: 'confirm' | 'delete',
  ): number | null;
  /**
   * Writes the facts an imported resume stated as confirmed dossier memories
   * under caller-chosen ids, so the resume draft that cites them resolves. The
   * whole import is one transaction: a partially written dossier would leave
   * Resume Studio citing sources that do not exist (B148).
   */
  importResumeEvidence(
    candidateId: string,
    input: ResumeEvidenceImport,
  ): ImportedResumeEvidence;
  commitResumeImport(
    candidateId: string,
    input: ResumeImportCommit,
  ): CommittedResumeImport;
  listNativeSourceConnections(candidateId: string): StoredNativeSourceConnection[];
  findNativeSourceConnectionByDigest(
    candidateId: string,
    platform: NativeSourceReceiptInput['platform'],
    importDigest: string,
  ): StoredNativeSourceConnection | null;
  deleteNativeSourceConnection(
    candidateId: string,
    platform: NativeSourceReceiptInput['platform'],
  ): boolean;
  saveDocument(
    candidateId: string,
    input: CandidateDocumentInput,
  ): { created: boolean; document: StoredCandidateDocument };
  getDocument(
    candidateId: string,
    documentId: string,
  ): CandidateDocumentWithContent | null;
  deleteDocument(candidateId: string, documentId: string): boolean;
  setDocumentRetention(
    candidateId: string,
    documentId: string,
    retentionUntil: string | null,
    now: string,
  ): StoredCandidateDocument | null;
  purgeExpiredDocuments(now: string, limit: number): number;
  createVacancySubscription(
    candidateId: string,
    input: VacancySubscriptionInput,
    now: string,
  ): StoredVacancySubscription;
  listVacancySubscriptions(candidateId: string): StoredVacancySubscription[];
  getVacancySubscription(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancySubscription | null;
  recordVacancyRefresh(
    subscriptionId: string,
    sample: VacancySample,
  ): VacancyRefreshResult;
  listSubscriptionVacancies(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancy[];
  claimDueVacancySubscriptions(
    now: string,
    leaseUntil: string,
    limit: number,
  ): ClaimedVacancySubscription[];
  recordVacancyFailure(
    subscriptionId: string,
    errorCode: string,
    attemptedAt: string,
    retryAfterAt?: string,
  ): void;
  listVacancySourceHealth(): VacancySourceHealth[];
  setVacancySubscriptionStatus(
    candidateId: string,
    subscriptionId: string,
    status: StoredVacancySubscription['status'],
    now: string,
  ): StoredVacancySubscription | null;
  deleteVacancySubscription(
    candidateId: string,
    subscriptionId: string,
  ): boolean;
  saveAssessment(
    candidateId: string,
    assessmentId: AssessmentId,
    submission: AssessmentSubmission,
    result: AssessmentResult,
  ): StoredAssessment;
  saveGermanyMarket(
    candidateId: string,
    submission: GermanyMarketSubmission,
    result: GermanyMarketResult,
  ): StoredGermanyMarket;
  /**
   * The candidate's own wizard answers. Browser storage is a cache of this,
   * not the record — signing out must not erase a career context (INC-024).
   */
  /** Ручные отклики кандидата: открыто и подтверждено (B165, срез 1). */
  listVacancyApplications(candidateId: string): VacancyApplication[];

  recordVacancyApplication(
    candidateId: string,
    input: VacancyApplicationInput,
  ): VacancyApplication;

  /** Трекер откликов (B251, S1–S2). Ленивый перенос старых `applied` на первом чтении. */
  listApplications(candidateId: string, options?: ReadApplicationOptions): ApplicationView[];

  createApplication(
    candidateId: string,
    input: CreateApplicationInput & { manualVacancy?: import('../../shared/vacancyApplication').VacancyApplicationSnapshot },
  ): ApplicationView;

  patchApplication(
    candidateId: string,
    applicationId: string,
    input: PatchApplicationInput,
  ): ApplicationView;

  /** `POST /applications/:id/events` (B251, S2). */
  recordApplicationEvent(
    candidateId: string,
    applicationId: string,
    input: { kind: 'follow_up_sent' | 'thank_you_sent' | 'promise'; occurredAt: string; note?: string | null },
  ): ApplicationView;

  /** `GET /applications/funnel` (B251, S2). */
  applicationFunnel(candidateId: string): Record<ApplicationStage, number> & { opened: number };

  /** `PUT /applications/:id/materials/:role` (B251, S2). */
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

  /** Applied to the matched pool after its cache read; never part of the cache key (architecture.md §4, §7). */
  listVacancyDecisions(candidateId: string): VacancyDecision[];

  /** `POST /visits` (architecture.md §4): moves the mark only past 30 minutes. */
  recordCandidateVisit(candidateId: string, now: string): RecordVisitResult;

  /** `GET /today` reads the current mark without recording a visit. */
  getSinceLastVisit(candidateId: string): string | null;

  /** `GET /today`: applications this candidate's tracker closed on its own since `since`. */
  countSystemClosuresSince(candidateId: string, since: string): number;

  getWorkPreferenceRun(candidateId: string): StoredWorkPreferenceRun | null;

  saveWorkPreferenceRun(
    candidateId: string,
    run: StoredWorkPreferenceRun,
  ): StoredWorkPreferenceRun;

  getCareerStrategy(candidateId: string): CareerStrategy | null;

  saveCareerStrategy(candidateId: string, strategy: CareerStrategy): CareerStrategy;

  getCandidateWorkspace(candidateId: string): CandidateWorkspaceState | null;

  saveCandidateWorkspace(
    candidateId: string,
    workspace: CandidateWorkspaceState,
  ): CandidateWorkspaceState;

  saveResumeDraft(
    candidateId: string,
    draft: ResumeDraft,
    evidenceSnapshot: readonly ResumeEvidenceSnapshot[],
  ): StoredResumeDraft;
  /** Serves a cached photo/logo only to the candidate it belongs to (B265 §4). */
  getCandidateMedia(candidateId: string, mediaId: string): StoredCandidateMedia | null;
  saveCareerCommand(command: CareerCommandRecord): CareerCommandRecord;
  getCareerCommand(
    candidateId: string,
    commandId: string,
  ): CareerCommandRecord | null;
  listCareerCommands(candidateId: string): CareerCommandRecord[];
  approveCareerCommand(input: {
    candidateId: string;
    commandId: string;
    approval: VerifiedCareerApproval;
    consumedAt: string;
  }): CareerCommandRecord;
  claimCareerCommand(
    candidateId: string,
    commandId: string,
    execution: ConnectorActionRecord,
    claimedAt: string,
  ): CareerCommandRecord;
  finishCareerCommand(
    candidateId: string,
    commandId: string,
    command: CareerCommandRecord,
  ): CareerCommandRecord;
  exportCandidate(candidateId: string): CandidateExport;
  deleteCandidate(candidateId: string): boolean;
  close(): void;
}
