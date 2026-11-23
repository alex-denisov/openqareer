import type { DatabaseSync } from 'node:sqlite';

/**
 * B666 · p08 и s01: «Фото в резюме». Отдельная таблица, а не поле профиля:
 * замена профиля импортом не должна снова включать фото, которое кандидат убрал
 * из резюме. Нет строки — фото в резюме включено.
 */
export const CANDIDATE_RESUME_PHOTO_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_resume_photo (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  in_resume INTEGER NOT NULL CHECK (in_resume IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;
`;

export class SqliteResumePhotoRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(CANDIDATE_RESUME_PHOTO_SCHEMA);
  }

  inResume(candidateId: string): boolean {
    const row = this.database
      .prepare('SELECT in_resume FROM candidate_resume_photo WHERE candidate_id = ?')
      .get(candidateId) as { in_resume: number } | undefined;
    return row ? row.in_resume === 1 : true;
  }

  setInResume(candidateId: string, inResume: boolean, now: string): boolean {
    this.database
      .prepare(
        `INSERT INTO candidate_resume_photo (candidate_id, in_resume, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(candidate_id)
         DO UPDATE SET in_resume = excluded.in_resume, updated_at = excluded.updated_at`,
      )
      .run(candidateId, inResume ? 1 : 0, now);
    return inResume;
  }
}
