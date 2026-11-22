import type { DatabaseSync } from 'node:sqlite';
import type { StoredActionReceipt } from '../candidate/sqliteCandidateActionRepository';
import {
  SqliteQuestionnaireRepository,
  type StoredQuestionnaire,
} from '../candidate/sqliteQuestionnaireRepository';
import { SqliteRejectionReviewRepository } from '../candidate/sqliteRejectionReviewRepository';
import type { RejectionCandidateReason } from '../../shared/rejectionReview';
import type { EmployerRead } from './applicationEmployerReads';
import { tableExists, whenTableExists } from './exportTableReader';
import { SealedText } from './sealedText';
import { SqliteApplicationInterviewRepository } from './sqliteApplicationInterviewRepository';
import { SqliteApplicationMaterialsRepository } from './sqliteApplicationMaterialsRepository';
import { SqliteApplicationRepository } from './sqliteApplicationRepository';
import type { ApplicationTrackerMethods } from './sqliteCandidateStoreApplicationMethods';
import type { SqliteCandidateStore } from './sqliteCandidateStore';
import type { StoredReferralTrack } from './sqliteReferralTrackRepository';
import type { StoredStarPrep } from './sqliteStarPrepRepository';

/** Чем трекер читается из хранилища: те же методы, что у маршрутов трекера. */
export type TrackerExportStore = Pick<
  SqliteCandidateStore,
  | 'listApplications'
  | 'listVacancyApplications'
  | 'listVacancySkips'
  | 'listCareerCommands'
  | 'starPrepRepo'
  | 'referralTrackRepo'
> &
  Pick<
    ApplicationTrackerMethods,
    | 'listApplicationContacts'
    | 'getEmployerRead'
    | 'listApplicationLabels'
    | 'listApplicationLabelAssignments'
    | 'listApplicationRetryRequests'
  >;

type Applications = ReturnType<TrackerExportStore['listApplications']>;

/** Отклик с тем, что экран трекера показывает сводкой: события, материалы, собеседования. */
export type ExportedApplication = Applications[number] & {
  readonly events: ReturnType<SqliteApplicationRepository['listEvents']>;
  readonly linkedMaterials: ReturnType<SqliteApplicationMaterialsRepository['list']>;
  readonly interviews: ReturnType<SqliteApplicationInterviewRepository['list']>;
};

export interface CommandApproval {
  readonly commandId: string;
  readonly capability: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface OutreachRecord {
  readonly clientRecordId: string;
  readonly applicationId: string | null;
  readonly status: string;
  readonly sentAt: string | null;
  readonly updatedAt: string;
}

export interface ActionBatch {
  readonly id: string;
  readonly status: string;
  readonly confirmedAt: string;
  readonly createdAt: string;
}

/**
 * B738 · 1: трекер откликов целиком. Отклик несёт события, материалы, собеседования и оффер
 * (как на экране трекера). Без секретов: у подтверждений команд нет номера подтверждения,
 * у квитанций действий нет адресов и отпечатка (они и в базе стираются после записи).
 */
export interface TrackerExport {
  readonly applications: ExportedApplication[];
  readonly contacts: Array<{ applicationId: string; name: string }>;
  readonly employerReads: Array<{ applicationId: string } & EmployerRead>;
  readonly labels: ReturnType<TrackerExportStore['listApplicationLabels']>;
  readonly labelAssignments: ReturnType<TrackerExportStore['listApplicationLabelAssignments']>;
  readonly retryRequests: ReturnType<TrackerExportStore['listApplicationRetryRequests']>;
  readonly starPreps: StoredStarPrep[];
  readonly referralTracks: StoredReferralTrack[];
  readonly vacancyApplications: ReturnType<TrackerExportStore['listVacancyApplications']>;
  readonly vacancySkips: ReturnType<TrackerExportStore['listVacancySkips']>;
  readonly careerCommands: ReturnType<TrackerExportStore['listCareerCommands']>;
  readonly commandApprovals: CommandApproval[];
  /** Таблица без записи в коде; поле контакта не выгружается, его формат нигде не задан. */
  readonly outreach: OutreachRecord[];
  readonly questionnaires: StoredQuestionnaire[];
  readonly rejectionReasons: Array<{ applicationId: string } & RejectionCandidateReason>;
  readonly rejectionReviewHelped: boolean | null;
  readonly actionBatches: ActionBatch[];
  readonly actionReceipts: Array<Omit<StoredActionReceipt, 'candidateId'>>;
}

export interface TrackerExportSources {
  readonly store: TrackerExportStore;
  readonly database: DatabaseSync;
  readonly encryptionKey: Buffer;
}

function perApplication<T>(applications: readonly { id: string }[], read: (applicationId: string) => T | null): T[] {
  return applications.flatMap((application) => {
    const value = read(application.id);
    return value ? [value] : [];
  });
}

function rows<T>(database: DatabaseSync, table: string, sql: string, candidateId: string): T[] {
  if (!tableExists(database, table)) return [];
  return database.prepare(sql).all(candidateId) as unknown as T[];
}

function commandApprovals(database: DatabaseSync, candidateId: string): CommandApproval[] {
  return rows(
    database,
    'career_command_approvals',
    `SELECT command_id AS commandId, capability, expires_at AS expiresAt,
            consumed_at AS consumedAt, created_at AS createdAt
     FROM career_command_approvals WHERE candidate_id = ? ORDER BY created_at, command_id`,
    candidateId,
  );
}

function outreach(database: DatabaseSync, candidateId: string): OutreachRecord[] {
  return rows(
    database,
    'candidate_outreach',
    `SELECT client_record_id AS clientRecordId, application_id AS applicationId, status,
            sent_at AS sentAt, updated_at AS updatedAt
     FROM candidate_outreach WHERE candidate_id = ? ORDER BY updated_at, client_record_id`,
    candidateId,
  );
}

function actionBatches(database: DatabaseSync, candidateId: string): ActionBatch[] {
  return rows(
    database,
    'candidate_action_batches',
    `SELECT id, status, confirmed_at AS confirmedAt, created_at AS createdAt
     FROM candidate_action_batches WHERE candidate_id = ? ORDER BY created_at, id`,
    candidateId,
  );
}

function actionReceipts(database: DatabaseSync, candidateId: string): TrackerExport['actionReceipts'] {
  return rows(
    database,
    'candidate_action_receipts',
    `SELECT id, batch_id AS batchId, platform, action_kind AS actionKind, status,
            application_id AS applicationId, failure_code AS failureCode,
            executed_at AS executedAt, created_at AS createdAt
     FROM candidate_action_receipts WHERE candidate_id = ? ORDER BY executed_at, id`,
    candidateId,
  );
}

/** Анкеты и разбор отказов читаются своими репозиториями на соединении хранилища. */
function createSeparateReaders({ database, encryptionKey }: TrackerExportSources) {
  return {
    questionnaires: whenTableExists(
      database,
      'application_questionnaires',
      () => new SqliteQuestionnaireRepository(database, encryptionKey),
      (repository, candidateId) => repository.exportAll(candidateId),
      () => [],
    ),
    rejections: whenTableExists(
      database,
      'application_rejection_reasons',
      () => new SqliteRejectionReviewRepository(database, encryptionKey),
      (repository, candidateId) => ({
        reasons: [...repository.reasons(candidateId)].map(([applicationId, reason]) => ({ applicationId, ...reason })),
        helped: repository.helped(candidateId),
      }),
      () => ({ reasons: [], helped: null }),
    ),
  };
}

function createApplicationDetails({ database, encryptionKey }: TrackerExportSources) {
  const sealedText = new SealedText(encryptionKey);
  const applications = new SqliteApplicationRepository(database, sealedText);
  const materials = new SqliteApplicationMaterialsRepository(database);
  const interviews = new SqliteApplicationInterviewRepository(database, sealedText);
  return (candidateId: string, view: Applications[number]): ExportedApplication => ({
    ...view,
    events: applications.listEvents(candidateId, view.id),
    linkedMaterials: materials.list(view.id),
    interviews: interviews.list(view.id),
  });
}

export function createTrackerExport(sources: TrackerExportSources): (candidateId: string) => TrackerExport {
  const separate = createSeparateReaders(sources);
  const withDetails = createApplicationDetails(sources);
  const { store, database } = sources;
  return (candidateId) => {
    const applications = store.listApplications(candidateId).map((view) => withDetails(candidateId, view));
    const contacts = store.listApplicationContacts(candidateId);
    const rejections = separate.rejections(candidateId);
    return {
      applications,
      contacts: [...contacts].map(([applicationId, name]) => ({ applicationId, name })),
      employerReads: perApplication(applications, (applicationId) => {
        const read = store.getEmployerRead(candidateId, applicationId);
        return read ? { applicationId, ...read } : null;
      }),
      labels: store.listApplicationLabels(candidateId),
      labelAssignments: store.listApplicationLabelAssignments(candidateId),
      retryRequests: store.listApplicationRetryRequests(candidateId),
      starPreps: perApplication(applications, (id) => store.starPrepRepo.get(candidateId, id)),
      referralTracks: perApplication(applications, (id) => store.referralTrackRepo.get(candidateId, id)),
      vacancyApplications: store.listVacancyApplications(candidateId),
      vacancySkips: store.listVacancySkips(candidateId),
      careerCommands: store.listCareerCommands(candidateId),
      commandApprovals: commandApprovals(database, candidateId),
      outreach: outreach(database, candidateId),
      questionnaires: separate.questionnaires(candidateId),
      rejectionReasons: rejections.reasons,
      rejectionReviewHelped: rejections.helped,
      actionBatches: actionBatches(database, candidateId),
      actionReceipts: actionReceipts(database, candidateId),
    };
  };
}
