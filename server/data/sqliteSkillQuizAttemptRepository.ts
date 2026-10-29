import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  SKILL_QUIZ_LEVELS,
  type GeneratedQuestion,
  type GeneratedQuizResult,
  type SkillQuizLevel,
} from '../domain/generatedSkillQuiz';
import type { SealedText } from './sealedText';

/**
 * Попытки квиза по навыку профиля (блок A, пакет 3). Вопросы с ответами
 * зашифрованы и не покидают сервер до сдачи. Новая маленькая таблица:
 * CREATE TABLE IF NOT EXISTS, без ALTER (окно проверки выката — 20 с).
 */
export const SKILL_QUIZ_ATTEMPT_SCHEMA = `
CREATE TABLE IF NOT EXISTS skill_quiz_attempts (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  skill_key TEXT NOT NULL,
  attempt_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  PRIMARY KEY (candidate_id, attempt_id)
);
CREATE INDEX IF NOT EXISTS skill_quiz_attempts_by_skill
  ON skill_quiz_attempts (candidate_id, skill_key, created_at);
`;

export interface SkillQuizAttempt {
  readonly id: string;
  readonly skillName: string;
  readonly skillKey: string;
  readonly level: SkillQuizLevel;
  readonly questions: readonly GeneratedQuestion[];
  readonly createdAt: string;
  readonly submittedAt: string | null;
  readonly result: GeneratedQuizResult | null;
  /** Команда, которой результат записан в профиль после «Принять результат». */
  readonly appliedCommandId: string | null;
}

const attemptSchema = z
  .object({
    id: z.string().min(1),
    skillName: z.string().min(1),
    skillKey: z.string().min(1),
    level: z.enum(SKILL_QUIZ_LEVELS),
    questions: z.array(z.any()),
    createdAt: z.string(),
    submittedAt: z.string().nullable(),
    result: z.any().nullable(),
    appliedCommandId: z.string().nullable(),
  })
  .passthrough();

interface AttemptRow {
  attempt_id: string;
  attempt_cipher: string;
}

export interface SkillQuizAttemptRepository {
  create(candidateId: string, attempt: SkillQuizAttempt): void;
  get(candidateId: string, attemptId: string): SkillQuizAttempt | null;
  /** Попытки навыка, начатые не раньше `since` — для лимита в сутки. */
  countSince(candidateId: string, skillKey: string, since: string): number;
  /** Записывает результат один раз: повторная сдача той же попытки не проходит. */
  submit(candidateId: string, attempt: SkillQuizAttempt): boolean;
  markApplied(candidateId: string, attempt: SkillQuizAttempt): void;
  list(candidateId: string): SkillQuizAttempt[];
}

export class SqliteSkillQuizAttemptRepository implements SkillQuizAttemptRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(SKILL_QUIZ_ATTEMPT_SCHEMA);
  }

  create(candidateId: string, attempt: SkillQuizAttempt): void {
    this.database
      .prepare(
        `INSERT INTO skill_quiz_attempts
          (candidate_id, attempt_id, skill_key, attempt_cipher, created_at, submitted_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        candidateId,
        attempt.id,
        attempt.skillKey,
        this.seal(candidateId, attempt),
        attempt.createdAt,
      );
  }

  get(candidateId: string, attemptId: string): SkillQuizAttempt | null {
    const row = this.database
      .prepare(
        `SELECT attempt_id, attempt_cipher FROM skill_quiz_attempts
         WHERE candidate_id = ? AND attempt_id = ?`,
      )
      .get(candidateId, attemptId) as AttemptRow | undefined;
    return row ? this.fromRow(candidateId, row) : null;
  }

  countSince(candidateId: string, skillKey: string, since: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM skill_quiz_attempts
         WHERE candidate_id = ? AND skill_key = ? AND created_at >= ?`,
      )
      .get(candidateId, skillKey, since) as { count: number };
    return row.count;
  }

  submit(candidateId: string, attempt: SkillQuizAttempt): boolean {
    if (!attempt.submittedAt || !attempt.result) throw new Error('skill_quiz_attempt_not_submitted');
    const result = this.database
      .prepare(
        `UPDATE skill_quiz_attempts SET attempt_cipher = ?, submitted_at = ?
         WHERE candidate_id = ? AND attempt_id = ? AND submitted_at IS NULL`,
      )
      .run(this.seal(candidateId, attempt), attempt.submittedAt, candidateId, attempt.id);
    return result.changes === 1;
  }

  markApplied(candidateId: string, attempt: SkillQuizAttempt): void {
    this.database
      .prepare(
        `UPDATE skill_quiz_attempts SET attempt_cipher = ?
         WHERE candidate_id = ? AND attempt_id = ?`,
      )
      .run(this.seal(candidateId, attempt), candidateId, attempt.id);
  }

  list(candidateId: string): SkillQuizAttempt[] {
    const rows = this.database
      .prepare(
        `SELECT attempt_id, attempt_cipher FROM skill_quiz_attempts
         WHERE candidate_id = ? ORDER BY created_at DESC, attempt_id`,
      )
      .all(candidateId) as unknown as AttemptRow[];
    return rows.map((row) => this.fromRow(candidateId, row));
  }

  private fromRow(candidateId: string, row: AttemptRow): SkillQuizAttempt {
    const attempt = attemptSchema.parse(
      JSON.parse(
        this.sealedText.open(row.attempt_cipher, associatedData(candidateId, row.attempt_id)),
      ) as unknown,
    ) as unknown as SkillQuizAttempt;
    if (attempt.id !== row.attempt_id) throw new Error('skill_quiz_attempt_record_mismatch');
    return attempt;
  }

  private seal(candidateId: string, attempt: SkillQuizAttempt): string {
    return this.sealedText.seal(JSON.stringify(attempt), associatedData(candidateId, attempt.id));
  }
}

function associatedData(candidateId: string, attemptId: string): string {
  return `candidate:${candidateId}:skill-quiz-attempt:${attemptId}`;
}
