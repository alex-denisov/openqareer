import type { DatabaseSync } from 'node:sqlite';
import type { CoachTurnStage, CoachTurnSubject } from '../../domain/coach';
import type { MessageRow } from './shared';

export interface StoredTurnStage {
  stage: CoachTurnStage;
  subject_kind: CoachTurnSubject['kind'] | null;
  subject_id: string | null;
  is_service: number;
}

export class StageMessageStore {
  constructor(private readonly database: DatabaseSync) {}

  insertMessageStage(
    messageId: string,
    candidateId: string,
    stage: CoachTurnStage,
    subjectKind?: string | null,
    subjectId?: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO message_stages (message_id, candidate_id, stage, subject_kind, subject_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (message_id) DO UPDATE SET
           stage = excluded.stage,
           subject_kind = excluded.subject_kind,
           subject_id = excluded.subject_id`,
      )
      .run(messageId, candidateId, stage, subjectKind ?? null, subjectId ?? null);
  }

  recordTurnStage(
    candidateId: string,
    idempotencyKey: string,
    stage: CoachTurnStage,
    subject?: CoachTurnSubject | null,
    isService = false,
  ): void {
    this.database
      .prepare(
        `INSERT INTO turn_stages (candidate_id, idempotency_key, stage, subject_kind, subject_id, is_service)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (candidate_id, idempotency_key) DO UPDATE SET
           stage = excluded.stage,
           subject_kind = excluded.subject_kind,
           subject_id = excluded.subject_id,
           is_service = excluded.is_service`,
      )
      .run(
        candidateId,
        idempotencyKey,
        stage,
        subject?.kind ?? null,
        subject?.id ?? null,
        isService ? 1 : 0,
      );
  }

  getTurnStage(candidateId: string, idempotencyKey: string): StoredTurnStage | null {
    const row = this.database
      .prepare(
        `SELECT stage, subject_kind, subject_id, is_service
         FROM turn_stages
         WHERE candidate_id = ? AND idempotency_key = ?`,
      )
      .get(candidateId, idempotencyKey) as StoredTurnStage | undefined;
    return row ?? null;
  }

  queryMessages(candidateId: string, stage?: CoachTurnStage): MessageRow[] {
    if (!stage) {
      return this.database
        .prepare('SELECT id, role, body_cipher, created_at FROM messages WHERE candidate_id = ? ORDER BY created_at, id')
        .all(candidateId) as unknown as MessageRow[];
    }
    if (stage === 'today') {
      return this.database
        .prepare(
          `SELECT m.id, m.role, m.body_cipher, m.created_at
           FROM messages m
           LEFT JOIN message_stages ms ON ms.message_id = m.id AND ms.candidate_id = m.candidate_id
           WHERE m.candidate_id = ? AND (ms.stage = 'today' OR ms.stage IS NULL)
           ORDER BY m.created_at, m.id`,
        )
        .all(candidateId) as unknown as MessageRow[];
    }
    return this.database
      .prepare(
        `SELECT m.id, m.role, m.body_cipher, m.created_at
         FROM messages m
         INNER JOIN message_stages ms ON ms.message_id = m.id AND ms.candidate_id = m.candidate_id
         WHERE m.candidate_id = ? AND ms.stage = ?
         ORDER BY m.created_at, m.id`,
      )
      .all(candidateId, stage) as unknown as MessageRow[];
  }
}
