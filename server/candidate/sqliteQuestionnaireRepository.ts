import { withoutTitleQuestions } from '../domain/manualApplyQuestions';
import { DatabaseSync } from 'node:sqlite';
import type {
  QuestionnaireAnswer,
  QuestionnaireQuestion,
} from '../../shared/applicationQuestionnaire';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * B641: анкета работодателя по вакансии кандидата. Только новая таблица; пустая до первой
 * открытой анкеты. Вопросы — открытый текст площадки, ответы кандидата хранятся запечатанными.
 */
export const QUESTIONNAIRE_SCHEMA = `
CREATE TABLE IF NOT EXISTS application_questionnaires (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL,
  form_url TEXT,
  questions_json TEXT NOT NULL,
  answers_cipher TEXT,
  read_at TEXT NOT NULL,
  submitted_at TEXT,
  PRIMARY KEY (candidate_id, vacancy_id)
) STRICT;
`;

/** Анкет на кандидата: вакансии клиент называет сам, поэтому число строк ограничено. */
export const QUESTIONNAIRE_MAX_PER_CANDIDATE = 200;

export interface StoredQuestionnaire {
  readonly vacancyId: string;
  readonly formUrl: string | null;
  readonly questions: readonly QuestionnaireQuestion[];
  readonly answers: readonly QuestionnaireAnswer[];
  readonly readAt: string;
  readonly submittedAt: string | null;
}

interface Row {
  vacancy_id: string;
  form_url: string | null;
  questions_json: string;
  answers_cipher: string | null;
  read_at: string;
  submitted_at: string | null;
}

export class SqliteQuestionnaireRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  constructor(
    options: DatabaseSync | { databasePath: string; encryptionKey: Buffer },
    key?: Buffer,
  ) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database =
      options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('questionnaire_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    if (this.ownsDatabase) this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(QUESTIONNAIRE_SCHEMA);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private scope(candidateId: string, vacancyId: string): string {
    return `questionnaire:${candidateId}:${vacancyId}`;
  }

  /** Повреждённые ответы не роняют анкету: вопросы остаются, ответы пустые. */
  private openAnswers(candidateId: string, row: Row): readonly QuestionnaireAnswer[] {
    if (!row.answers_cipher) return [];
    try {
      const parsed: unknown = JSON.parse(
        this.sealedText.open(row.answers_cipher, this.scope(candidateId, row.vacancy_id)),
      );
      return Array.isArray(parsed) ? (parsed as QuestionnaireAnswer[]) : [];
    } catch {
      return [];
    }
  }

  /** B738: все анкеты кандидата с ответами — для выгрузки данных. */
  exportAll(candidateId: string): StoredQuestionnaire[] {
    const rows = this.database
      .prepare(
        `SELECT vacancy_id, form_url, questions_json, answers_cipher, read_at, submitted_at
         FROM application_questionnaires WHERE candidate_id = ? ORDER BY read_at, vacancy_id`,
      )
      .all(candidateId) as unknown as Row[];
    return rows.map((row) => this.toStored(candidateId, row));
  }

  get(candidateId: string, vacancyId: string): StoredQuestionnaire | null {
    const row = this.database
      .prepare(
        `SELECT vacancy_id, form_url, questions_json, answers_cipher, read_at, submitted_at
         FROM application_questionnaires WHERE candidate_id = ? AND vacancy_id = ?`,
      )
      .get(candidateId, vacancyId) as unknown as Row | undefined;
    return row ? this.toStored(candidateId, row) : null;
  }

  private toStored(candidateId: string, row: Row): StoredQuestionnaire {
    return {
      vacancyId: row.vacancy_id,
      formUrl: row.form_url,
      questions: withoutTitleQuestions(JSON.parse(row.questions_json) as QuestionnaireQuestion[]),
      answers: this.openAnswers(candidateId, row),
      readAt: row.read_at,
      submittedAt: row.submitted_at,
    };
  }

  /** Первое чтение вопросов; повторное не затирает ответы кандидата. */
  saveQuestions(
    candidateId: string,
    vacancyId: string,
    input: {
      readonly questions: readonly QuestionnaireQuestion[];
      readonly formUrl: string | null;
      readonly readAt: string;
    },
  ): void {
    this.makeRoom(candidateId, vacancyId);
    this.database
      .prepare(
        `INSERT INTO application_questionnaires
           (candidate_id, vacancy_id, form_url, questions_json, read_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, vacancy_id) DO UPDATE SET
           form_url = excluded.form_url, questions_json = excluded.questions_json,
           read_at = excluded.read_at`,
      )
      .run(candidateId, vacancyId, input.formUrl, JSON.stringify(input.questions), input.readAt);
  }

  /**
   * Новая анкета при полном лимите вытесняет старые: сначала без ответов, потом самые давние.
   * Анкета с ответами кандидата уходит последней.
   */
  private makeRoom(candidateId: string, vacancyId: string): void {
    if (this.get(candidateId, vacancyId)) return;
    const row = this.database
      .prepare('SELECT COUNT(*) AS n FROM application_questionnaires WHERE candidate_id = ?')
      .get(candidateId) as unknown as { n: number };
    const surplus = Number(row.n) - (QUESTIONNAIRE_MAX_PER_CANDIDATE - 1);
    if (surplus <= 0) return;
    this.database
      .prepare(
        `DELETE FROM application_questionnaires WHERE candidate_id = ? AND vacancy_id IN (
           SELECT vacancy_id FROM application_questionnaires WHERE candidate_id = ?
           ORDER BY (answers_cipher IS NOT NULL), (submitted_at IS NOT NULL), read_at, vacancy_id
           LIMIT ?)`,
      )
      .run(candidateId, candidateId, surplus);
  }

  /** false — анкеты у кандидата по этой вакансии нет. */
  saveAnswers(
    candidateId: string,
    vacancyId: string,
    answers: readonly QuestionnaireAnswer[],
  ): boolean {
    const cipher =
      answers.length > 0
        ? this.sealedText.seal(JSON.stringify(answers), this.scope(candidateId, vacancyId))
        : null;
    const result = this.database
      .prepare(
        `UPDATE application_questionnaires SET answers_cipher = ?
         WHERE candidate_id = ? AND vacancy_id = ?`,
      )
      .run(cipher, candidateId, vacancyId);
    return Number(result.changes) > 0;
  }

  markSubmitted(candidateId: string, vacancyId: string, at: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE application_questionnaires SET submitted_at = ?
         WHERE candidate_id = ? AND vacancy_id = ?`,
      )
      .run(at, candidateId, vacancyId);
    return Number(result.changes) > 0;
  }
}
