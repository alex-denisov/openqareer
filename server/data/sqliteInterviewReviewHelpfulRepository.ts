import type { DatabaseSync } from 'node:sqlite';

export interface InterviewReviewHelpfulKey {
  readonly candidateId: string;
  readonly sessionId: string;
  readonly questionId: string;
}

/** B681: «разбор помог» по вопросу тренировки, одна строка на кандидата, тренировку и вопрос. */
export class SqliteInterviewReviewHelpfulRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(key: InterviewReviewHelpfulKey): boolean | null {
    const row = this.database
      .prepare(
        `SELECT helpful FROM candidate_interview_review_helpful
         WHERE candidate_id = ? AND session_id = ? AND question_id = ?`,
      )
      .get(key.candidateId, key.sessionId, key.questionId) as { helpful: number } | undefined;
    return row ? row.helpful === 1 : null;
  }

  set(key: InterviewReviewHelpfulKey, helpful: boolean, now: string): boolean {
    this.database
      .prepare(
        `INSERT INTO candidate_interview_review_helpful
          (candidate_id, session_id, question_id, helpful, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, session_id, question_id)
         DO UPDATE SET helpful = excluded.helpful, updated_at = excluded.updated_at`,
      )
      .run(key.candidateId, key.sessionId, key.questionId, helpful ? 1 : 0, now);
    return helpful;
  }
}
