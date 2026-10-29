import { recordCandidateGoal, readSeoGoalSummary } from './seoGoalRepository';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AssessmentId,
  AssessmentResult,
  AssessmentSubmission,
} from '../domain/assessment';
import type { ResumeEvidenceSnapshot } from '../domain/resumeStudio';
import type { ResumeDraft } from '../domain/resumeDraft';
import type {
  ResumeVersionContent,
  ResumeVersionCreateResult,
  ResumeVersionCursor,
  ResumeVersionPage,
  ResumeVersionUpdateResult,
  StoredResumeVersion,
} from '../domain/resumeVersions';
import type { CoachMessage, CoachTurnResult, CoachTurnStage, CoachTurnSubject } from '../domain/coach';
import type {
  CandidateCredentials,
  CandidateIdentity,
  CandidateSnapshot,
  CandidateStore,
  ConsultantRejection,
  MemoryChange,
  StartedTurn,
  StoredAssessment,
  StoredGermanyMarket,
  StoredMemory,
  ResumeEvidenceImport,
  ImportedResumeEvidence,
  StoredResumeDraft,
  TurnRequest,
  ResumeImportCommit,
  CommittedResumeImport,
  StoredNativeSourceConnection,
  NativeSourceReceiptInput,
} from './candidateStore';
import { insertPlanRequest, selectPlanRequests } from './store/planRequestStore';
import {
  exportExecutiveRequests,
} from './store/executiveRequestStore';
import { createSqliteCandidateStoreExecutiveRequestMethods } from './sqliteCandidateStoreExecutiveRequestMethods';
import { createSqliteCandidateStoreExportMethods } from './sqliteCandidateStoreExportMethods';
import type { ConnectorActionRecord } from '../connectors/connectorActionQueue';
import { SealedText } from './sealedText';
import type { SqliteAssessmentRepository } from './sqliteAssessmentRepository';
import type { SqliteMarketRepository } from './sqliteMarketRepository';
import type { SqliteResumeRepository } from './sqliteResumeRepository';
import type { SqliteResumeVersionRepository } from './sqliteResumeVersionRepository';
import type {
  SqliteCandidateMediaRepository,
  StoredCandidateMedia,
} from './sqliteCandidateMediaRepository';
import type { SqliteProfileRevisionRepository } from './sqliteProfileRevisionRepository';
import { createProfileRepositories } from './sqliteCandidateStoreProfileRepositories';
import type { SqliteReferralTrackRepository } from './sqliteReferralTrackRepository';
import type { SqliteDecisionProfileRepository } from './sqliteDecisionProfileRepository';
import type { SqliteRelocationQuestionnaireRepository } from './sqliteRelocationQuestionnaireRepository';
import { createSqliteCandidateStoreLinkedInMethods } from './linkedInLanguageImport';
import { runSqliteTransaction } from './sqliteTransaction';
import type { SqliteCareerVectorRepository } from './sqliteCareerVectorRepository';
import type { SqliteCareerDiaryRepository } from './sqliteCareerDiaryRepository';
import type { SqliteStarPrepRepository } from './sqliteStarPrepRepository';
import type { SqliteInterviewSimulatorRepository } from './sqliteInterviewSimulatorRepository';
import type { SqliteStarStoriesRepository } from './sqliteStarStoriesRepository';
import type { SqliteRoleSkillAssessmentRepository } from './sqliteRoleSkillAssessmentRepository';
import { factRewriteEdits } from '../domain/experienceFactRewrite';
import {
  createMemoryMethods,
  openCandidateDatabase,
  type MemoryMethods,
} from './sqliteCandidateStoreMemoryMethods';
import type { SqliteWorkspaceRepository } from './sqliteWorkspaceRepository';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { SqliteCareerCommandRepository } from './sqliteCareerCommandRepository';
import type { SqliteDocumentRepository } from './sqliteDocumentRepository';
import type { SqliteVacancyRepository } from './sqliteVacancyRepository';
import type { SqliteCareerStrategyRepository } from './sqliteCareerStrategyRepository';
import type {
  SqliteWorkPreferenceRepository,
  StoredWorkPreferenceRun,
} from './sqliteWorkPreferenceRepository';
import type { ApplicationTrackerController } from './store/applicationTrackerController';
import { createSqliteCandidateStoreRepositories } from './sqliteCandidateStoreRepositories';
import { SqliteNotificationRepository } from './sqliteNotificationRepository';
import {
  createApplicationTrackerMethods,
  type ApplicationTrackerMethods,
} from './sqliteCandidateStoreApplicationMethods';
import {
  createSqliteCandidateStoreDocumentMethods,
  type SqliteCandidateStoreDocumentMethods,
} from './sqliteCandidateStoreDocumentMethods';
import type { CareerStrategy } from '../../shared/careerStrategy';
import type {
  StoredVacancy,
  StoredVacancySubscription,
  ClaimedVacancySubscription,
  VacancySample,
  VacancySourceHealth,
  VacancyRefreshResult,
  VacancySubscriptionInput,
} from '../domain/vacancy';
import type {
  GermanyMarketResult,
  GermanyMarketSubmission,
} from '../domain/germanyMarket';
import type {
  CareerCommandRecord,
  VerifiedCareerApproval,
} from '../orchestration/careerCommandPlanner';
import { applyMigrations } from './store/applyMigrations';
import { ConversationController } from './store/conversationController';
import { ConsultantHistoryStore } from './store/consultantHistoryStore';
import {
  createSqliteCandidateStoreConsultantMethods,
  type ConsultantStoreMethods,
} from './sqliteCandidateStoreConsultantMethods';
import { SourceConnectionController } from './store/sourceConnectionController';
import {
  commitNewResumeImport as commitResumeImportWithDedupe,
  commitSourceConnectionOnly,
  findResumeImportReplay,
  replaceProfileWithImport,
} from './sqliteCandidateStoreResumeImport';
import {
  CandidateDocumentRetentionError,
  CandidateNotFoundError,
  CandidateStoreConflictError,
} from './store/errors';
import {
  candidateFromRow,
  hashToken,
  type CandidateRow,
  type SqliteStoreOptions,
} from './store/shared';
import { SQLITE_HTTP_BUSY_TIMEOUT_MS, applySqliteBusyTimeout } from './sqliteBusyTimeout';
import { resumeContextOf, withStoredTeamSizes } from './resumeTurnContext';
import { updateStoredTurnResult } from './store/turnResultUpdate';

export { CandidateNotFoundError, CandidateStoreConflictError, CandidateDocumentRetentionError };

export class SqliteCandidateStore implements CandidateStore {
  readonly notificationRepository: SqliteNotificationRepository;
  readonly profileRevisionRepo: SqliteProfileRevisionRepository;
  readonly starPrepRepo: SqliteStarPrepRepository;
  readonly starStoriesRepo: SqliteStarStoriesRepository;
  readonly interviewSimulatorRepo: SqliteInterviewSimulatorRepository;
  readonly roleSkillAssessments: SqliteRoleSkillAssessmentRepository;
  readonly skillQuizAttempts: import('./sqliteSkillQuizAttemptRepository').SqliteSkillQuizAttemptRepository;
  readonly referralTrackRepo: SqliteReferralTrackRepository;
  readonly careerVectorRepo: SqliteCareerVectorRepository;
  readonly careerDiaryRepo: SqliteCareerDiaryRepository;
  readonly decisionProfileRepo: SqliteDecisionProfileRepository;
  readonly relocationQuestionnaireRepo: SqliteRelocationQuestionnaireRepository;
  declare getLinkedInLanguageImport: CandidateStore['getLinkedInLanguageImport'];
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;
  private readonly assessmentsRepository: SqliteAssessmentRepository;
  private readonly marketRepository: SqliteMarketRepository;
  private readonly resumeRepository: SqliteResumeRepository;
  private readonly resumeVersionRepository: SqliteResumeVersionRepository;
  private readonly workspaceRepository: SqliteWorkspaceRepository;
  private readonly careerCommandRepository: SqliteCareerCommandRepository;
  private readonly documentRepository: SqliteDocumentRepository;
  private readonly vacancyRepository: SqliteVacancyRepository;
  private readonly careerStrategyRepository: SqliteCareerStrategyRepository;
  private readonly workPreferenceRepository: SqliteWorkPreferenceRepository;
  private readonly candidateMediaRepository: SqliteCandidateMediaRepository;
  private conversations!: ConversationController;
  private consultantHistory!: ConsultantHistoryStore;
  private consultantMethods!: ConsultantStoreMethods;
  private sourceConnections!: SourceConnectionController;
  private readonly applicationTracker: ApplicationTrackerController;

  constructor(options: SqliteStoreOptions) {
    this.database = openCandidateDatabase(options.databasePath);
    this.sealedText = new SealedText(options.encryptionKey);
    ({
      assessmentsRepository: this.assessmentsRepository,
      marketRepository: this.marketRepository,
      resumeRepository: this.resumeRepository,
      resumeVersionRepository: this.resumeVersionRepository,
      workspaceRepository: this.workspaceRepository,
      careerCommandRepository: this.careerCommandRepository,
      documentRepository: this.documentRepository,
      vacancyRepository: this.vacancyRepository,
      careerStrategyRepository: this.careerStrategyRepository,
      workPreferenceRepository: this.workPreferenceRepository,
      candidateMediaRepository: this.candidateMediaRepository,
      applicationTracker: this.applicationTracker,
    } = createSqliteCandidateStoreRepositories(
      this.database,
      this.sealedText,
      (operation) => this.transaction(operation),
    ));
    this.initializeConversationStores();
    this.notificationRepository = new SqliteNotificationRepository(this.database, this.sealedText);
    ({
      profileRevisionRepo: this.profileRevisionRepo,
      starPrepRepo: this.starPrepRepo,
      referralTrackRepo: this.referralTrackRepo,
      careerVectorRepo: this.careerVectorRepo,
      careerDiaryRepo: this.careerDiaryRepo,
      decisionProfileRepo: this.decisionProfileRepo,
      relocationQuestionnaireRepo: this.relocationQuestionnaireRepo,
      roleSkillAssessments: this.roleSkillAssessments,
      skillQuizAttempts: this.skillQuizAttempts,
      starStoriesRepo: this.starStoriesRepo,
      interviewSimulatorRepo: this.interviewSimulatorRepo,
    } = createProfileRepositories(this.database, this.sealedText, (operation) =>
      this.transaction(operation),
    ));
    this.installLinkedInMethods();
    this.installExportMethods();
    this.careerCommandRepository.recoverInterruptedProcessing(new Date().toISOString());
  }

  private installLinkedInMethods(): void {
    Object.assign(
      this,
      createSqliteCandidateStoreLinkedInMethods({
        requireCandidate: (candidateId) => this.requireCandidate(candidateId),
        listConnections: (candidateId) => this.sourceConnections.list(candidateId),
        readResume: (candidateId) => this.resumeRepository.get(candidateId),
      }),
    );
  }

  private installExportMethods(): void {
    Object.assign(
      this,
      createMemoryMethods({
        database: this.database,
        sealedText: this.sealedText,
        conversations: this.conversations,
        requireCandidate: (candidateId) => this.requireCandidate(candidateId),
        transaction: (operation) => this.transaction(operation),
        getSnapshot: this.getSnapshot.bind(this),
        saveResumeDraft: this.saveResumeDraft.bind(this),
      }),
      createSqliteCandidateStoreExportMethods({
        getSnapshot: (candidateId) => this.getSnapshot(candidateId),
        sourceConnections: this.sourceConnections,
        careerStrategyRepository: this.careerStrategyRepository,
        workPreferenceRepository: this.workPreferenceRepository,
        documentRepository: this.documentRepository,
        relocationQuestionnaireRepo: {
          scenarios: this.relocationQuestionnaireRepo.scenarios,
          getProfile: (candidateId) => this.relocationQuestionnaireRepo.getProfile(candidateId),
          getConsent: (candidateId) => this.relocationQuestionnaireRepo.getConsent(candidateId),
        },
        exportConsultantConversations: (candidateId) =>
          this.exportConsultantConversations(candidateId),
        exportExecutiveRequests: (candidateId) =>
          exportExecutiveRequests(this.database, this.sealedText, candidateId),
        roleSkillAssessments: this.roleSkillAssessments,
        starStoriesRepo: this.starStoriesRepo,
        interviewSimulatorRepo: this.interviewSimulatorRepo,
        careerDiaryRepo: this.careerDiaryRepo,
      }),
    );
  }

  private initializeConversationStores(): void {
    this.wireApplicationTrackerMethods();
    this.wireDocumentMethods();
    this.conversations = new ConversationController({ database: this.database, sealedText: this.sealedText, documentRepository: this.documentRepository });
    this.sourceConnections = new SourceConnectionController({ database: this.database, sealedText: this.sealedText });
    this.configureDatabase();
    Object.assign(
      this,
      createSqliteCandidateStoreExecutiveRequestMethods({
        database: this.database,
        sealedText: this.sealedText,
        requireCandidate: (candidateId) => this.requireCandidate(candidateId),
        transaction: (operation) => this.transaction(operation),
      }),
    );
    this.consultantHistory = new ConsultantHistoryStore(this.database, this.sealedText);
    this.consultantMethods = createSqliteCandidateStoreConsultantMethods({
      history: this.consultantHistory,
      conversations: this.conversations,
      requireCandidate: (candidateId) => this.requireCandidate(candidateId),
      transaction: (operation) => this.transaction(operation),
    });
    Object.assign(this, this.consultantMethods);
  }

  private configureDatabase(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA trusted_schema = OFF;
    `);
    applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
    applyMigrations(this.database, (operation) => this.transaction(operation));
  }

  /** See `sqliteCandidateStoreApplicationMethods.ts` for what this wires in. */
  private wireApplicationTrackerMethods(): void {
    Object.assign(this, createApplicationTrackerMethods(this.applicationTracker, (id) => this.requireCandidate(id), this.database, this.sealedText));
  }

  private wireDocumentMethods(): void {
    Object.assign(
      this,
      createSqliteCandidateStoreDocumentMethods({
        database: this.database,
        documents: this.documentRepository,
        requireCandidate: (candidateId) => this.requireCandidate(candidateId),
        transaction: (operation) => this.transaction(operation),
        linkMaterial: (candidateId, applicationId, role, documentId) =>
          this.linkApplicationMaterial(candidateId, applicationId, role, documentId),
      }),
    );
  }

  createCandidate(input: {
    dataClass: CandidateIdentity['dataClass'];
    locale: CandidateIdentity['locale'];
  }): CandidateCredentials {
    const id = randomUUID();
    const conversationId = randomUUID();
    const accessToken = `oqc_${randomBytes(32).toString('base64url')}`;
    const now = new Date().toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO candidates
            (id, token_hash, data_class, locale, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, hashToken(accessToken), input.dataClass, input.locale, now, now);
      this.database
        .prepare(
          `INSERT INTO conversations
            (id, candidate_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(conversationId, id, now, now);
    });
    return {
      id,
      accessToken,
      dataClass: input.dataClass,
      locale: input.locale,
      createdAt: now,
    };
  }

  authenticate(accessToken: string): CandidateIdentity | null {
    if (!/^oqc_[A-Za-z0-9_-]{40,}$/.test(accessToken)) {
      return null;
    }
    const row = this.database
      .prepare(
        `SELECT id, data_class, locale, created_at
         FROM candidates WHERE token_hash = ?`,
      )
      .get(hashToken(accessToken)) as CandidateRow | undefined;
    return row ? candidateFromRow(row) : null;
  }

  getCoachTurn(candidateId: string, key: string) {
    this.requireCandidate(candidateId);
    return this.conversations.getCoachTurn(candidateId, key);
  }

  updateCoachTurnResult(
    candidateId: string,
    key: string,
    update: (result: CoachTurnResult) => CoachTurnResult,
  ): boolean {
    this.requireCandidate(candidateId);
    const turn = this.conversations.getCoachTurn(candidateId, key);
    const { database, sealedText } = this;
    return updateStoredTurnResult({ database, sealedText, candidateId, key, turn, update });
  }

  startTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): StartedTurn {
    const candidate = this.requireCandidate(candidateId);
    const started = this.transaction(() => this.consultantMethods.decorateTurn(
      this.conversations.startTurn(candidate, candidateId, idempotencyKey, request),
      candidateId,
      idempotencyKey,
      request,
    ));
    if (started.state !== 'ready' || request.phase !== 'resume') return started;
    return {
      ...started,
      input: {
        ...started.input,
        resumeContext: resumeContextOf(this.getSnapshot(candidateId).resume?.draft),
      },
    };
  }

  declare completeTurn: CandidateStore['completeTurn'];
  declare proposeCandidateFacts: CandidateStore['proposeCandidateFacts'];

  failTurn(candidateId: string, idempotencyKey: string, errorCode: string): void {
    this.conversations.failTurn(candidateId, idempotencyKey, errorCode);
  }

  getSnapshot(candidateId: string, stage?: CoachTurnStage): CandidateSnapshot {
    const candidate = this.requireCandidate(candidateId);
    const parts = this.conversations.snapshotParts(candidateId, stage);
    const native = this.sourceConnections.list(candidateId);
    const resume = this.resumeRepository.get(candidateId);
    const edits = [...this.profileRevisionRepo.listRevisions(candidateId), ...factRewriteEdits(resume?.draft)];
    return {
      candidate,
      ...parts,
      ...this.conversations.importSources.withProvenance(candidateId, parts, native, edits),
      assessments: this.assessmentsRepository.list(candidateId),
      germanyMarket: this.marketRepository.get(candidateId),
      resume: withStoredTeamSizes(resume, parts.memory),
      documents: this.documentRepository.list(candidateId),
      vacancySubscriptions: this.vacancyRepository.list(candidateId),
    };
  }

  getMessages(candidateId: string, stage?: CoachTurnStage, subject?: CoachTurnSubject): CoachMessage[] {
    this.requireCandidate(candidateId);
    return this.conversations.getMessages(candidateId, stage, subject);
  }

  declare listConsultantConversations: CandidateStore['listConsultantConversations'];
  declare getConsultantConversation: CandidateStore['getConsultantConversation'];
  declare deleteConsultantConversation: CandidateStore['deleteConsultantConversation'];
  declare exportConsultantConversations: CandidateStore['exportConsultantConversations'];
  declare listPendingConsultantSummaries: CandidateStore['listPendingConsultantSummaries'];
  declare getConsultantSummaryInput: CandidateStore['getConsultantSummaryInput'];
  declare saveConsultantSummary: CandidateStore['saveConsultantSummary'];
  declare claimConsultantSummary: CandidateStore['claimConsultantSummary'];
  declare releaseConsultantSummaryClaim: CandidateStore['releaseConsultantSummaryClaim'];

  rejectConsultantProposal(candidateId: string, proposalKey: string, reason?: string): void {
    this.requireCandidate(candidateId);
    this.conversations.rejectConsultantProposal(candidateId, proposalKey, reason);
  }

  getConsultantRejections(candidateId: string): ConsultantRejection[] {
    this.requireCandidate(candidateId);
    return this.conversations.getConsultantRejections(candidateId);
  }

  withdrawConsultantRejection(candidateId: string, proposalKey: string): void {
    this.conversations.withdrawConsultantRejection(candidateId, proposalKey);
  }

  createVacancySubscription(candidateId: string, input: VacancySubscriptionInput, now: string): StoredVacancySubscription {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.create(candidateId, input, now);
  }

  listVacancySubscriptions(candidateId: string): StoredVacancySubscription[] {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.list(candidateId);
  }

  getVacancySubscription(candidateId: string, subscriptionId: string): StoredVacancySubscription | null {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.get(candidateId, subscriptionId);
  }

  recordVacancyRefresh(subscriptionId: string, sample: VacancySample): VacancyRefreshResult {
    return this.vacancyRepository.recordRefresh(subscriptionId, sample);
  }

  listSubscriptionVacancies(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancy[] {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.listVacancies(candidateId, subscriptionId);
  }

  claimDueVacancySubscriptions(
    now: string,
    leaseUntil: string,
    limit: number,
  ): ClaimedVacancySubscription[] {
    return this.vacancyRepository.claimDue(now, leaseUntil, limit);
  }

  recordVacancyFailure(
    subscriptionId: string,
    errorCode: string,
    attemptedAt: string,
    retryAfterAt?: string,
  ): void {
    this.vacancyRepository.recordFailure(
      subscriptionId,
      errorCode,
      attemptedAt,
      retryAfterAt,
    );
  }

  listVacancySourceHealth(): VacancySourceHealth[] {
    return this.vacancyRepository.listSourceHealth();
  }

  setVacancySubscriptionStatus(
    candidateId: string,
    subscriptionId: string,
    status: StoredVacancySubscription['status'],
    now: string,
  ): StoredVacancySubscription | null {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.setStatus(
      candidateId,
      subscriptionId,
      status,
      now,
    );
  }

  deleteVacancySubscription(
    candidateId: string,
    subscriptionId: string,
  ): boolean {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.delete(candidateId, subscriptionId);
  }

  saveAssessment(
    candidateId: string,
    assessmentId: AssessmentId,
    submission: AssessmentSubmission,
    result: AssessmentResult,
  ): StoredAssessment {
    this.requireCandidate(candidateId);
    return this.assessmentsRepository.save(
      candidateId,
      assessmentId,
      submission,
      result,
    );
  }

  saveGermanyMarket(
    candidateId: string,
    submission: GermanyMarketSubmission,
    result: GermanyMarketResult,
  ): StoredGermanyMarket {
    this.requireCandidate(candidateId);
    return this.marketRepository.save(candidateId, submission, result);
  }

  saveResumeDraft(
    candidateId: string,
    draft: ResumeDraft,
    evidenceSnapshot: readonly ResumeEvidenceSnapshot[],
  ): StoredResumeDraft {
    this.requireCandidate(candidateId);
    return this.transaction(() => {
      const saved = this.resumeRepository.save(candidateId, draft, evidenceSnapshot);
      this.candidateMediaRepository.pruneUnreferenced(candidateId, referencedMediaIds(draft));
      return saved;
    });
  }

  createResumeVersion(
    candidateId: string,
    versionId: string,
    sourceMasterRevision: string,
    content: ResumeVersionContent,
  ): ResumeVersionCreateResult {
    this.requireCandidate(candidateId);
    return this.transaction(() =>
      this.resumeVersionRepository.create(candidateId, versionId, sourceMasterRevision, content),
    );
  }

  getResumeVersion(candidateId: string, versionId: string): StoredResumeVersion | null {
    this.requireCandidate(candidateId);
    return this.resumeVersionRepository.get(candidateId, versionId);
  }

  listResumeVersions(
    candidateId: string,
    options: { readonly limit: number; readonly cursor: ResumeVersionCursor | null },
  ): ResumeVersionPage {
    this.requireCandidate(candidateId);
    return this.resumeVersionRepository.list(candidateId, options);
  }

  updateResumeVersion(
    candidateId: string,
    versionId: string,
    expectedRevision: number,
    expectedMasterRevision: string,
    content: ResumeVersionContent,
  ): ResumeVersionUpdateResult {
    this.requireCandidate(candidateId);
    return this.transaction(() =>
      this.resumeVersionRepository.update(
        candidateId,
        versionId,
        expectedRevision,
        expectedMasterRevision,
        content,
      ),
    );
  }

  getCandidateMedia(candidateId: string, mediaId: string): StoredCandidateMedia | null {
    this.requireCandidate(candidateId);
    return this.candidateMediaRepository.get(candidateId, mediaId);
  }

  /** Ответы на задания «Какие роли мне подходят» (B180, срез 3). */
  getWorkPreferenceRun(candidateId: string): StoredWorkPreferenceRun | null {
    this.requireCandidate(candidateId);
    return this.workPreferenceRepository.get(candidateId);
  }

  // Every application-tracker method (B251, S1–S2) is wired in by the
  // constructor from `sqliteCandidateStoreApplicationMethods.ts`, which keeps
  // this file under the 800-line gate. See that file for the implementations.
  declare listVacancyApplications: ApplicationTrackerMethods['listVacancyApplications'];
  declare recordVacancyApplication: ApplicationTrackerMethods['recordVacancyApplication'];
  declare listApplications: ApplicationTrackerMethods['listApplications'];
  declare getApplication: ApplicationTrackerMethods['getApplication'];
  declare createApplication: ApplicationTrackerMethods['createApplication'];
  declare patchApplication: ApplicationTrackerMethods['patchApplication'];
  declare restoreApplication: ApplicationTrackerMethods['restoreApplication'];
  declare recordApplicationEvent: ApplicationTrackerMethods['recordApplicationEvent'];
  declare applicationFunnel: ApplicationTrackerMethods['applicationFunnel'];
  declare linkApplicationMaterial: ApplicationTrackerMethods['linkApplicationMaterial'];
  declare createApplicationInterview: ApplicationTrackerMethods['createApplicationInterview'];
  declare patchApplicationInterview: ApplicationTrackerMethods['patchApplicationInterview'];
  declare getInterviewSubject: ApplicationTrackerMethods['getInterviewSubject'];
  declare putApplicationOffer: ApplicationTrackerMethods['putApplicationOffer'];
  declare getApplicationOffer: ApplicationTrackerMethods['getApplicationOffer'];
  declare listApplicationOffers: ApplicationTrackerMethods['listApplicationOffers'];
  declare listVacancySkips: ApplicationTrackerMethods['listVacancySkips'];
  declare createVacancySkip: ApplicationTrackerMethods['createVacancySkip'];
  declare deleteVacancySkip: ApplicationTrackerMethods['deleteVacancySkip'];
  declare listVacancyDecisions: ApplicationTrackerMethods['listVacancyDecisions'];
  declare recordCandidateVisit: ApplicationTrackerMethods['recordCandidateVisit'];
  declare getSinceLastVisit: ApplicationTrackerMethods['getSinceLastVisit'];
  declare countSystemClosuresSince: ApplicationTrackerMethods['countSystemClosuresSince'];
  declare countCompanyEventsSince: ApplicationTrackerMethods['countCompanyEventsSince'];
  declare saveDocument: SqliteCandidateStoreDocumentMethods['saveDocument'];
  declare saveDocumentAndLinkApplicationMaterial: SqliteCandidateStoreDocumentMethods['saveDocumentAndLinkApplicationMaterial'];
  declare getDocument: SqliteCandidateStoreDocumentMethods['getDocument'];
  declare deleteDocument: SqliteCandidateStoreDocumentMethods['deleteDocument'];
  declare setDocumentRetention: SqliteCandidateStoreDocumentMethods['setDocumentRetention'];
  declare purgeExpiredDocuments: SqliteCandidateStoreDocumentMethods['purgeExpiredDocuments'];
  declare exportCandidate: CandidateStore['exportCandidate'];
  declare createExecutiveRequest: NonNullable<CandidateStore['createExecutiveRequest']>;
  declare listExecutiveRequests: NonNullable<CandidateStore['listExecutiveRequests']>;
  declare getExecutiveRequest: NonNullable<CandidateStore['getExecutiveRequest']>;
  declare listExecutiveRequestQueue: NonNullable<CandidateStore['listExecutiveRequestQueue']>;
  declare setExecutiveRequestStatus: NonNullable<CandidateStore['setExecutiveRequestStatus']>;

  requestPlan: CandidateStore['requestPlan'] = (id, plan, note) => insertPlanRequest(this.database, id, plan, note);
  listPlanRequests: CandidateStore['listPlanRequests'] = (id) => selectPlanRequests(this.database, id);

  saveWorkPreferenceRun(
    candidateId: string,
    run: StoredWorkPreferenceRun,
  ): StoredWorkPreferenceRun {
    this.requireCandidate(candidateId);
    return this.workPreferenceRepository.save(candidateId, run);
  }

  /** Выбранная роль как версионированный объект (B180, срез 2). */
  getCareerStrategy(candidateId: string): CareerStrategy | null {
    this.requireCandidate(candidateId);
    return this.careerStrategyRepository.get(candidateId);
  }

  saveCareerStrategy(candidateId: string, strategy: CareerStrategy): CareerStrategy {
    this.requireCandidate(candidateId);
    return this.careerStrategyRepository.save(candidateId, strategy);
  }

  getCandidateWorkspace(candidateId: string): CandidateWorkspaceState | null {
    this.requireCandidate(candidateId);
    return this.workspaceRepository.get(candidateId);
  }

  listRecentCampaignCandidateIds(since: string): string[] {
    return this.workspaceRepository.listRecentCampaignCandidateIds(since);
  }

  saveCandidateWorkspace(
    candidateId: string,
    workspace: CandidateWorkspaceState,
  ): CandidateWorkspaceState {
    this.requireCandidate(candidateId);
    return this.workspaceRepository.save(candidateId, workspace);
  }

  completeCandidateWorkspace(candidateId: string, workspace: CandidateWorkspaceState): CandidateWorkspaceState {
    this.requireCandidate(candidateId);
    return this.transaction(() => {
      const saved = this.workspaceRepository.save(candidateId, workspace);
      recordCandidateGoal(this.database, candidateId, 'onboarding_completed', 'wizard', 'wizard_completion', new Date().toISOString());
      return saved;
    });
  }

  getSeoGoalSummary = (days = 28) => readSeoGoalSummary(this.database, days);

  saveImportWalk: CandidateStore['saveImportWalk'] = (candidateId, walk) =>
    this.conversations.importSources.saveWalk(this.requireCandidate(candidateId).id, walk);

  importResumeEvidence(
    candidateId: string,
    input: ResumeEvidenceImport,
  ): ImportedResumeEvidence {
    this.requireCandidate(candidateId);
    return this.conversations.importResumeEvidence(candidateId, input);
  }

  commitResumeImport(
    candidateId: string,
    input: ResumeImportCommit,
  ): CommittedResumeImport {
    this.requireCandidate(candidateId);
    const replay = findResumeImportReplay(this.importDeps(), candidateId, input);
    return replay ?? this.transaction(() => this.commitNewResumeImport(candidateId, input));
  }

  replaceProfileWithImport(
    candidateId: string,
    input: ResumeImportCommit & { readonly sourceReceipt: NativeSourceReceiptInput },
  ): CommittedResumeImport {
    this.requireCandidate(candidateId);
    return this.transaction(() => replaceProfileWithImport(this.importDeps(), candidateId, input));
  }

  connectNativeSourceOnly(
    candidateId: string,
    receipt: NativeSourceReceiptInput,
    sourceLabel: string,
  ): StoredNativeSourceConnection {
    this.requireCandidate(candidateId);
    return this.transaction(() =>
      commitSourceConnectionOnly(this.importDeps(), candidateId, receipt, sourceLabel),
    );
  }

  private commitNewResumeImport(candidateId: string, input: ResumeImportCommit) {
    return commitResumeImportWithDedupe(this.importDeps(), candidateId, input);
  }

  private importDeps() {
    const { database, conversations, sourceConnections } = this;
    const { resumeRepository, candidateMediaRepository } = this;
    return { database, conversations, sourceConnections, resumeRepository, candidateMediaRepository };
  }

  listNativeSourceConnections(candidateId: string): StoredNativeSourceConnection[] {
    this.requireCandidate(candidateId);
    return this.sourceConnections.list(candidateId);
  }

  findNativeSourceConnectionByDigest(
    candidateId: string,
    platform: NativeSourceReceiptInput['platform'],
    importDigest: string,
  ): StoredNativeSourceConnection | null {
    this.requireCandidate(candidateId);
    return this.sourceConnections.findByDigest(candidateId, platform, importDigest);
  }

  deleteNativeSourceConnection(
    candidateId: string,
    platform: StoredNativeSourceConnection['platform'],
  ): boolean {
    this.requireCandidate(candidateId);
    return this.sourceConnections.delete(candidateId, platform);
  }

  changeMemory(candidateId: string, memoryId: string, change: MemoryChange): StoredMemory | null {
    return this.conversations.changeMemory(candidateId, memoryId, change);
  }

  declare addManualExperienceFact: MemoryMethods['addManualExperienceFact'];
  declare reviewMemories: MemoryMethods['reviewMemories'];
  declare applyExperienceFactRewrite: MemoryMethods['applyExperienceFactRewrite'];
  declare revertExperienceFactRewrite: MemoryMethods['revertExperienceFactRewrite'];
  declare saveFactRewriteProposal: MemoryMethods['saveFactRewriteProposal'];

  deleteCandidate(candidateId: string): boolean {
    const result = this.transaction(() => {
      this.consultantHistory.deleteAllIndexes(candidateId);
      return this.database.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);
    });
    if (result.changes === 1) {
      this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
    return result.changes === 1;
  }

  saveCareerCommand(command: CareerCommandRecord): CareerCommandRecord {
    this.requireCandidate(command.candidateId);
    return this.careerCommandRepository.save(command);
  }

  getCareerCommand(candidateId: string, commandId: string): CareerCommandRecord | null {
    return this.careerCommandRepository.get(candidateId, commandId);
  }

  listCareerCommands(candidateId: string): CareerCommandRecord[] {
    this.requireCandidate(candidateId);
    return this.careerCommandRepository.list(candidateId);
  }

  approveCareerCommand(input: {
    candidateId: string;
    commandId: string;
    approval: VerifiedCareerApproval;
    consumedAt: string;
  }): CareerCommandRecord {
    return this.careerCommandRepository.approve(input);
  }

  claimCareerCommand(
    candidateId: string,
    commandId: string,
    execution: ConnectorActionRecord,
    claimedAt: string,
  ): CareerCommandRecord {
    return this.careerCommandRepository.claim(candidateId, commandId, execution, claimedAt);
  }

  finishCareerCommand(
    candidateId: string,
    commandId: string,
    command: CareerCommandRecord,
  ): CareerCommandRecord {
    return this.careerCommandRepository.finish(candidateId, commandId, command);
  }

  close(): void {
    this.notificationRepository.close();
    this.database.close();
  }

  private requireCandidate(candidateId: string): CandidateIdentity {
    const row = this.database
      .prepare(
        `SELECT id, data_class, locale, created_at
         FROM candidates WHERE id = ?`,
      )
      .get(candidateId) as CandidateRow | undefined;
    if (!row) {
      throw new CandidateNotFoundError();
    }
    return candidateFromRow(row);
  }

  transaction<T>(operation: () => T): T {
    return runSqliteTransaction(this.database, operation);
  }
}

/** Every `candidate_media` row a draft still points at — the rest gets pruned. */
function referencedMediaIds(draft: ResumeDraft): string[] {
  return [
    draft.candidate.photoMediaId,
    ...draft.experience.map((role) => role.employerLogoMediaId),
  ].filter((value): value is string => Boolean(value));
}
