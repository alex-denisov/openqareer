import type { FactProvenance, ImportPlatform, ImportWalk } from '../domain/factProvenance';
import type { EmployerRead } from './applicationEmployerReads';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type {
  ResumeVersionContent,
  ResumeVersionCreateResult,
  ResumeVersionCursor,
  ResumeVersionPage,
  ResumeVersionUpdateResult,
  StoredResumeVersion,
} from '../domain/resumeVersions';
import type { CareerStrategy } from '../../shared/careerStrategy';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import type { InterviewSession } from '../domain/interviewSimulator';
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
  CoachTurnStage,
  CoachTurnSubject,
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
import type {
  ResumeCandidateInput,
  ResumeDraft,
  ResumeFactRewriteRecord,
  ResumePendingFactRewrite,
} from '../domain/resumeDraft';
import type { FactRewriteProposal } from '../domain/experienceFactRewrite';
import type {
  RelocationConsentState,
  RelocationQuestionnaire,
} from '../../shared/relocationQuestionnaire';
import type { DownloadedMedia } from '../domain/candidateMedia';
import type { StoredCandidateMedia } from './sqliteCandidateMediaRepository';
import type { SqliteProfileRevisionRepository } from './sqliteProfileRevisionRepository';
import type { SqliteReferralTrackRepository } from './sqliteReferralTrackRepository';
import type { SqliteDecisionProfileRepository } from './sqliteDecisionProfileRepository';
import type { SqliteRelocationQuestionnaireRepository } from './sqliteRelocationQuestionnaireRepository';
import type { SqliteCareerVectorRepository } from './sqliteCareerVectorRepository';
import type { SqliteCareerDiaryRepository } from './sqliteCareerDiaryRepository';
import type { SqliteStarPrepRepository } from './sqliteStarPrepRepository';
import type { SqliteInterviewSimulatorRepository } from './sqliteInterviewSimulatorRepository';
import type { SqliteStarStoriesRepository, StoredStarStory } from './sqliteStarStoriesRepository';
import type { RoleSkillAssessmentRepository } from './sqliteRoleSkillAssessmentRepository';
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
import type { SqliteNotificationRepository } from './sqliteNotificationRepository';

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
  /** Facts of that import still in the profile; `factCount` is everything it brought (B541). */
  readonly keptFactCount: number;
  /** The last walk of the source's sections, if the source reports one (B541). */
  readonly walk?: ImportWalk;
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
  adaptationApplications: import('./adaptationApplications').AdaptationApplication[];
  interviewPractices: import('../../shared/careerDiary').CareerDiaryInterviewPractice[];
  relocationScenarios: import('../../shared/relocationScenario').SavedRelocationScenario[];
  documentContents: CandidateDocumentWithContent[];
  sourceConnections: ExportedNativeSourceConnection[];
  consultantConversations: ConsultantConversationExport[];
  executiveRequests: StoredExecutiveRequest[];
  /** Выбранная роль с историей решений (B180, срез 2). */
  careerStrategy: CareerStrategy | null;
  /** Ответы на задания «Какие роли мне подходят» (B180, срез 3). */
  workPreferences: StoredWorkPreferenceRun | null;
  /** Private relocation data is present only while its separate consent is active. */
  relocationQuestionnaire: RelocationQuestionnaire | null;
  relocationConsent: RelocationConsentState;
  /** Encrypted role assessment answers, evidence refs and results (B461). */
  roleSkillAssessments: RoleSkillAssessmentRun[];
  /** Candidate-owned reusable STAR stories (B466). */
  starStories: StoredStarStory[];
  /** Current encrypted mock-interview session (B356). */
  interviewSession: InterviewSession | null;
}

export interface LinkedInLanguageImportSnapshot {
  readonly capturedAt: string;
  readonly importedAt: string;
  readonly languages: readonly ResumeDraft['languages'][number][];
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
  /** Кто прочитал исходное резюме при последнем импорте; старые записи честно null. */
  reader: ResumeReaderProvenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeReaderProvenance {
  readonly method: 'model' | 'rules';
  /** Модель есть только при `method: model`; правила не получают выдуманный id. */
  readonly model: string | null;
  /** Ревизия инструкций модели; у правил промпта нет. */
  readonly promptRevision: string | null;
  readonly readAt: string;
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
  /** Set on snapshot reads only: where the fact came from (B541). */
  provenance?: FactProvenance;
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
  stage?: CoachTurnStage;
  subject?: CoachTurnSubject;
  stageContext?: string;
  isService?: boolean;
}

export interface ConsultantSummaryTask {
  readonly conversationId: string;
  readonly stage: CoachTurnStage;
  readonly messageCount: number;
}

export interface ConsultantConversationMessage extends CoachMessage {
  readonly createdAt: string;
}

export interface ConsultantConversationSummary {
  readonly id: string;
  readonly stage: CoachTurnStage;
  readonly openedAt: string;
  readonly lastMessageAt: string;
  readonly closedAt: string | null;
  readonly messageCount: number;
  readonly firstPhrase: string;
  readonly summary: string | null;
}

export interface ConsultantConversationDetail extends ConsultantConversationSummary {
  readonly messages: ConsultantConversationMessage[];
}

export interface ConsultantConversationExport extends ConsultantConversationDetail {
  readonly summaries: Array<{
    readonly version: number;
    readonly messageCount: number;
    readonly summary: string;
    readonly createdAt: string;
  }>;
}

export interface ConsultantConversationPage {
  readonly items: ConsultantConversationSummary[];
  readonly nextCursor: string | null;
}

export interface ConsultantSummaryInputRequest {
  readonly conversationId: string;
  readonly stage: CoachTurnStage;
  readonly messageCount: number;
}

export interface ConsultantRejection {
  proposalKey: string;
  reason: string | null;
  createdAt: string;
}

export type StartedTurn =
  | {
      state: 'ready';
      readonly closedConversations?: ConsultantSummaryTask[];
      input: {
        candidateReference: string;
        dataClass: CandidateIdentity['dataClass'];
        locale: CandidateIdentity['locale'];
        phase: CoachPhase;
        messages: CoachMessage[];
        knowledgeContext: NonNullable<CoachTurnInput['knowledgeContext']>;
        resumeContext?: CoachTurnInput['resumeContext'];
        careerContext?: CoachTurnInput['careerContext'];
        modelTier?: CoachTurnInput['modelTier'];
        stageContext?: string;
        rejectedProposals?: string[];
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
  /** The platform the facts came from, recorded so provenance never parses the label (B541). */
  readonly platform?: ImportPlatform;
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
  /** Передаётся только импортом; ручное сохранение сохраняет прежнюю запись. */
  readonly reader?: ResumeReaderProvenance | null;
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
  /** Candidate inbox and preferences share the candidate SQLite database. */
  readonly notificationRepository?: SqliteNotificationRepository;
  /** Candidate-scoped, encrypted profile revision journal on the same SQLite connection. */
  readonly profileRevisionRepo: SqliteProfileRevisionRepository;
  /** Подготовка STAR на отклик (B392), запечатанный текст кандидата. */
  readonly starPrepRepo: SqliteStarPrepRepository;
  /** Повторно используемые STAR-истории кандидата (B466), текст запечатан. */
  readonly starStoriesRepo: SqliteStarStoriesRepository;
  readonly interviewSimulatorRepo: SqliteInterviewSimulatorRepository;
  readonly roleSkillAssessments: RoleSkillAssessmentRepository;
  /** Попытки квиза по навыку профиля (блок A, пакет 3); вопросы запечатаны. */
  readonly skillQuizAttempts?: import('./sqliteSkillQuizAttemptRepository').SkillQuizAttemptRepository;
  /** Трек внутренней рекомендации на отклик (B389), контакт запечатан. */
  readonly referralTrackRepo: SqliteReferralTrackRepository;
  /** Вектор перехода кандидата (B383), гипотеза. */
  readonly careerVectorRepo: SqliteCareerVectorRepository;
  /** Карьерный дневник: кандидатские цели, замеры и разборы (B456). */
  readonly careerDiaryRepo: SqliteCareerDiaryRepository;
  /** Профиль ограничений кандидата (B384), запечатан. */
  readonly decisionProfileRepo: SqliteDecisionProfileRepository;
  /** Separate, encrypted relocation questionnaire and purpose-specific consent. */
  readonly relocationQuestionnaireRepo: SqliteRelocationQuestionnaireRepository;
  /** Joins nested store writes into one SQLite transaction. */
  transaction<T>(operation: () => T): T;
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
  /** Facts the extractor listed from the candidate's answer, proposed for review (26.10). */
  proposeCandidateFacts(candidateId: string, facts: CoachProviderResult['result']['memoryCandidates']): void;
  failTurn(
    candidateId: string,
    idempotencyKey: string,
    errorCode: string,
  ): void;
  getCoachTurn(candidateId: string, key: string): { status: StoredTurn['status']; result: CoachTurnResult | null } | null;
  /** Rewrites a completed turn's result; `false` when the turn is not completed (28.10). */
  updateCoachTurnResult?(
    candidateId: string,
    key: string,
    update: (result: CoachTurnResult) => CoachTurnResult,
  ): boolean;
  getSnapshot(candidateId: string, stage?: CoachTurnStage): CandidateSnapshot;
  /** B561: only the resume's candidate block (name, contacts), without the whole snapshot. */
  getResumeCandidate(candidateId: string): ResumeCandidateInput | null;
  /** Minimal language facts from the candidate's latest stored LinkedIn import; never calls LinkedIn. */
  getLinkedInLanguageImport(candidateId: string): LinkedInLanguageImportSnapshot | null;
  getMessages(
    candidateId: string,
    stage?: CoachTurnStage,
    subject?: CoachTurnSubject,
  ): CoachMessage[];
  listConsultantConversations(
    candidateId: string,
    options?: { readonly cursor?: string; readonly limit?: number },
  ): ConsultantConversationPage;
  getConsultantConversation(
    candidateId: string,
    conversationId: string,
  ): ConsultantConversationDetail | null;
  deleteConsultantConversation(candidateId: string, conversationId: string): boolean;
  exportConsultantConversations(candidateId: string): ConsultantConversationExport[];
  listPendingConsultantSummaries(candidateId: string): ConsultantSummaryTask[];
  getConsultantSummaryInput(
    candidateId: string,
    task: ConsultantSummaryTask,
  ): CoachTurnInput | null;
  saveConsultantSummary(
    candidateId: string,
    task: ConsultantSummaryTask,
    result: CoachProviderResult,
  ): boolean;
  claimConsultantSummary(candidateId: string, task: ConsultantSummaryTask): boolean;
  releaseConsultantSummaryClaim(candidateId: string, task: ConsultantSummaryTask): void;
  rejectConsultantProposal(
    candidateId: string,
    proposalKey: string,
    reason?: string,
  ): void;
  getConsultantRejections(candidateId: string): ConsultantRejection[];
  withdrawConsultantRejection(candidateId: string, proposalKey: string): void;
  addManualExperienceFact(
    candidateId: string,
    memoryId: string,
    statement: string,
    experienceId?: string,
  ): StoredMemory;
  changeMemory(
    candidateId: string,
    memoryId: string,
    change: MemoryChange,
  ): StoredMemory | null;
  /** The consultant's rewrite of conversation facts, accepted by the candidate in one step. */
  applyExperienceFactRewrite(
    candidateId: string,
    proposal: FactRewriteProposal,
    isCurrent: (snapshot: CandidateSnapshot) => boolean,
  ): ResumeFactRewriteRecord;
  revertExperienceFactRewrite(candidateId: string, rewriteId: string): boolean;
  /** Keeps the shown proposal on the draft; false when the facts changed meanwhile. */
  saveFactRewriteProposal(
    candidateId: string,
    pending: ResumePendingFactRewrite,
    isCurrent: (snapshot: CandidateSnapshot) => boolean,
  ): boolean;
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
  /** Keeps the last section walk of a source so the profile shows it after a reload (B541). */
  saveImportWalk(candidateId: string, walk: ImportWalk): void;
  commitResumeImport(
    candidateId: string,
    input: ResumeImportCommit,
  ): CommittedResumeImport;
  /** Imports a platform as the profile's only source; other platforms stay connected without facts. */
  replaceProfileWithImport(
    candidateId: string,
    input: ResumeImportCommit & { readonly sourceReceipt: NativeSourceReceiptInput },
  ): CommittedResumeImport;
  /** Connects a platform without importing anything into the profile. */
  connectNativeSourceOnly(
    candidateId: string,
    receipt: NativeSourceReceiptInput,
    sourceLabel: string,
  ): StoredNativeSourceConnection;
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
  saveDocumentAndLinkApplicationMaterial(
    candidateId: string,
    applicationId: string,
    role: ApplicationMaterialRole,
    input: CandidateDocumentInput,
  ): {
    created: boolean;
    document: StoredCandidateDocument;
    material: StoredApplicationMaterial;
  };
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

  getApplication(candidateId: string, applicationId: string): ApplicationView | null;

  createApplication(
    candidateId: string,
    input: CreateApplicationInput & { manualVacancy?: import('../../shared/vacancyApplication').VacancyApplicationSnapshot },
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

  /** Applied to the matched pool after its cache read; never part of the cache key (architecture.md §4, §7). */
  listVacancyDecisions(candidateId: string): VacancyDecision[];

  /** `POST /visits` (architecture.md §4): moves the mark only past 30 minutes. */
  recordCandidateVisit(candidateId: string, now: string): RecordVisitResult;

  /** `GET /today` reads the current mark without recording a visit. */
  getSinceLastVisit(candidateId: string): string | null;

  /** `GET /today`: applications this candidate's tracker closed on its own since `since`. */
  countSystemClosuresSince(candidateId: string, since: string): number;

  /** `GET /today`: stage moves only the company could have caused since `since`. */
  countCompanyEventsSince(candidateId: string, since: string): number;
  /** B542: рекрутер или собеседник отклика, которого называет напоминание «Сегодня». */
  listApplicationContacts?(candidateId: string): ReadonlyMap<string, string>;
  setApplicationContact?(candidateId: string, applicationId: string, name: string | null): void;
  /** B543: «Работодатель прочитал» — время и источник (кандидат или hh.ru). */
  getEmployerRead?(candidateId: string, applicationId: string): EmployerRead | null;
  markEmployerRead?(candidateId: string, applicationId: string, mark: EmployerRead): EmployerRead;
  clearEmployerRead?(candidateId: string, applicationId: string): boolean;
  /** B266: a paid-plan request, idempotent per candidate and plan. */
  requestPlan?(candidateId: string, planId: PlanRequestId, note?: string): StoredPlanRequest;
  listPlanRequests?(candidateId: string): StoredPlanRequest[];
  /** B471: candidate-owned Executive intake, idempotent by client request key. */
  createExecutiveRequest?(
    candidateId: string,
    input: ExecutiveRequestInput,
    capacity: number,
  ): {
    readonly request: StoredExecutiveRequest;
    readonly created: boolean;
    readonly replayed: boolean;
  };
  listExecutiveRequests?(
    candidateId: string,
    query: ExecutiveRequestPageQuery,
  ): ExecutiveRequestPage<StoredExecutiveRequest>;
  getExecutiveRequest?(
    candidateId: string,
    requestId: string,
  ): StoredExecutiveRequest | null;
  listExecutiveRequestQueue?(
    query: ExecutiveRequestQueueQuery,
  ): ExecutiveRequestPage<StoredExecutiveRequest & { readonly candidateId: string }>;
  setExecutiveRequestStatus?(
    requestId: string,
    status: ExecutiveRequestStatus,
    capacity: number,
  ): StoredExecutiveRequest | null;

  getWorkPreferenceRun(candidateId: string): StoredWorkPreferenceRun | null;

  saveWorkPreferenceRun(
    candidateId: string,
    run: StoredWorkPreferenceRun,
  ): StoredWorkPreferenceRun;

  getCareerStrategy(candidateId: string): CareerStrategy | null;

  saveCareerStrategy(candidateId: string, strategy: CareerStrategy): CareerStrategy;

  getCandidateWorkspace(candidateId: string): CandidateWorkspaceState | null;

  /** Недавние посетители с явной кампанией; id остаётся только в памяти HTTP-процесса. */
  listRecentCampaignCandidateIds?(since: string): string[];

  completeCandidateWorkspace?(candidateId: string, workspace: CandidateWorkspaceState): CandidateWorkspaceState;
  getSeoGoalSummary?(days?: number): import('../../shared/seoSummary').SeoGoalSummary;

  saveCandidateWorkspace(
    candidateId: string,
    workspace: CandidateWorkspaceState,
  ): CandidateWorkspaceState;

  saveResumeDraft(
    candidateId: string,
    draft: ResumeDraft,
    evidenceSnapshot: readonly ResumeEvidenceSnapshot[],
  ): StoredResumeDraft;
  createResumeVersion(
    candidateId: string,
    versionId: string,
    sourceMasterRevision: string,
    content: ResumeVersionContent,
  ): ResumeVersionCreateResult;
  getResumeVersion(candidateId: string, versionId: string): StoredResumeVersion | null;
  listResumeVersions(
    candidateId: string,
    options: { readonly limit: number; readonly cursor: ResumeVersionCursor | null },
  ): ResumeVersionPage;
  updateResumeVersion(
    candidateId: string,
    versionId: string,
    expectedRevision: number,
    expectedMasterRevision: string,
    content: ResumeVersionContent,
  ): ResumeVersionUpdateResult;
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
  getInterviewSubject(
    candidateId: string,
    interviewId: string,
  ): CandidateInterviewSubject | null;
  exportCandidate(candidateId: string): CandidateExport;
  deleteCandidate(candidateId: string): boolean;
  close(): void;
}

export interface CandidateInterviewSubject {
  readonly id: string;
  readonly applicationId: string;
  readonly round: number;
  readonly scheduledAt: string | null;
  readonly stage: string;
  readonly vacancyTitle?: string;
  readonly vacancyCompany?: string;
}

export type PlanRequestId = 'consultant' | 'automation';

export interface StoredPlanRequest {
  readonly planId: PlanRequestId;
  readonly createdAt: string;
}

export type ExecutiveRequestStatus =
  | 'submitted'
  | 'waitlisted'
  | 'in_review'
  | 'accepted'
  | 'declined'
  | 'completed';

export interface ExecutiveRequestInput {
  readonly task: string;
  readonly timeline: string;
  readonly profileSharingConsent: true;
  readonly idempotencyKey: string;
}

export interface StoredExecutiveRequest {
  readonly id: string;
  readonly task: string;
  readonly timeline: string;
  readonly status: ExecutiveRequestStatus;
  readonly profileSharingConsent: boolean;
  readonly profileSharingConsentAt: string | null;
  readonly profileSharingConsentVersion: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutiveRequestPageQuery {
  readonly limit: number;
  readonly cursor?: string;
}

export interface ExecutiveRequestQueueQuery extends ExecutiveRequestPageQuery {
  readonly status?: ExecutiveRequestStatus;
}

export interface ExecutiveRequestPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
