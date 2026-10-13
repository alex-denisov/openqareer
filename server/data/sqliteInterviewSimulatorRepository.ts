import type { DatabaseSync } from 'node:sqlite';
import type { InterviewSession } from '../domain/interviewSimulator';
import type { SealedText } from './sealedText';
import { interviewSessionAssociatedData } from './interviewSimulatorSchema';

interface InterviewSessionRow {
  readonly candidate_id: string;
  readonly id: string;
  readonly body_cipher: string;
  readonly status: InterviewSession['status'];
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export class SqliteInterviewSimulatorRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  getCurrent(candidateId: string): InterviewSession | null {
    const row = this.database
      .prepare(
        `SELECT candidate_id, id, body_cipher, status, version, created_at, updated_at
         FROM candidate_interview_sessions WHERE candidate_id = ?`,
      )
      .get(candidateId) as unknown as InterviewSessionRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  get(candidateId: string, id: string): InterviewSession | null {
    const row = this.database
      .prepare(
        `SELECT candidate_id, id, body_cipher, status, version, created_at, updated_at
         FROM candidate_interview_sessions WHERE candidate_id = ? AND id = ?`,
      )
      .get(candidateId, id) as unknown as InterviewSessionRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  create(candidateId: string, session: InterviewSession, now: string): InterviewSession | null {
    const result = this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions
          (candidate_id, id, body_cipher, status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO NOTHING`,
      )
      .run(
        candidateId,
        session.id,
        this.seal(candidateId, session),
        session.status,
        session.version,
        now,
        now,
      );
    return result.changes === 1 ? this.get(candidateId, session.id) : null;
  }

  update(
    candidateId: string,
    id: string,
    expectedVersion: number,
    session: InterviewSession,
    now: string,
  ): InterviewSession | null {
    const next = { ...session, version: expectedVersion + 1, updatedAt: now };
    const result = this.database
      .prepare(
        `UPDATE candidate_interview_sessions
         SET body_cipher = ?, status = ?, version = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ? AND version = ?`,
      )
      .run(
        this.seal(candidateId, next),
        next.status,
        next.version,
        now,
        candidateId,
        id,
        expectedVersion,
      );
    return result.changes === 1 ? this.get(candidateId, id) : null;
  }

  replaceCompleted(
    candidateId: string,
    currentId: string,
    expectedVersion: number,
    session: InterviewSession,
    now: string,
  ): InterviewSession | null {
    const next = { ...session, version: 1, updatedAt: now };
    const result = this.database
      .prepare(
        `UPDATE candidate_interview_sessions
         SET id = ?, body_cipher = ?, status = ?, version = 1, created_at = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ? AND version = ?
           AND status IN ('completed', 'interrupted')`,
      )
      .run(
        next.id,
        this.seal(candidateId, next),
        next.status,
        now,
        now,
        candidateId,
        currentId,
        expectedVersion,
      );
    return result.changes === 1 ? this.get(candidateId, next.id) : null;
  }

  private seal(candidateId: string, session: InterviewSession): string {
    const associatedData = interviewSessionAssociatedData(
      candidateId,
      session.id,
      session.version,
      session.status,
    );
    return this.sealedText.seal(JSON.stringify(session), associatedData);
  }

  private fromRow(row: InterviewSessionRow): InterviewSession {
    const associatedData = interviewSessionAssociatedData(
      row.candidate_id,
      row.id,
      row.version,
      row.status,
    );
    const session = JSON.parse(this.sealedText.open(row.body_cipher, associatedData)) as InterviewSession;
    if (session.id !== row.id || session.version !== row.version || session.status !== row.status) {
      throw new Error('interview_session_storage_invalid');
    }
    return session;
  }
}
