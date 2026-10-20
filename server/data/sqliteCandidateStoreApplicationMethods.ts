import { randomUUID } from 'node:crypto';
import { createApplicationContactMethods, type ApplicationContactMethods } from './applicationContacts';
import type { SealedText } from './sealedText';
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
import { ApplicationNotFoundError, ApplicationVersionConflictError } from './store/errors';

/**
 * Every `CandidateStore` method that only checks the candidate exists and
 * forwards to `ApplicationTrackerController` (B251, S1–S2). Pulled out of
 * `SqliteCandidateStore` to keep that file under the 800-line gate; wired in
 * via `Object.assign(this, createApplicationTrackerMethods(...))` in its
 * constructor, with the fields declared there for `implements CandidateStore`.
 */
export interface ApplicationLabel {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface ApplicationLabelAssignment {
  readonly applicationId: string;
  readonly labelId: string;
  readonly createdAt: string;
}

export interface ApplicationRetryRequest {
  readonly applicationId: string;
  readonly operationId: string;
  readonly requestedAt: string;
  readonly state: 'prepared';
}

export interface ApplicationOperationReplay<T extends Record<string, unknown>> {
  readonly result: T;
  readonly replayed: boolean;
}

export class ApplicationOperationConflictError extends Error {
  readonly code = 'idempotency_key_reused';

  constructor() {
    super('Ключ операции уже использован с другими параметрами');
    this.name = 'ApplicationOperationConflictError';
  }
}

export interface ApplicationTrackerMethods extends ApplicationContactMethods {
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
  getApplicationOffer(candidateId: string, applicationId: string): StoredApplicationOffer | null;
  listApplicationOffers(candidateId: string): StoredApplicationOffer[];
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
  listApplicationLabels(candidateId: string): ApplicationLabel[];
  createApplicationLabel(candidateId: string, name: string, now?: string): ApplicationLabel;
  listApplicationLabelAssignments(candidateId: string): ApplicationLabelAssignment[];
  assignApplicationLabel(
    candidateId: string,
    applicationId: string,
    labelId: string,
    now?: string,
  ): { changed: boolean; applicationExists: boolean; label: ApplicationLabel | null };
  removeApplicationLabel(
    candidateId: string,
    applicationId: string,
    labelId: string,
  ): { changed: boolean; applicationExists: boolean; labelExists: boolean };
  listApplicationRetryRequests(candidateId: string): ApplicationRetryRequest[];
  bulkQueueApplicationRetries(
    candidateId: string,
    targets: readonly { id: string }[],
    operationId: string,
    requestedAt: string,
  ): number;
  runApplicationOperation<T extends Record<string, unknown>>(
    candidateId: string,
    operationId: string,
    requestHash: string,
    operationType: string,
    operation: () => T,
    createdAt?: string,
  ): ApplicationOperationReplay<T>;
  bulkChangeApplicationStages(
    candidateId: string,
    targets: readonly { id: string; stage: ApplicationStage; version: number }[],
    targetStage: ApplicationStage,
    occurredAt: string,
  ): number;
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
  sealedText: SealedText,
): ApplicationTrackerMethods {
  ensureApplicationOperationsSchema(database);
  return {
    ...createCoreApplicationMethods(tracker, requireCandidate),
    ...createApplicationMutationMethods(tracker, requireCandidate),
    ...createInterviewApplicationMethods(tracker, requireCandidate, database),
    ...createVacancyJourneyMethods(tracker, requireCandidate),
    ...createApplicationOperationsMethods(requireCandidate, database),
    ...createApplicationContactMethods(database, sealedText, requireCandidate),
  };
}

interface ApplicationLabelRow {
  id: string;
  name: string;
  created_at: string;
}

interface ApplicationLabelAssignmentRow {
  application_id: string;
  label_id: string;
  created_at: string;
}

interface ApplicationRetryRequestRow {
  application_id: string;
  operation_id: string;
  requested_at: string;
  state: 'prepared';
}

interface ApplicationOperationRow {
  operation_type: string;
  request_hash: string;
  result_json: string;
}

function ensureApplicationOperationsSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS candidate_application_labels (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(candidate_id, normalized_name)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS application_label_assignments (
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES candidate_application_labels(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(candidate_id, application_id, label_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_application_label_assignments_candidate
      ON application_label_assignments(candidate_id, application_id);
    CREATE TABLE IF NOT EXISTS application_retry_requests (
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state = 'prepared'),
      PRIMARY KEY(candidate_id, application_id, operation_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS candidate_application_operations (
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(candidate_id, operation_id)
    ) STRICT;
  `);
}

function createApplicationOperationsMethods(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<
  ApplicationTrackerMethods,
  | 'listApplicationLabels'
  | 'createApplicationLabel'
  | 'listApplicationLabelAssignments'
  | 'assignApplicationLabel'
  | 'removeApplicationLabel'
  | 'listApplicationRetryRequests'
  | 'bulkQueueApplicationRetries'
  | 'runApplicationOperation'
  | 'bulkChangeApplicationStages'
> {
  return {
    ...createApplicationLabelMethods(requireCandidate, database),
    ...createApplicationLabelAssignmentMethods(requireCandidate, database),
    ...createApplicationRetryMethods(requireCandidate, database),
    ...createApplicationReplayMethods(requireCandidate, database),
    ...createApplicationStageBatchMethods(requireCandidate, database),
  };
}

function createApplicationLabelMethods(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<ApplicationTrackerMethods, 'listApplicationLabels' | 'createApplicationLabel'> {
  return {
    listApplicationLabels(candidateId) {
      requireCandidate(candidateId);
      const rows = database.prepare(`
        SELECT id, name, created_at FROM candidate_application_labels
        WHERE candidate_id = ? ORDER BY name COLLATE NOCASE, id
      `).all(candidateId) as unknown as ApplicationLabelRow[];
      return rows.map(toApplicationLabel);
    },
    createApplicationLabel(candidateId, name, now = new Date().toISOString()) {
      requireCandidate(candidateId);
      const normalizedName = normalizeLabelName(name);
      database.prepare(`
        INSERT INTO candidate_application_labels (id, candidate_id, name, normalized_name, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(candidate_id, normalized_name) DO NOTHING
      `).run(randomUUID(), candidateId, name.trim().replace(/\s+/gu, ' '), normalizedName, now);
      const row = findApplicationLabelByName(database, candidateId, normalizedName);
      if (!row) throw new Error('application_label_write_failed');
      return row;
    },
  };
}

function findApplicationLabelByName(
  database: DatabaseSync,
  candidateId: string,
  normalizedName: string,
): ApplicationLabel | null {
  const row = database.prepare(`
    SELECT id, name, created_at FROM candidate_application_labels
    WHERE candidate_id = ? AND normalized_name = ?
  `).get(candidateId, normalizedName) as ApplicationLabelRow | undefined;
  return row ? toApplicationLabel(row) : null;
}

function createApplicationLabelAssignmentMethods(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<
  ApplicationTrackerMethods,
  'listApplicationLabelAssignments' | 'assignApplicationLabel' | 'removeApplicationLabel'
> {
  return {
    ...createApplicationLabelAssignmentListMethod(requireCandidate, database),
    ...createApplicationLabelAssignmentMutationMethods(requireCandidate, database),
  };
}

function createApplicationLabelAssignmentListMethod(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<ApplicationTrackerMethods, 'listApplicationLabelAssignments'> {
  return {
    listApplicationLabelAssignments(candidateId) {
      requireCandidate(candidateId);
      const rows = database.prepare(`
        SELECT assignment.application_id, assignment.label_id, assignment.created_at
        FROM application_label_assignments AS assignment
        JOIN applications AS application ON application.id = assignment.application_id
        WHERE assignment.candidate_id = ? AND application.candidate_id = ?
        ORDER BY assignment.application_id, assignment.created_at, assignment.label_id
      `).all(candidateId, candidateId) as unknown as ApplicationLabelAssignmentRow[];
      return rows.map((row) => ({
        applicationId: row.application_id,
        labelId: row.label_id,
        createdAt: row.created_at,
      }));
    },
  };
}

function createApplicationLabelAssignmentMutationMethods(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<ApplicationTrackerMethods, 'assignApplicationLabel' | 'removeApplicationLabel'> {
  return {
    assignApplicationLabel(candidateId, applicationId, labelId, now = new Date().toISOString()) {
      requireCandidate(candidateId);
      const applicationExists = ownsApplication(database, candidateId, applicationId);
      const label = findApplicationLabel(database, candidateId, labelId);
      if (!applicationExists || !label) return { changed: false, applicationExists, label };
      const result = database.prepare(`
        INSERT INTO application_label_assignments (candidate_id, application_id, label_id, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(candidate_id, application_id, label_id) DO NOTHING
      `).run(candidateId, applicationId, labelId, now);
      return { changed: Number(result.changes) === 1, applicationExists, label };
    },
    removeApplicationLabel(candidateId, applicationId, labelId) {
      requireCandidate(candidateId);
      const applicationExists = ownsApplication(database, candidateId, applicationId);
      const labelExists = findApplicationLabel(database, candidateId, labelId) !== null;
      const result = database.prepare(`
        DELETE FROM application_label_assignments
        WHERE candidate_id = ? AND application_id = ? AND label_id = ?
      `).run(candidateId, applicationId, labelId);
      return {
        changed: Number(result.changes) === 1,
        applicationExists,
        labelExists,
      };
    },
  };
}

function createApplicationRetryMethods(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<
  ApplicationTrackerMethods,
  'listApplicationRetryRequests' | 'bulkQueueApplicationRetries'
> {
  return {
    listApplicationRetryRequests(candidateId) {
      requireCandidate(candidateId);
      const rows = database.prepare(`
        SELECT request.application_id, request.operation_id, request.requested_at, request.state
        FROM application_retry_requests AS request
        JOIN applications AS application ON application.id = request.application_id
        WHERE request.candidate_id = ? AND application.candidate_id = ?
        ORDER BY request.requested_at DESC, request.operation_id
      `).all(candidateId, candidateId) as unknown as ApplicationRetryRequestRow[];
      return rows.map((row) => ({
        applicationId: row.application_id,
        operationId: row.operation_id,
        requestedAt: row.requested_at,
        state: row.state,
      }));
    },
    bulkQueueApplicationRetries(candidateId, targets, operationId, requestedAt) {
      requireCandidate(candidateId);
      return inTransaction(database, () => queueApplicationRetryBatch(
        database,
        candidateId,
        targets,
        operationId,
        requestedAt,
      ));
    },
  };
}

function createApplicationReplayMethods(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<ApplicationTrackerMethods, 'runApplicationOperation'> {
  return {
    runApplicationOperation<T extends Record<string, unknown>>(
      candidateId: string,
      operationId: string,
      requestHash: string,
      operationType: string,
      operation: () => T,
      createdAt?: string,
    ): ApplicationOperationReplay<T> {
      requireCandidate(candidateId);
      return inTransaction(database, () => {
        const existing = database.prepare(`
          SELECT operation_type, request_hash, result_json FROM candidate_application_operations
          WHERE candidate_id = ? AND operation_id = ?
        `).get(candidateId, operationId) as ApplicationOperationRow | undefined;
        if (existing) {
          if (existing.operation_type !== operationType || existing.request_hash !== requestHash) {
            throw new ApplicationOperationConflictError();
          }
          return { result: JSON.parse(existing.result_json) as T, replayed: true };
        }
        const result = operation();
        database.prepare(`
          INSERT INTO candidate_application_operations
            (candidate_id, operation_id, operation_type, request_hash, result_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(candidateId, operationId, operationType, requestHash, JSON.stringify(result), createdAt ?? new Date().toISOString());
        return { result, replayed: false };
      });
    },
  };
}

function createApplicationStageBatchMethods(
  requireCandidate: RequireCandidate,
  database: DatabaseSync,
): Pick<ApplicationTrackerMethods, 'bulkChangeApplicationStages'> {
  return {
    bulkChangeApplicationStages(candidateId, targets, targetStage, occurredAt) {
      requireCandidate(candidateId);
      return inTransaction(database, () => applyApplicationStageBatch(
        database,
        candidateId,
        targets,
        targetStage,
        occurredAt,
      ));
    },
  };
}

function normalizeLabelName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}

function toApplicationLabel(row: ApplicationLabelRow): ApplicationLabel {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function ownsApplication(database: DatabaseSync, candidateId: string, applicationId: string): boolean {
  return database.prepare(`
    SELECT 1 FROM applications WHERE candidate_id = ? AND id = ?
  `).get(candidateId, applicationId) !== undefined;
}

function findApplicationLabel(
  database: DatabaseSync,
  candidateId: string,
  labelId: string,
): ApplicationLabel | null {
  const row = database.prepare(`
    SELECT id, name, created_at FROM candidate_application_labels WHERE candidate_id = ? AND id = ?
  `).get(candidateId, labelId) as ApplicationLabelRow | undefined;
  return row ? toApplicationLabel(row) : null;
}

function inTransaction<T>(database: DatabaseSync, operation: () => T): T {
  if (database.isTransaction) return operation();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function applyApplicationStageBatch(
  database: DatabaseSync,
  candidateId: string,
  targets: readonly { id: string; stage: ApplicationStage; version: number }[],
  targetStage: ApplicationStage,
  occurredAt: string,
): number {
  const update = database.prepare(`
    UPDATE applications SET stage = ?,
      archive_reason = CASE WHEN ? = 'archived' THEN 'candidate' ELSE NULL END,
      archive_previous_stage = CASE WHEN ? = 'archived' THEN ? ELSE NULL END,
      stage_changed_at = ?, version = version + 1, updated_at = ?
    WHERE candidate_id = ? AND id = ? AND version = ? AND stage = ?
  `);
  const insertEvent = database.prepare(`
    INSERT INTO application_events
      (id, application_id, candidate_id, kind, from_stage, to_stage, occurred_at, recorded_at, provenance, payload_cipher)
    VALUES (?, ?, ?, 'stage', ?, ?, ?, ?, 'candidate', NULL)
  `);
  for (const target of targets) {
    applyApplicationStageUpdate(database, update, insertEvent, candidateId, target, targetStage, occurredAt);
  }
  return targets.length;
}

function queueApplicationRetryBatch(
  database: DatabaseSync,
  candidateId: string,
  targets: readonly { id: string }[],
  operationId: string,
  requestedAt: string,
): number {
  const insert = database.prepare(`
    INSERT INTO application_retry_requests
      (candidate_id, application_id, operation_id, requested_at, state)
    SELECT ?, id, ?, ?, 'prepared' FROM applications WHERE candidate_id = ? AND id = ?
    ON CONFLICT(candidate_id, application_id, operation_id) DO NOTHING
  `);
  let queued = 0;
  for (const target of targets) {
    const result = insert.run(candidateId, operationId, requestedAt, candidateId, target.id);
    queued += Number(result.changes);
  }
  return queued;
}

function applyApplicationStageUpdate(
  database: DatabaseSync,
  update: ReturnType<DatabaseSync['prepare']>,
  insertEvent: ReturnType<DatabaseSync['prepare']>,
  candidateId: string,
  target: { id: string; stage: ApplicationStage; version: number },
  targetStage: ApplicationStage,
  occurredAt: string,
): void {
  const result = update.run(
    targetStage,
    targetStage,
    targetStage,
    target.stage,
    occurredAt,
    occurredAt,
    candidateId,
    target.id,
    target.version,
    target.stage,
  );
  if (Number(result.changes) !== 1) throwStageUpdateConflict(database, candidateId, target.id);
  insertEvent.run(
    randomUUID(), target.id, candidateId, target.stage, targetStage, occurredAt, occurredAt,
  );
}

function throwStageUpdateConflict(database: DatabaseSync, candidateId: string, applicationId: string): never {
  const row = database.prepare(`
    SELECT version FROM applications WHERE candidate_id = ? AND id = ?
  `).get(candidateId, applicationId) as { version: number } | undefined;
  if (!row) throw new ApplicationNotFoundError();
  throw new ApplicationVersionConflictError(row.version);
}
