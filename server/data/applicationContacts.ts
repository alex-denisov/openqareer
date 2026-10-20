import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import { ApplicationNotFoundError } from './store/errors';

/**
 * Контакт отклика (B542): рекрутер или собеседник, которого называет
 * напоминание «Сегодня». Новая пустая таблица, а не колонка `applications`:
 * прод-БД не переживает `ALTER TABLE` в окне выката (B230). Имя — личные
 * данные третьего лица, поэтому хранится зашифрованным.
 */
export interface ApplicationContactMethods {
  listApplicationContacts(candidateId: string): ReadonlyMap<string, string>;
  setApplicationContact(candidateId: string, applicationId: string, name: string | null): void;
}

function ensureSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS application_contacts (
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      name_cipher TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (candidate_id, application_id)
    ) STRICT;
  `);
}

function associatedData(candidateId: string, applicationId: string): string {
  return `candidate:${candidateId}:application:${applicationId}:contact`;
}

export function createApplicationContactMethods(
  database: DatabaseSync,
  sealedText: SealedText,
  requireCandidate: (candidateId: string) => void,
): ApplicationContactMethods {
  ensureSchema(database);
  return {
    listApplicationContacts(candidateId) {
      requireCandidate(candidateId);
      const rows = database
        .prepare(
          'SELECT application_id, name_cipher FROM application_contacts WHERE candidate_id = ?',
        )
        .all(candidateId) as unknown as { application_id: string; name_cipher: string }[];
      return new Map(
        rows.map((row) => [
          row.application_id,
          sealedText.open(row.name_cipher, associatedData(candidateId, row.application_id)),
        ]),
      );
    },
    setApplicationContact(candidateId, applicationId, name) {
      requireCandidate(candidateId);
      const owned = database
        .prepare('SELECT 1 FROM applications WHERE id = ? AND candidate_id = ?')
        .get(applicationId, candidateId);
      if (!owned) throw new ApplicationNotFoundError(applicationId);
      const clean = name?.trim();
      if (!clean) {
        database
          .prepare('DELETE FROM application_contacts WHERE candidate_id = ? AND application_id = ?')
          .run(candidateId, applicationId);
        return;
      }
      database
        .prepare(
          `INSERT INTO application_contacts (candidate_id, application_id, name_cipher, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(candidate_id, application_id) DO UPDATE SET
             name_cipher = excluded.name_cipher, updated_at = excluded.updated_at`,
        )
        .run(
          candidateId,
          applicationId,
          sealedText.seal(clean, associatedData(candidateId, applicationId)),
          new Date().toISOString(),
        );
    },
  };
}

// Методы вплетаются в `SqliteCandidateStore` через `createApplicationTrackerMethods`;
// объявление здесь, чтобы файл хранилища не перерос гейт 800 строк.
declare module './sqliteCandidateStore' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SqliteCandidateStore extends ApplicationContactMethods {}
}
