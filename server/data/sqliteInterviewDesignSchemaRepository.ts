import type { DatabaseSync } from 'node:sqlite';
import type { SystemDesignSchema } from '../domain/systemDesignSchema';
import { interviewDesignSchemaAssociatedData } from './interviewDesignSchemaSchema';
import type { InterviewReviewHelpfulKey } from './sqliteInterviewReviewHelpfulRepository';
import type { SealedText } from './sealedText';

export type InterviewDesignSchemaKey = InterviewReviewHelpfulKey;

/** B647: исправленная схема System Design, одна строка на кандидата, тренировку и вопрос. */
export class SqliteInterviewDesignSchemaRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  get(key: InterviewDesignSchemaKey): SystemDesignSchema | null {
    const row = this.database
      .prepare(
        `SELECT body_cipher FROM candidate_interview_design_schemas
         WHERE candidate_id = ? AND session_id = ? AND question_id = ?`,
      )
      .get(key.candidateId, key.sessionId, key.questionId) as { body_cipher: string } | undefined;
    if (!row) return null;
    return JSON.parse(this.sealedText.open(row.body_cipher, associatedData(key))) as SystemDesignSchema;
  }

  set(key: InterviewDesignSchemaKey, schema: SystemDesignSchema, now: string): SystemDesignSchema {
    this.database
      .prepare(
        `INSERT INTO candidate_interview_design_schemas
          (candidate_id, session_id, question_id, body_cipher, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, session_id, question_id)
         DO UPDATE SET body_cipher = excluded.body_cipher, updated_at = excluded.updated_at`,
      )
      .run(
        key.candidateId,
        key.sessionId,
        key.questionId,
        this.sealedText.seal(JSON.stringify(schema), associatedData(key)),
        now,
      );
    return schema;
  }
}

function associatedData(key: InterviewDesignSchemaKey): string {
  return interviewDesignSchemaAssociatedData(key.candidateId, key.sessionId, key.questionId);
}
