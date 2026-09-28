import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { StoredMemory } from './candidateStore';
import { CandidateNotFoundError, CandidateStoreConflictError } from './store/errors';
import { memoryAssociatedData, messageAssociatedData, type MemoryRow } from './store/shared';
import type { SealedText } from './sealedText';

/** Writes the candidate-authored source message and confirmed memory in the caller's transaction. */
export class SqliteManualExperienceFactRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  add(candidateId: string, memoryId: string, statement: string): StoredMemory {
    const clean = statement.trim();
    if (!clean) throw new CandidateStoreConflictError();
    const existing = this.find(candidateId, memoryId);
    if (existing) {
      if (existing.statement !== clean) throw new CandidateStoreConflictError();
      return existing;
    }
    const conversationId = this.conversationId(candidateId);
    const messageId = randomUUID();
    const now = new Date().toISOString();
    this.insertSourceMessage(candidateId, conversationId, messageId, clean, now);
    this.insertMemory(candidateId, conversationId, memoryId, messageId, clean, now);
    this.touchConversation(conversationId, now);
    return this.record(memoryId, messageId, clean, now);
  }

  private find(candidateId: string, memoryId: string): StoredMemory | null {
    const row = this.database
      .prepare(
        `SELECT id, kind, domain, statement_cipher, confidence, source_message_ids,
                sensitive, status, created_at, updated_at
         FROM memory WHERE id = ? AND candidate_id = ?`,
      )
      .get(memoryId, candidateId) as MemoryRow | undefined;
    if (!row) {
      const elsewhere = this.database.prepare('SELECT id FROM memory WHERE id = ?').get(memoryId);
      if (elsewhere) throw new CandidateStoreConflictError();
      return null;
    }
    if (row.status === 'deleted') throw new CandidateStoreConflictError();
    return {
      id: row.id,
      kind: row.kind,
      domain: row.domain,
      statement: this.sealedText.open(row.statement_cipher, memoryAssociatedData(candidateId, row.id)),
      confidence: row.confidence,
      sourceMessageIds: JSON.parse(row.source_message_ids) as string[],
      sensitive: row.sensitive === 1,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private conversationId(candidateId: string): string {
    const row = this.database
      .prepare('SELECT id FROM conversations WHERE candidate_id = ?')
      .get(candidateId) as { id: string } | undefined;
    if (!row) throw new CandidateNotFoundError();
    return row.id;
  }

  private insertSourceMessage(
    candidateId: string,
    conversationId: string,
    messageId: string,
    statement: string,
    now: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO messages (id, candidate_id, conversation_id, role, body_cipher, created_at)
         VALUES (?, ?, ?, 'user', ?, ?)`,
      )
      .run(
        messageId,
        candidateId,
        conversationId,
        this.sealedText.seal(statement, messageAssociatedData(candidateId, messageId)),
        now,
      );
  }

  private insertMemory(
    candidateId: string,
    conversationId: string,
    memoryId: string,
    messageId: string,
    statement: string,
    now: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO memory
          (id, candidate_id, conversation_id, kind, domain, statement_cipher,
           confidence, source_message_ids, sensitive, status, created_at, updated_at)
         VALUES (?, ?, ?, 'fact', 'responsibility', ?, 'candidate-confirmed', ?, 0, 'confirmed', ?, ?)`,
      )
      .run(
        memoryId,
        candidateId,
        conversationId,
        this.sealedText.seal(statement, memoryAssociatedData(candidateId, memoryId)),
        JSON.stringify([messageId]),
        now,
        now,
      );
  }

  private touchConversation(conversationId: string, now: string): void {
    this.database
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(now, conversationId);
  }

  private record(memoryId: string, messageId: string, statement: string, now: string): StoredMemory {
    return {
      id: memoryId,
      kind: 'fact',
      domain: 'responsibility',
      statement,
      confidence: 'candidate-confirmed',
      sourceMessageIds: [messageId],
      sensitive: false,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    };
  }
}
