import type { DatabaseSync } from 'node:sqlite';
import type { StoredResumeVersion } from '../domain/resumeVersions';
import { tableExists } from './exportTableReader';
import { SealedText } from './sealedText';
import { SqliteCandidateMediaRepository } from './sqliteCandidateMediaRepository';
import type { SqliteCandidateStore } from './sqliteCandidateStore';
import { SqliteResumeVersionRepository } from './sqliteResumeVersionRepository';

/** B738 · 3: чем история профиля читается из хранилища — теми же методами, что у экранов. */
export type ProfileHistoryExportStore = Pick<
  SqliteCandidateStore,
  | 'profileChangeLog'
  | 'profileRevisionRepo'
  | 'careerVectorRepo'
  | 'decisionProfileRepo'
  | 'skillQuizAttempts'
  | 'interviewSimulatorRepo'
  | 'getConsultantRejections'
>;

export interface ProfileHistorySources {
  readonly store: ProfileHistoryExportStore;
  readonly database: DatabaseSync;
  readonly encryptionKey: Buffer;
}

export interface ExportedMedia {
  readonly mediaId: string;
  readonly kind: string;
  readonly mime: string;
  readonly createdAt: string;
  readonly base64: string;
}

export interface ExportedInterviewDesignSchema {
  readonly sessionId: string;
  readonly questionId: string;
  readonly schema: unknown;
  readonly updatedAt: string;
}

export interface ExportedInterviewReviewHelpful {
  readonly sessionId: string;
  readonly questionId: string;
  readonly helpful: boolean;
  readonly updatedAt: string;
}

export interface ExportedGoalMarker {
  readonly kind: string;
  readonly entityKey: string;
  readonly recordedAt: string;
  readonly evidenceKind: string;
}

export interface ExportedInterviewDesignTask {
  readonly applicationId: string;
  readonly task: unknown;
  readonly createdAt: string;
}

export interface ExportedImportWalk {
  readonly platform: string;
  readonly state: string;
  readonly sections: unknown;
  readonly updatedAt: string;
}

type Store = ProfileHistoryExportStore;

export interface ProfileHistoryExport {
  readonly resumeVersions: readonly StoredResumeVersion[];
  readonly media: readonly ExportedMedia[];
  readonly changeLog: ReturnType<Store['profileChangeLog']['list']>['entries'];
  readonly revisions: ReturnType<Store['profileRevisionRepo']['listRevisions']>;
  readonly careerVector: ReturnType<Store['careerVectorRepo']['get']>;
  readonly decisionProfile: ReturnType<Store['decisionProfileRepo']['get']>;
  readonly skillQuizAttempts: ReturnType<Store['skillQuizAttempts']['list']>;
  readonly interviewDesignSchemas: readonly ExportedInterviewDesignSchema[];
  readonly interviewReviewHelpful: readonly ExportedInterviewReviewHelpful[];
  /** B750: задачи System Design по откликам. */
  readonly interviewDesignTasks: readonly ExportedInterviewDesignTask[];
  readonly goalMarkers: readonly ExportedGoalMarker[];
  readonly importWalks: readonly ExportedImportWalk[];
  readonly consultantRejections: ReturnType<Store['getConsultantRejections']>;
}

const CHANGE_LOG_PAGE = 200;

/** Строки таблицы кандидата; таблицы, которой ещё нет в базе, — пусто. */
function rows<Row>(database: DatabaseSync, table: string, sql: string, candidateId: string): Row[] {
  if (!tableExists(database, table)) return [];
  return database.prepare(sql).all(candidateId) as unknown as Row[];
}

function readChangeLog(store: Store, candidateId: string): ProfileHistoryExport['changeLog'] {
  const first = store.profileChangeLog.list(candidateId, 0, CHANGE_LOG_PAGE);
  const pages = Math.ceil(first.total / CHANGE_LOG_PAGE);
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
    store.profileChangeLog.list(candidateId, index + 1, CHANGE_LOG_PAGE).entries,
  );
  return [...first.entries, ...rest.flat()];
}

function readSealedRows(sources: ProfileHistorySources, candidateId: string) {
  const sealedText = new SealedText(sources.encryptionKey);
  const versions = new SqliteResumeVersionRepository(sources.database, sealedText);
  const media = new SqliteCandidateMediaRepository(sources.database, sealedText);
  const versionIds = rows<{ version_id: string }>(
    sources.database,
    'candidate_resume_versions',
    'SELECT version_id FROM candidate_resume_versions WHERE candidate_id = ? ORDER BY updated_at DESC, version_id',
    candidateId,
  );
  const mediaRows = rows<{ media_id: string; kind: string; created_at: string }>(
    sources.database,
    'candidate_media',
    'SELECT media_id, kind, created_at FROM candidate_media WHERE candidate_id = ? ORDER BY created_at, media_id',
    candidateId,
  );
  return {
    resumeVersions: versionIds.flatMap(({ version_id }) => versions.get(candidateId, version_id) ?? []),
    media: mediaRows.flatMap((row) => {
      const stored = media.get(candidateId, row.media_id);
      return stored
        ? [{ mediaId: row.media_id, kind: row.kind, mime: stored.mime, createdAt: row.created_at, base64: stored.bytes.toString('base64') }]
        : [];
    }),
  };
}

function readInterviewRows(sources: ProfileHistorySources, candidateId: string) {
  const { database, store } = sources;
  const schemaKeys = rows<{ session_id: string; question_id: string; updated_at: string }>(
    database,
    'candidate_interview_design_schemas',
    `SELECT session_id, question_id, updated_at FROM candidate_interview_design_schemas
     WHERE candidate_id = ? ORDER BY session_id, question_id`,
    candidateId,
  );
  const helpful = rows<{ session_id: string; question_id: string; helpful: number; updated_at: string }>(
    database,
    'candidate_interview_review_helpful',
    `SELECT session_id, question_id, helpful, updated_at FROM candidate_interview_review_helpful
     WHERE candidate_id = ? ORDER BY session_id, question_id`,
    candidateId,
  );
  return {
    interviewDesignSchemas: schemaKeys.map((row) => ({
      sessionId: row.session_id,
      questionId: row.question_id,
      schema: store.interviewSimulatorRepo.designSchemas.get({
        candidateId,
        sessionId: row.session_id,
        questionId: row.question_id,
      }),
      updatedAt: row.updated_at,
    })),
    interviewDesignTasks: store.interviewSimulatorRepo.designTasks
      .listKeys(candidateId)
      .map(({ applicationId, createdAt }) => ({
        applicationId,
        task: store.interviewSimulatorRepo.designTasks.get({ candidateId, applicationId }),
        createdAt,
      })),
    interviewReviewHelpful: helpful.map((row) => ({
      sessionId: row.session_id,
      questionId: row.question_id,
      helpful: row.helpful === 1,
      updatedAt: row.updated_at,
    })),
  };
}

function readPlainRows(database: DatabaseSync, candidateId: string) {
  const markers = rows<{ kind: string; entity_key: string; recorded_at: string; evidence_kind: string }>(
    database,
    'candidate_goal_markers',
    `SELECT kind, entity_key, recorded_at, evidence_kind FROM candidate_goal_markers
     WHERE candidate_id = ? ORDER BY recorded_at, kind, entity_key`,
    candidateId,
  );
  const walks = rows<{ platform: string; state: string; sections_json: string; updated_at: string }>(
    database,
    'candidate_import_walks',
    'SELECT platform, state, sections_json, updated_at FROM candidate_import_walks WHERE candidate_id = ? ORDER BY platform',
    candidateId,
  );
  return {
    goalMarkers: markers.map((row) => ({
      kind: row.kind,
      entityKey: row.entity_key,
      recordedAt: row.recorded_at,
      evidenceKind: row.evidence_kind,
    })),
    importWalks: walks.map((row) => ({
      platform: row.platform,
      state: row.state,
      sections: JSON.parse(row.sections_json) as unknown,
      updatedAt: row.updated_at,
    })),
  };
}

export function exportProfileHistory(sources: ProfileHistorySources, candidateId: string): ProfileHistoryExport {
  const { store } = sources;
  return {
    ...readSealedRows(sources, candidateId),
    changeLog: readChangeLog(store, candidateId),
    revisions: store.profileRevisionRepo.listRevisions(candidateId),
    careerVector: store.careerVectorRepo.get(candidateId),
    decisionProfile: store.decisionProfileRepo.get(candidateId),
    skillQuizAttempts: store.skillQuizAttempts.list(candidateId),
    ...readInterviewRows(sources, candidateId),
    ...readPlainRows(sources.database, candidateId),
    consultantRejections: store.getConsultantRejections(candidateId),
  };
}
