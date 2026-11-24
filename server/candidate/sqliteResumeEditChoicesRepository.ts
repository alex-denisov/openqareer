import { DatabaseSync } from 'node:sqlite';
import { NO_EDIT_CHOICES, type ResumeEditChoices } from '../../shared/resumeVacancyEdits';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/** B785: решения кандидата по правкам резюме под вакансию. Новая таблица; тексты запечатаны. */
export const RESUME_EDIT_CHOICES_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_resume_edit_choices (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL,
  choices_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, vacancy_id)
) STRICT;
`;

const scopeOf = (candidateId: string, vacancyId: string) =>
  `resume-edit-choices:${candidateId}:${vacancyId}`;

export class SqliteResumeEditChoicesRepository {
  private readonly database: DatabaseSync;
  private readonly sealed: SealedText;

  constructor(database: DatabaseSync, encryptionKey: Buffer) {
    this.database = database;
    this.sealed = new SealedText(encryptionKey);
    applySqliteBusyTimeout(database);
    database.exec(RESUME_EDIT_CHOICES_SCHEMA);
  }

  read(candidateId: string, vacancyId: string): ResumeEditChoices {
    const row = this.database
      .prepare(
        'SELECT choices_cipher FROM candidate_resume_edit_choices WHERE candidate_id = ? AND vacancy_id = ?',
      )
      .get(candidateId, vacancyId) as { choices_cipher: string } | undefined;
    if (!row) return NO_EDIT_CHOICES;
    return JSON.parse(
      this.sealed.open(row.choices_cipher, scopeOf(candidateId, vacancyId)),
    ) as ResumeEditChoices;
  }

  save(candidateId: string, vacancyId: string, choices: ResumeEditChoices, now: string): void {
    this.database
      .prepare(
        `INSERT INTO candidate_resume_edit_choices (candidate_id, vacancy_id, choices_cipher, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id, vacancy_id)
         DO UPDATE SET choices_cipher = excluded.choices_cipher, updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        vacancyId,
        this.sealed.seal(JSON.stringify(choices), scopeOf(candidateId, vacancyId)),
        now,
      );
  }

  list(candidateId: string): ReadonlyArray<{ vacancyId: string; choices: ResumeEditChoices }> {
    const rows = this.database
      .prepare(
        'SELECT vacancy_id FROM candidate_resume_edit_choices WHERE candidate_id = ? ORDER BY vacancy_id',
      )
      .all(candidateId) as Array<{ vacancy_id: string }>;
    return rows.map((row) => ({
      vacancyId: row.vacancy_id,
      choices: this.read(candidateId, row.vacancy_id),
    }));
  }
}
