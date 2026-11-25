import type { DatabaseSync } from 'node:sqlite';
import type { SystemDesignTask } from '../domain/systemDesignTask';
import { interviewDesignTaskAssociatedData } from './interviewDesignTaskSchema';
import type { SealedText } from './sealedText';

export interface InterviewDesignTaskKey {
  readonly candidateId: string;
  readonly applicationId: string;
}

/** B750: задача System Design по отклику; первая записанная остаётся, пока подходит роли (B635). */
export class SqliteInterviewDesignTaskRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  get(key: InterviewDesignTaskKey): SystemDesignTask | null {
    const row = this.database
      .prepare(
        `SELECT body_cipher FROM candidate_interview_design_tasks
         WHERE candidate_id = ? AND application_id = ?`,
      )
      .get(key.candidateId, key.applicationId) as { body_cipher: string } | undefined;
    if (!row) return null;
    const body = this.sealedText.open(row.body_cipher, associatedData(key));
    return JSON.parse(body) as SystemDesignTask;
  }

  /** Уже есть — возвращает прежнюю: два одновременных открытия получат одну задачу. */
  keep(key: InterviewDesignTaskKey, task: SystemDesignTask, now: string): SystemDesignTask {
    this.database
      .prepare(
        `INSERT INTO candidate_interview_design_tasks
          (candidate_id, application_id, body_cipher, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id, application_id) DO NOTHING`,
      )
      .run(
        key.candidateId,
        key.applicationId,
        this.sealedText.seal(JSON.stringify(task), associatedData(key)),
        now,
      );
    return this.get(key) ?? task;
  }

  /** B635: задача другого вида, на которую не отвечали, заменяется; гонку решает прежний текст. */
  replace(
    key: InterviewDesignTaskKey,
    previous: SystemDesignTask,
    task: SystemDesignTask,
  ): SystemDesignTask {
    const row = this.database
      .prepare(
        `SELECT body_cipher FROM candidate_interview_design_tasks
         WHERE candidate_id = ? AND application_id = ?`,
      )
      .get(key.candidateId, key.applicationId) as { body_cipher: string } | undefined;
    const body = row && this.sealedText.open(row.body_cipher, associatedData(key));
    if (row && body === JSON.stringify(previous)) {
      this.database
        .prepare(
          `UPDATE candidate_interview_design_tasks SET body_cipher = ?
           WHERE candidate_id = ? AND application_id = ? AND body_cipher = ?`,
        )
        .run(
          this.sealedText.seal(JSON.stringify(task), associatedData(key)),
          key.candidateId,
          key.applicationId,
          row.body_cipher,
        );
    }
    return this.get(key) ?? task;
  }

  listKeys(candidateId: string): ReadonlyArray<{ applicationId: string; createdAt: string }> {
    const rows = this.database
      .prepare(
        `SELECT application_id, created_at FROM candidate_interview_design_tasks
         WHERE candidate_id = ? ORDER BY application_id`,
      )
      .all(candidateId) as Array<{ application_id: string; created_at: string }>;
    return rows.map((row) => ({ applicationId: row.application_id, createdAt: row.created_at }));
  }
}

function associatedData(key: InterviewDesignTaskKey): string {
  return interviewDesignTaskAssociatedData(key.candidateId, key.applicationId);
}
