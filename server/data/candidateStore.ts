import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
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

export interface CandidateSnapshot {
  candidate: CandidateIdentity;
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
