import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AssessmentId,
  AssessmentResult,
  AssessmentSubmission,
} from '../domain/assessment';
import {
  buildResumeStudioProjection,
  type ResumeEvidenceSnapshot,
} from '../domain/resumeStudio';
import type { ResumeDraft } from '../domain/resumeDraft';
import type {
  CandidateCredentials,
  CandidateExport,
  CandidateIdentity,
  CandidateSnapshot,
  CandidateStore,
  MemoryChange,
  StartedTurn,
  StoredAssessment,
  StoredGermanyMarket,
  StoredMemory,
  ResumeEvidenceImport,
  ImportedResumeEvidence,
  StoredResumeDraft,
  TurnRequest,
  CandidateDocumentInput,
  CandidateDocumentWithContent,
  StoredCandidateDocument,
  ResumeImportCommit,
  CommittedResumeImport,
  StoredNativeSourceConnection,
  NativeSourceReceiptInput,
} from './candidateStore';
import { insertPlanRequest, selectPlanRequests } from './store/planRequestStore';
import type { ConnectorActionRecord } from '../connectors/connectorActionQueue';
import { SealedText } from './sealedText';
import { SqliteAssessmentRepository } from './sqliteAssessmentRepository';
import { SqliteMarketRepository } from './sqliteMarketRepository';
import { SqliteResumeRepository } from './sqliteResumeRepository';
import { SqliteCandidateMediaRepository, type StoredCandidateMedia } from './sqliteCandidateMediaRepository';
import { SqliteWorkspaceRepository } from './sqliteWorkspaceRepository';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import { SqliteCareerCommandRepository } from './sqliteCareerCommandRepository';
import { SqliteDocumentRepository } from './sqliteDocumentRepository';
import { SqliteVacancyRepository } from './sqliteVacancyRepository';
import { SqliteCareerStrategyRepository } from './sqliteCareerStrategyRepository';
import {
  SqliteWorkPreferenceRepository,
  type StoredWorkPreferenceRun,
} from './sqliteWorkPreferenceRepository';
import { SqliteVacancyApplicationRepository } from './sqliteVacancyApplicationRepository';
import { ApplicationTrackerController } from './store/applicationTrackerController';
import {
  createApplicationTrackerMethods,
  type ApplicationTrackerMethods,
} from './sqliteCandidateStoreApplicationMethods';
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
import type { CoachProviderResult } from '../providers/coachProvider';
import { applyMigrations } from './store/applyMigrations';
import { ConversationController } from './store/conversationController';
import { SourceConnectionController } from './store/sourceConnectionController';
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

export { CandidateNotFoundError, CandidateStoreConflictError, CandidateDocumentRetentionError };

export class SqliteCandidateStore implements CandidateStore {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;
  private readonly assessmentsRepository: SqliteAssessmentRepository;
  private readonly marketRepository: SqliteMarketRepository;
  private readonly resumeRepository: SqliteResumeRepository;
  private readonly workspaceRepository: SqliteWorkspaceRepository;
  private readonly careerCommandRepository: SqliteCareerCommandRepository;
  private readonly documentRepository: SqliteDocumentRepository;
  private readonly vacancyRepository: SqliteVacancyRepository;
  private readonly careerStrategyRepository: SqliteCareerStrategyRepository;
  private readonly workPreferenceRepository: SqliteWorkPreferenceRepository;
  private readonly candidateMediaRepository: SqliteCandidateMediaRepository;
  private readonly conversations: ConversationController;
  private readonly sourceConnections: SourceConnectionController;
  private readonly applicationTracker: ApplicationTrackerController;

  constructor(options: SqliteStoreOptions) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), {
        recursive: true,
        mode: 0o700,
      });
    }
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    this.sealedText = new SealedText(options.encryptionKey);
    ({
      assessmentsRepository: this.assessmentsRepository,
      marketRepository: this.marketRepository,
      resumeRepository: this.resumeRepository,
      workspaceRepository: this.workspaceRepository,
      careerCommandRepository: this.careerCommandRepository,
      documentRepository: this.documentRepository,
      vacancyRepository: this.vacancyRepository,
      careerStrategyRepository: this.careerStrategyRepository,
      workPreferenceRepository: this.workPreferenceRepository,
      candidateMediaRepository: this.candidateMediaRepository,
      applicationTracker: this.applicationTracker,
    } = createRepositories(this.database, this.sealedText));
    this.wireApplicationTrackerMethods();
    this.conversations = new ConversationController({
      database: this.database,
      sealedText: this.sealedText,
      documentRepository: this.documentRepository,
    });
    this.sourceConnections = new SourceConnectionController({
      database: this.database,
      sealedText: this.sealedText,
    });
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA trusted_schema = OFF;
    `);
    applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
    applyMigrations(this.database, (operation) => this.transaction(operation));
    this.careerCommandRepository.recoverInterruptedProcessing(
      new Date().toISOString(),
    );
  }

  /** See `sqliteCandidateStoreApplicationMethods.ts` for what this wires in. */
  private wireApplicationTrackerMethods(): void {
    Object.assign(
      this,
      createApplicationTrackerMethods(this.applicationTracker, (id) => this.requireCandidate(id)),
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

  startTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): StartedTurn {
    return this.conversations.startTurn(
      this.requireCandidate(candidateId),
      candidateId,
      idempotencyKey,
      request,
    );
  }

  completeTurn(
    candidateId: string,
    idempotencyKey: string,
    output: CoachProviderResult,
  ): void {
    this.requireCandidate(candidateId);
    this.conversations.completeTurn(candidateId, idempotencyKey, output);
  }

  failTurn(
    candidateId: string,
    idempotencyKey: string,
    errorCode: string,
  ): void {
    this.conversations.failTurn(candidateId, idempotencyKey, errorCode);
  }

  getSnapshot(candidateId: string): CandidateSnapshot {
    const candidate = this.requireCandidate(candidateId);
    return {
      candidate,
      importedSources: this.sourceConnections.list(candidateId).map((connection) => ({
        platform: connection.platform,
        connectedAt: connection.connectedAt,
        lastImportedAt: connection.lastImportedAt,
        factCount: connection.receipt.factCount,
      })),
      ...this.conversations.snapshotParts(candidateId),
      assessments: this.assessmentsRepository.list(candidateId),
      germanyMarket: this.marketRepository.get(candidateId),
      resume: this.resumeRepository.get(candidateId),
      documents: this.documentRepository.list(candidateId),
      vacancySubscriptions: this.vacancyRepository.list(candidateId),
    };
  }

  saveDocument(
    candidateId: string,
    input: CandidateDocumentInput,
  ): { created: boolean; document: StoredCandidateDocument } {
    this.requireCandidate(candidateId);
    return this.documentRepository.save(candidateId, input);
  }

  getDocument(
    candidateId: string,
    documentId: string,
  ): CandidateDocumentWithContent | null {
    this.requireCandidate(candidateId);
    return this.documentRepository.get(candidateId, documentId);
  }

  deleteDocument(candidateId: string, documentId: string): boolean {
    this.requireCandidate(candidateId);
    return this.transaction(() => {
      const deleted = this.documentRepository.delete(candidateId, documentId);
      if (deleted) this.invalidateDocumentKnowledge(candidateId, documentId);
      return deleted;
    });
  }

  setDocumentRetention(
    candidateId: string,
    documentId: string,
    retentionUntil: string | null,
    now: string,
  ): StoredCandidateDocument | null {
    this.requireCandidate(candidateId);
    const normalizedRetentionUntil = normalizeRetentionUntil(
      retentionUntil,
      now,
    );
    return this.documentRepository.setRetention(
      candidateId,
      documentId,
      normalizedRetentionUntil,
    );
  }

  purgeExpiredDocuments(now: string, limit: number): number {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new CandidateStoreConflictError();
    }
    const expired = this.documentRepository.listExpired(now, limit);
    return this.transaction(() => {
      let purged = 0;
      for (const document of expired) {
        if (
          this.documentRepository.delete(
            document.candidateId,
            document.documentId,
            now,
          )
        ) {
          this.invalidateDocumentKnowledge(
            document.candidateId,
            document.documentId,
            now,
          );
          purged += 1;
        }
      }
      return purged;
    });
  }

  createVacancySubscription(
    candidateId: string,
    input: VacancySubscriptionInput,
    now: string,
  ): StoredVacancySubscription {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.create(candidateId, input, now);
  }

  listVacancySubscriptions(candidateId: string): StoredVacancySubscription[] {
    this.requireCandidate(candidateId);
    return this.vacancyRepository.list(candidateId);
  }

  getVacancySubscription(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancySubscription | null {
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
  declare recordApplicationEvent: ApplicationTrackerMethods['recordApplicationEvent'];
  declare applicationFunnel: ApplicationTrackerMethods['applicationFunnel'];
  declare linkApplicationMaterial: ApplicationTrackerMethods['linkApplicationMaterial'];
  declare createApplicationInterview: ApplicationTrackerMethods['createApplicationInterview'];
  declare patchApplicationInterview: ApplicationTrackerMethods['patchApplicationInterview'];
  declare putApplicationOffer: ApplicationTrackerMethods['putApplicationOffer'];
  declare listVacancySkips: ApplicationTrackerMethods['listVacancySkips'];
  declare createVacancySkip: ApplicationTrackerMethods['createVacancySkip'];
  declare deleteVacancySkip: ApplicationTrackerMethods['deleteVacancySkip'];
  declare listVacancyDecisions: ApplicationTrackerMethods['listVacancyDecisions'];
  declare recordCandidateVisit: ApplicationTrackerMethods['recordCandidateVisit'];
  declare getSinceLastVisit: ApplicationTrackerMethods['getSinceLastVisit'];
  declare countSystemClosuresSince: ApplicationTrackerMethods['countSystemClosuresSince'];
  declare countCompanyEventsSince: ApplicationTrackerMethods['countCompanyEventsSince'];

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

  saveCandidateWorkspace(
    candidateId: string,
    workspace: CandidateWorkspaceState,
  ): CandidateWorkspaceState {
    this.requireCandidate(candidateId);
    return this.workspaceRepository.save(candidateId, workspace);
  }

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
    const replay = this.resumeImportReplay(candidateId, input);
    return replay ?? this.transaction(() => this.commitNewResumeImport(candidateId, input));
  }

  private resumeImportReplay(
    candidateId: string,
    input: ResumeImportCommit,
  ): CommittedResumeImport | null {
    if (!input.sourceReceipt) return null;
    const replay = this.sourceConnections.findByDigest(
      candidateId,
      input.sourceReceipt.platform,
      input.sourceReceipt.importDigest,
    );
    if (!replay) return null;
    const resume = this.resumeRepository.get(candidateId);
    if (!resume) throw new CandidateStoreConflictError();
    return {
      evidence: {
        messageId: replay.receipt.sourceMessageId,
        memoryIds: [...replay.receipt.memoryIds],
      },
      resume,
      sourceConnection: replay,
      idempotentReplay: true,
    };
  }

  private commitNewResumeImport(
    candidateId: string,
    input: ResumeImportCommit,
  ): CommittedResumeImport {
    const replaced = input.sourceReceipt
      ? this.sourceConnections
          .list(candidateId)
          .find((connection) => connection.platform === input.sourceReceipt?.platform)
      : undefined;
    const evidence = this.conversations.importResumeEvidenceInTransaction(
      candidateId,
      input.evidence,
    );
    if (replaced) {
      this.conversations.purgeReplacedImportedFacts(
        candidateId,
        replaced.receipt.sourceMessageId,
        replaced.receipt.memoryIds,
      );
    } else if (!input.sourceReceipt) {
      // A file upload carries no receipt to displace its predecessor, so the
      // dossier used to keep both readings of the same career (B162).
      this.conversations.purgeSupersededFileImportFacts(
        candidateId,
        evidence.messageId,
        this.sourceConnections
          .list(candidateId)
          .map((connection) => connection.receipt.sourceMessageId),
      );
    }
    const projection = buildResumeStudioProjection({
      ...input.draft,
      evidence: this.conversations.snapshotParts(candidateId).memory,
    });
    if (input.media?.length) {
      this.candidateMediaRepository.saveMany(candidateId, input.media);
    }
    const resume = this.resumeRepository.save(candidateId, input.draft, projection.evidenceSnapshot, input.reader);
    this.candidateMediaRepository.pruneUnreferenced(candidateId, referencedMediaIds(input.draft));
    const sourceConnection = input.sourceReceipt
      ? this.sourceConnections.upsert(candidateId, input.sourceReceipt, evidence)
      : undefined;
    return { evidence, resume, sourceConnection, idempotentReplay: false };
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

  changeMemory(
    candidateId: string,
    memoryId: string,
    change: MemoryChange,
  ): StoredMemory | null {
    return this.conversations.changeMemory(candidateId, memoryId, change);
  }

  reviewMemories(
    candidateId: string,
    memoryIds: readonly string[],
    action: 'confirm' | 'delete',
  ): number | null {
    this.requireCandidate(candidateId);
    return this.transaction(() => {
      const known = new Set(
        this.conversations.snapshotParts(candidateId).memory.map((item) => item.id),
      );
      // A stale client must not half-review a dossier: either the whole batch
      // is a decision the candidate could actually see, or none of it applies.
      if (memoryIds.some((memoryId) => !known.has(memoryId))) return null;
      // The count is what the candidate is told they decided, so a repeated id
      // must not inflate it.
      const distinct = [...new Set(memoryIds)];
      for (const memoryId of distinct) {
        this.conversations.changeMemory(candidateId, memoryId, { action });
      }
      return distinct.length;
    });
  }

  exportCandidate(candidateId: string): CandidateExport {
    const snapshot = this.getSnapshot(candidateId);
    return {
      ...snapshot,
      sourceConnections: this.sourceConnections.list(candidateId).map((connection) => ({
        id: connection.id,
        platform: connection.platform,
        accessMode: connection.accessMode,
        connectedAt: connection.connectedAt,
        lastImportedAt: connection.lastImportedAt,
        capturedAt: connection.receipt.capturedAt,
        factCount: connection.receipt.factCount,
      })),
      // Решение о собственной роли — данные кандидата, а не служебная запись.
      careerStrategy: this.careerStrategyRepository.get(candidateId),
      workPreferences: this.workPreferenceRepository.get(candidateId),
      documentContents: snapshot.documents.flatMap((document) => {
        const stored = this.documentRepository.get(candidateId, document.id);
        return stored ? [stored] : [];
      }),
    };
  }

  deleteCandidate(candidateId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM candidates WHERE id = ?')
      .run(candidateId);
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
    this.database.close();
  }

  private invalidateDocumentKnowledge(
    candidateId: string,
    documentId: string,
    invalidatedAt = new Date().toISOString(),
  ): void {
    const sourceRef = `document:${documentId}`;
    const deletedSourceRef = `deleted-document:${documentId}`;
    const rows = this.database
      .prepare(
        `SELECT id, status, source_message_ids
         FROM memory
         WHERE candidate_id = ? AND status != 'deleted'`,
      )
      .all(candidateId) as Array<{
      id: string;
      status: StoredMemory['status'];
      source_message_ids: string;
    }>;
    for (const row of rows) {
      const sourceRefs = JSON.parse(row.source_message_ids) as string[];
      if (!sourceRefs.includes(sourceRef)) continue;
      const remainingRefs = sourceRefs.filter((ref) => ref !== sourceRef);
      this.database
        .prepare(
          `UPDATE memory
           SET source_message_ids = ?, status = ?, updated_at = ?
           WHERE candidate_id = ? AND id = ?`,
        )
        .run(
          JSON.stringify(
            remainingRefs.length > 0 ? remainingRefs : [deletedSourceRef],
          ),
          remainingRefs.length > 0 ? row.status : 'proposed',
          invalidatedAt,
          candidateId,
          row.id,
        );
    }
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

  private transaction<T>(operation: () => T): T {
    // SQLite has no nested BEGIN. A batch review runs several dossier writes
    // that each know how to be atomic on their own, so an outer transaction
    // joins them instead of crashing on the second BEGIN (B166).
    if (this.database.isTransaction) return operation();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function normalizeRetentionUntil(
  retentionUntil: string | null,
  now: string,
): string | null {
  if (retentionUntil === null) return null;
  const nowTime = Date.parse(now);
  const retentionTime = Date.parse(retentionUntil);
  const maxRetentionTime = nowTime + 10 * 366 * 24 * 60 * 60 * 1_000;
  if (
    !Number.isFinite(nowTime) ||
    !Number.isFinite(retentionTime) ||
    retentionTime <= nowTime ||
    retentionTime > maxRetentionTime
  ) {
    throw new CandidateDocumentRetentionError();
  }
  return new Date(retentionTime).toISOString();
}

/** Every `candidate_media` row a draft still points at — the rest gets pruned. */
function referencedMediaIds(draft: ResumeDraft): string[] {
  return [
    draft.candidate.photoMediaId,
    ...draft.experience.map((role) => role.employerLogoMediaId),
  ].filter((value): value is string => Boolean(value));
}

interface StoreRepositories {
  assessmentsRepository: SqliteAssessmentRepository;
  marketRepository: SqliteMarketRepository;
  resumeRepository: SqliteResumeRepository;
  workspaceRepository: SqliteWorkspaceRepository;
  careerCommandRepository: SqliteCareerCommandRepository;
  documentRepository: SqliteDocumentRepository;
  vacancyRepository: SqliteVacancyRepository;
  careerStrategyRepository: SqliteCareerStrategyRepository;
  workPreferenceRepository: SqliteWorkPreferenceRepository;
  candidateMediaRepository: SqliteCandidateMediaRepository;
  applicationTracker: ApplicationTrackerController;
}

function createRepositories(
  database: DatabaseSync,
  sealedText: SealedText,
): StoreRepositories {
  const legacyApplications = new SqliteVacancyApplicationRepository(database, sealedText);
  const workspaceRepository = new SqliteWorkspaceRepository(database, sealedText);
  const documentRepository = new SqliteDocumentRepository(database, sealedText);
  return {
    applicationTracker: new ApplicationTrackerController(database, sealedText, legacyApplications, workspaceRepository, documentRepository),
    assessmentsRepository: new SqliteAssessmentRepository(database, sealedText),
    marketRepository: new SqliteMarketRepository(database, sealedText),
    resumeRepository: new SqliteResumeRepository(database, sealedText),
    workspaceRepository,
    careerCommandRepository: new SqliteCareerCommandRepository(database, sealedText),
    documentRepository,
    vacancyRepository: new SqliteVacancyRepository(database, sealedText),
    careerStrategyRepository: new SqliteCareerStrategyRepository(database, sealedText),
    workPreferenceRepository: new SqliteWorkPreferenceRepository(database, sealedText),
    candidateMediaRepository: new SqliteCandidateMediaRepository(database, sealedText),
  };
}
