import type { DatabaseSync } from 'node:sqlite';
import type { HhResumeSnapshot } from '../../shared/hhCandidateSession';
import {
  type CandidateAutomationConsent,
  type CandidateAutomationJournalEntry,
  type CandidateAutomationQueueItem,
  type CandidateAutomationSettings,
  type CandidateAutomationStopCompany,
  SqliteCandidateAutomationRepository,
} from '../candidate/sqliteCandidateAutomationRepository';
import type { CandidateAutomationSchedule } from '../candidate/candidateAutomationScheduler';
import { SqliteCandidateAutomationScheduleRepository } from '../candidate/sqliteCandidateAutomationScheduleRepository';
import { hhResumeSnapshotScope } from '../candidate/sqliteHhSessionRepository';
import { tableExists } from './exportTableReader';
import { SealedText } from './sealedText';

/**
 * B738 · 8: автоотклики и hh.ru. Настройки, согласия, стоп-список, очередь с письмами, расписание и
 * журнал отправок; попытки отклика на hh.ru, подъём резюме и прочитанный снимок резюме. Не
 * выгружаются служебные коды ошибок и номер квитанции площадки; сессия и cookies hh.ru лежат в
 * других таблицах и сюда не читаются.
 */
export interface AutomationExportSources {
  readonly database: DatabaseSync;
  readonly encryptionKey: Buffer;
}

type Row = Record<string, unknown>;

export type ExportedJournalEntry = Omit<CandidateAutomationJournalEntry, 'receiptId' | 'failureCode'>;

export interface AutomationExport {
  readonly settings: CandidateAutomationSettings | null;
  readonly consents: readonly CandidateAutomationConsent[];
  readonly stopCompanies: readonly CandidateAutomationStopCompany[];
  readonly queue: readonly CandidateAutomationQueueItem[];
  readonly schedule: CandidateAutomationSchedule | null;
  readonly journal: readonly ExportedJournalEntry[];
  readonly hh: {
    readonly applyAttempts: readonly Row[];
    readonly applyConsents: readonly Row[];
    readonly raiseSchedules: readonly Row[];
    readonly raiseChoice: readonly Row[];
    readonly resumeSnapshot: HhResumeSnapshot | null;
  };
}

function rows(database: DatabaseSync, table: string, sql: string, candidateId: string): Row[] {
  if (!tableExists(database, table)) return [];
  return database.prepare(sql).all(candidateId) as Row[];
}

/** Повреждённые данные раздела не роняют выгрузку: раздел отдаётся пустым. */
function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function readAutoApply(sources: AutomationExportSources, candidateId: string) {
  const { database, encryptionKey } = sources;
  if (!tableExists(database, 'candidate_auto_apply_settings')) {
    return { settings: null, consents: [], stopCompanies: [], queue: [] };
  }
  const repository = new SqliteCandidateAutomationRepository(database, encryptionKey);
  const stored = rows(database, 'candidate_auto_apply_settings', 'SELECT 1 FROM candidate_auto_apply_settings WHERE candidate_id = ?', candidateId);
  return {
    settings: stored.length > 0 ? safe(() => repository.getSettings(candidateId), null) : null,
    consents: safe(() => repository.listConsents(candidateId), []),
    stopCompanies: safe(() => repository.listStopCompanies(candidateId), []),
    queue: repository.exportQueue(candidateId),
  };
}

function readSchedule(sources: AutomationExportSources, candidateId: string) {
  const { database, encryptionKey } = sources;
  if (!tableExists(database, 'candidate_auto_apply_journal')) return { schedule: null, journal: [] };
  const repository = new SqliteCandidateAutomationScheduleRepository(database, encryptionKey);
  const stored = rows(database, 'candidate_auto_apply_schedule', 'SELECT 1 FROM candidate_auto_apply_schedule WHERE candidate_id = ?', candidateId);
  return {
    schedule: stored.length > 0 ? safe(() => repository.getSchedule(candidateId), null) : null,
    journal: repository.exportJournal(candidateId).map(({ receiptId: _receipt, failureCode: _code, ...entry }) => entry),
  };
}

function readResumeSnapshot(sources: AutomationExportSources, candidateId: string): HhResumeSnapshot | null {
  const [row] = rows(sources.database, 'hh_resume_snapshots', 'SELECT snapshot_cipher AS sealed FROM hh_resume_snapshots WHERE candidate_id = ?', candidateId);
  if (typeof row?.sealed !== 'string') return null;
  const sealed = row.sealed;
  return safe(
    () => JSON.parse(new SealedText(sources.encryptionKey).open(sealed, hhResumeSnapshotScope(candidateId))) as HhResumeSnapshot,
    null,
  );
}

export function exportAutomation(sources: AutomationExportSources, candidateId: string): AutomationExport {
  const { database } = sources;
  return {
    ...readAutoApply(sources, candidateId),
    ...readSchedule(sources, candidateId),
    hh: {
      applyAttempts: rows(
        database,
        'hh_apply_attempts',
        `SELECT vacancy_id AS vacancyId, resume_id AS resumeId, outcome, started_at AS startedAt, finished_at AS finishedAt
         FROM hh_apply_attempts WHERE candidate_id = ? ORDER BY started_at, id`,
        candidateId,
      ),
      applyConsents: rows(
        database,
        'hh_apply_consents',
        `SELECT host, consent_text AS consentText, policy_url AS policyUrl, basis, given_at AS givenAt
         FROM hh_apply_consents WHERE candidate_id = ? ORDER BY given_at, position`,
        candidateId,
      ),
      raiseSchedules: rows(
        database,
        'hh_raise_schedules',
        `SELECT resume_id AS resumeId, enabled, last_raised_at AS lastRaisedAt, next_raise_at AS nextRaiseAt,
           last_result AS lastResult, last_reason AS lastReason, last_result_at AS lastResultAt,
           paused_until AS pausedUntil, pause_reason AS pauseReason, updated_at AS updatedAt
         FROM hh_raise_schedules WHERE candidate_id = ? ORDER BY resume_id`,
        candidateId,
      ),
      raiseChoice: rows(
        database,
        'hh_raise_choices',
        `SELECT resume_id AS resumeId, updated_at AS updatedAt FROM hh_raise_choices WHERE candidate_id = ?`,
        candidateId,
      ),
      resumeSnapshot: readResumeSnapshot(sources, candidateId),
    },
  };
}
