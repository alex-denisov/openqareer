import type { DatabaseSync } from 'node:sqlite';
import { ApplicationNotFoundError } from './store/errors';

/**
 * «Работодатель прочитал» (B543): время прочтения отклика и кто его
 * зафиксировал — кандидат вручную или статус hh.ru. Новая пустая таблица, а
 * не колонка `applications` и не новый `kind` событий: прод-БД не переживает
 * `ALTER TABLE` в окне выката (B230). Отмена кандидата снимает только его
 * собственную отметку; отметка hh.ru заменяет ручную, ручная не перезаписывает hh.ru.
 */
export type EmployerReadSource = 'candidate' | 'hh';

export interface EmployerRead {
  readonly readAt: string;
  readonly source: EmployerReadSource;
}

export interface ApplicationEmployerReadMethods {
  getEmployerRead(candidateId: string, applicationId: string): EmployerRead | null;
  markEmployerRead(candidateId: string, applicationId: string, mark: EmployerRead): EmployerRead;
  /** Снимает ручную отметку; `false`, если снимать нечего или отметка от hh.ru. */
  clearEmployerRead(candidateId: string, applicationId: string): boolean;
}

function ensureSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS application_employer_reads (
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('candidate', 'hh')),
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (candidate_id, application_id)
    ) STRICT;
  `);
}

interface EmployerReadRow {
  read_at: string;
  source: EmployerReadSource;
}

export function createApplicationEmployerReadMethods(
  database: DatabaseSync,
  requireCandidate: (candidateId: string) => void,
): ApplicationEmployerReadMethods {
  ensureSchema(database);
  const read = (candidateId: string, applicationId: string): EmployerRead | null => {
    const row = database
      .prepare(
        'SELECT read_at, source FROM application_employer_reads WHERE candidate_id = ? AND application_id = ?',
      )
      .get(candidateId, applicationId) as unknown as EmployerReadRow | undefined;
    return row ? { readAt: row.read_at, source: row.source } : null;
  };
  const requireOwned = (candidateId: string, applicationId: string): void => {
    requireCandidate(candidateId);
    const owned = database
      .prepare('SELECT 1 FROM applications WHERE id = ? AND candidate_id = ?')
      .get(applicationId, candidateId);
    if (!owned) throw new ApplicationNotFoundError(applicationId);
  };
  return {
    getEmployerRead(candidateId, applicationId) {
      requireCandidate(candidateId);
      return read(candidateId, applicationId);
    },
    markEmployerRead(candidateId, applicationId, mark) {
      requireOwned(candidateId, applicationId);
      const current = read(candidateId, applicationId);
      if (current?.source === 'hh' && mark.source === 'candidate') return current;
      database
        .prepare(
          `INSERT INTO application_employer_reads (candidate_id, application_id, read_at, source, recorded_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(candidate_id, application_id) DO UPDATE SET
             read_at = excluded.read_at, source = excluded.source, recorded_at = excluded.recorded_at`,
        )
        .run(candidateId, applicationId, mark.readAt, mark.source, new Date().toISOString());
      return { readAt: mark.readAt, source: mark.source };
    },
    clearEmployerRead(candidateId, applicationId) {
      requireOwned(candidateId, applicationId);
      const result = database
        .prepare(
          `DELETE FROM application_employer_reads
           WHERE candidate_id = ? AND application_id = ? AND source = 'candidate'`,
        )
        .run(candidateId, applicationId);
      return Number(result.changes) > 0;
    },
  };
}

declare module './sqliteCandidateStore' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SqliteCandidateStore extends ApplicationEmployerReadMethods {}
}
