import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteInterviewRecordingRepository } from '../data/sqliteInterviewRecordingRepository';

/**
 * B642: записи ссылаются на `candidates` (каскад при удалении аккаунта), поэтому отдельной
 * базе в тестах нужна таблица кандидатов с кандидатом `c`.
 */
export function recordingRepositoryForTests(): SqliteInterviewRecordingRepository {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'oq-recordings-')), 'test.db');
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE candidates (id TEXT PRIMARY KEY); INSERT INTO candidates VALUES ('c');",
  );
  database.close();
  return new SqliteInterviewRecordingRepository({ databasePath });
}
