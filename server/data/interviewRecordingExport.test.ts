import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { forbiddenExportKeys } from './exportForbiddenKeys';
import { openSeeded, seedRecording } from './exportTestSeeds';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const AT = '2026-11-23T10:00:00.000Z';

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-interview-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

describe('B738 · 9: записи интервью в выгрузке', () => {
  it('отдаёт расшифровку, разбор и имя собеседника только своего кандидата, без токена и хеша', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const database = openSeeded(databasePath);
    seedRecording(database, own.id, 'own');
    seedRecording(database, other.id, 'other');
    database.close();

    const exported = store.exportCandidate(own.id);
    const { recordings, interviewers } = exported.interviewRecordings;
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({ recordingId: 'rec-own', status: 'finished', interviewId: 'int-own' });
    expect(JSON.stringify(recordings[0].transcript)).toContain('Ответ own');
    expect(recordings[0].debriefs).toEqual([{ status: 'ready', findings: { summary: 'Разбор own' }, createdAt: AT }]);
    expect(recordings[0].voices).toEqual({ status: 'ready', labels: [1], candidateVoice: 1, updatedAt: AT });
    expect(interviewers).toEqual([{ interviewId: 'int-own', name: 'Ирина own', updatedAt: AT }]);
    const text = JSON.stringify(exported.interviewRecordings);
    expect(text).not.toContain('other');
    expect(text).not.toContain('hash-of-token');
    expect(text).not.toContain('model-x');
    expect(forbiddenExportKeys(exported.interviewRecordings, 'interviewRecordings')).toEqual([]);
  });

  it('повреждённый сегмент пропускается, остальная расшифровка остаётся', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const database = openSeeded(databasePath);
    seedRecording(database, own.id, 'own');
    database
      .prepare(
        `INSERT INTO interview_recording_segments (recording_id, track, segment, started_at, duration_ms, status, text_cipher, updated_at)
         VALUES ('rec-own', 'system', 0, ?, 2000, 'done', 'broken', ?)`,
      )
      .run(AT, AT);
    database.prepare("UPDATE interview_interviewers SET name_cipher = 'broken'").run();
    database.close();

    const [recording] = store.exportCandidate(own.id).interviewRecordings.recordings;
    expect(JSON.stringify(recording.transcript)).toContain('Ответ own');
    expect(store.exportCandidate(own.id).interviewRecordings.interviewers[0].name).toBeNull();
  });

  it('без таблиц записей отдаёт пустые списки и не создаёт таблиц', () => {
    const { databasePath, store } = fileStore();
    const candidate = createCandidate(store);
    expect(store.exportCandidate(candidate.id).interviewRecordings).toEqual({ recordings: [], interviewers: [] });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const found = database.prepare("SELECT name FROM sqlite_master WHERE name = 'interview_recordings'").get();
    database.close();
    expect(found).toBeUndefined();
  });
});
