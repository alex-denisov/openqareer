/**
 * B738: тестовые данные разделов выгрузки — общие для тестов разделов и теста запрещённых полей
 * на всей выгрузке. Только для тестов.
 */
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE } from '../candidate/candidateAutomationScheduler';
import { DEFAULT_CANDIDATE_AUTOMATION_RULES, SqliteCandidateAutomationRepository } from '../candidate/sqliteCandidateAutomationRepository';
import { SqliteCandidateAutomationScheduleRepository } from '../candidate/sqliteCandidateAutomationScheduleRepository';
import { HH_RAISE_SCHEMA } from '../candidate/sqliteHhRaiseRepository';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { findingsData, interviewerData } from '../recordings/interviewDebriefService';
import { segmentAssociatedData } from '../recordings/recordingTranscriptionService';
import { addRecordingSourceColumns, MIGRATION_INTERVIEW_DEBRIEFS, MIGRATION_INTERVIEW_RECORDINGS } from './interviewRecordingSchema';
import { SealedText } from './sealedText';

export const SEED_AT = '2026-11-23T10:00:00.000Z';
const AT = SEED_AT;
const KEY = Buffer.alloc(32, 4);

export function seedAutoApply(database: DatabaseSync, candidateId: string, tag: string) {
  const automation = new SqliteCandidateAutomationRepository(database, KEY);
  automation.saveSettings(candidateId, { enabled: true, mode: 'approval_required', rules: DEFAULT_CANDIDATE_AUTOMATION_RULES }, AT);
  automation.acceptConsent(candidateId, 'drafts', 'v1', `Согласие ${tag}`, AT);
  automation.addStopCompany(candidateId, `Стоп ${tag}`, 'manual', AT);
  const item = automation.addQueueItem(candidateId, {
    clusterId: `cluster-${tag}`, applicationId: null, platform: 'hh', title: `CTO ${tag}`, role: 'CTO', company: `Компания ${tag}`,
    targetUrl: `https://hh.ru/vacancy/${tag}`, requirements: { matched: 3, total: 4 }, letterText: `Письмо ${tag}`, materials: [],
  }, 'later', false, AT);
  const schedule = new SqliteCandidateAutomationScheduleRepository(database, KEY);
  schedule.saveSchedule(candidateId, DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE, AT);
  schedule.appendJournalEntry({
    candidateId, queueItemId: item.id, platform: 'hh', result: 'error', receiptStatus: 'failed', attempted: true,
    localDate: '2026-11-23', company: `Компания ${tag}`, occurredAt: AT, receiptId: `receipt-${tag}`, failureCode: 'internal_code',
  });
}

export function seedHh(databasePath: string, database: DatabaseSync, candidateId: string, tag: string) {
  const hh = new SqliteHhSessionRepository({ databasePath, encryptionKey: KEY });
  hh.saveSnapshot(candidateId, { resumes: [{ id: `resume-${tag}`, title: `Резюме ${tag}` }], selected: null, readAt: AT });
  hh.close();
  database.prepare(`INSERT INTO hh_apply_attempts(id,candidate_id,vacancy_id,resume_id,outcome,failure_code,started_at,finished_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(`attempt-${tag}`, candidateId, `vacancy-${tag}`, `resume-${tag}`, 'applied', 'internal_code', AT, AT);
  database.exec(HH_RAISE_SCHEMA);
  database.prepare(`INSERT INTO hh_raise_schedules(candidate_id,resume_id,enabled,updated_at) VALUES (?,?,?,?)`).run(candidateId, `resume-${tag}`, 1, AT);
}

export function seedRecording(database: DatabaseSync, candidateId: string, tag: string) {
  const sealed = new SealedText(KEY);
  const recordingId = `rec-${tag}`;
  database
    .prepare(
      `INSERT INTO interview_recordings (id, candidate_id, application_id, interview_id, token_hash, token_expires_at,
         status, finished_at, created_at) VALUES (?, ?, ?, ?, 'hash-of-token', ?, 'finished', ?, ?)`,
    )
    .run(recordingId, candidateId, `app-${tag}`, `int-${tag}`, AT, AT, AT);
  const lines = JSON.stringify([{ start: 0, end: 2, text: `Ответ ${tag}` }]);
  database
    .prepare(
      `INSERT INTO interview_recording_segments (recording_id, track, segment, started_at, duration_ms, status, text_cipher, updated_at)
       VALUES (?, 'mic', 0, ?, 2000, 'done', ?, ?)`,
    )
    .run(recordingId, AT, sealed.seal(lines, segmentAssociatedData({ recordingId, track: 'mic', segment: 0 })), AT);
  database
    .prepare(
      `INSERT INTO interview_debrief_analyses (recording_id, transcript_hash, status, findings_cipher, answered_by, created_at)
       VALUES (?, 'th1', 'ready', ?, 'model-x', ?)`,
    )
    .run(recordingId, sealed.seal(JSON.stringify({ summary: `Разбор ${tag}` }), findingsData(recordingId, 'th1')), AT);
  database
    .prepare('INSERT INTO interview_interviewers (interview_id, candidate_id, name_cipher, updated_at) VALUES (?, ?, ?, ?)')
    .run(`int-${tag}`, candidateId, sealed.seal(`Ирина ${tag}`, interviewerData(`int-${tag}`)), AT);
}

export function openSeeded(databasePath: string) {
  const database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: false });
  database.exec(MIGRATION_INTERVIEW_RECORDINGS);
  addRecordingSourceColumns(database);
  database.exec(MIGRATION_INTERVIEW_DEBRIEFS);
  return database;
}
