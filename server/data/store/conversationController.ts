import { createHash, randomUUID } from 'node:crypto';
import {
  coachTurnResultSchema,
  type CoachMessage,
  type CoachTurnInput,
  type CoachTurnResult,
} from '../../domain/coach';
import { buildExperienceDossier } from '../../domain/dossier';
import { isImportedMemoryId } from '../../domain/resumeImport';
import type { CoachProviderResult } from '../../providers/coachProvider';
import type {
  CandidateIdentity,
  ImportedResumeEvidence,
  MemoryChange,
  ResumeEvidenceImport,
  StartedTurn,
  StoredMemory,
  StoredTurn,
  TurnRequest,
} from '../candidateStore';
import type { SqliteDocumentRepository } from '../sqliteDocumentRepository';
import type { SealedText } from '../sealedText';
import type { DatabaseSync } from 'node:sqlite';
import {
  memoryAssociatedData,
  messageAssociatedData,
  turnAssociatedData,
  turnRequestDigest,
  type MemoryRow,
  type MessageRow,
  type StoreContext,
  type TurnRow,
} from './shared';
import {
  CandidateNotFoundError,
  CandidateStoreConflictError,
} from './errors';

export interface ConversationDeps extends StoreContext {
  documentRepository: SqliteDocumentRepository;
}

/**
 * Owns the conversation aggregate: turns, messages and memory. All methods
 * expect the caller to have verified candidate existence already.
 */
export class ConversationController {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;
  private readonly documentRepository: SqliteDocumentRepository;

  constructor(deps: ConversationDeps) {
    this.database = deps.database;
    this.sealedText = deps.sealedText;
    this.documentRepository = deps.documentRepository;
  }

  startTurn(
    candidate: CandidateIdentity,
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): StartedTurn {
    const existing = this.getTurn(candidateId, idempotencyKey);
    if (existing) {
      const storedMessage = this.getMessage(candidateId, existing.user_message_id);
      if (
        !storedMessage ||
        storedMessage.id !== request.messageId ||
        storedMessage.content !== request.content ||
        (existing.request_digest === null
          ? request.marketQuery !== undefined
          : existing.request_digest !== turnRequestDigest(request))
      ) {
        throw new CandidateStoreConflictError();
      }
      if (existing.status === 'completed') {
        return {
          state: 'completed',
          output: this.outputFromTurn(candidateId, idempotencyKey, existing),
        };
      }
      this.database
        .prepare(
          `UPDATE turns
           SET status = 'pending', last_error = NULL, updated_at = ?
           WHERE candidate_id = ? AND idempotency_key = ?`,
        )
        .run(new Date().toISOString(), candidateId, idempotencyKey);
    } else {
      if (this.getMessage(candidateId, request.messageId)) {
        throw new CandidateStoreConflictError();
      }
      this.insertPendingTurn(candidateId, idempotencyKey, request);
    }

    return {
      state: 'ready',
      input: {
        candidateReference: candidate.id,
        dataClass: candidate.dataClass,
        locale: candidate.locale,
        phase: request.phase,
        messages: this.messages(candidateId).slice(-30),
        knowledgeContext: this.knowledgeContext(candidateId),
      },
    };
  }

  completeTurn(
    candidateId: string,
    idempotencyKey: string,
    output: CoachProviderResult,
  ): void {
    const turn = this.getTurn(candidateId, idempotencyKey);
    if (!turn || turn.status !== 'pending') {
      throw new CandidateStoreConflictError();
    }
    const conversationId = this.conversationId(candidateId);
    const assistantMessageId = randomUUID();
    const now = new Date().toISOString();
    this.inTransaction(() => {
      this.insertMessage(
        candidateId,
        conversationId,
        assistantMessageId,
        'assistant',
        output.result.message,
        now,
      );
      this.insertMemoryCandidates(
        candidateId,
        conversationId,
        output.result.memoryCandidates,
        now,
      );
      this.markTurnCompleted(candidateId, idempotencyKey, assistantMessageId, output);
      this.touchConversation(conversationId, now);
    });
  }

  private insertMemoryCandidates(
    candidateId: string,
    conversationId: string,
    candidates: CoachProviderResult['result']['memoryCandidates'],
    now: string,
  ): void {
    for (const memory of candidates) {
      const memoryId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO memory
            (id, candidate_id, conversation_id, kind, domain, statement_cipher,
             confidence, source_message_ids, sensitive, status,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
        )
        .run(
          memoryId,
          candidateId,
          conversationId,
          memory.kind,
          memory.domain,
          this.sealedText.seal(
            memory.statement,
            memoryAssociatedData(candidateId, memoryId),
          ),
          memory.confidence,
          JSON.stringify(memory.sourceMessageIds),
          memory.sensitive ? 1 : 0,
          now,
          now,
        );
    }
  }

  private markTurnCompleted(
    candidateId: string,
    idempotencyKey: string,
    assistantMessageId: string,
    output: CoachProviderResult,
  ): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE turns SET
          assistant_message_id = ?, status = 'completed',
          result_cipher = ?, provider = ?, model = ?, response_id = ?,
          input_tokens = ?, output_tokens = ?, total_tokens = ?,
          updated_at = ?
         WHERE candidate_id = ? AND idempotency_key = ?`,
      )
      .run(
        assistantMessageId,
        this.sealedText.seal(
          JSON.stringify(output.result),
          turnAssociatedData(candidateId, idempotencyKey),
        ),
        output.provider,
        output.model,
        output.responseId,
        output.usage.inputTokens,
        output.usage.outputTokens,
        output.usage.totalTokens,
        now,
        candidateId,
        idempotencyKey,
      );
  }

  failTurn(
    candidateId: string,
    idempotencyKey: string,
    errorCode: string,
  ): void {
    this.database
      .prepare(
        `UPDATE turns SET status = 'failed', last_error = ?, updated_at = ?
         WHERE candidate_id = ? AND idempotency_key = ? AND status = 'pending'`,
      )
      .run(errorCode, new Date().toISOString(), candidateId, idempotencyKey);
  }

  importResumeEvidence(
    candidateId: string,
    input: ResumeEvidenceImport,
  ): ImportedResumeEvidence {
    return this.inTransaction(() =>
      this.importResumeEvidenceInTransaction(candidateId, input),
    );
  }

  importResumeEvidenceInTransaction(
    candidateId: string,
    input: ResumeEvidenceImport,
  ): ImportedResumeEvidence {
    const conversationId = this.conversationId(candidateId);
    // A digest ties the announcement message to its document: reimporting the
    // exact same document reuses the same message id, so the history gets one
    // update instead of a fresh "Импорт: ..." line every retry (B247 S6). No
    // digest (older callers) keeps the previous always-insert behaviour.
    const messageId = input.sourceDigest
      ? `resume-import:${input.sourceDigest}`
      : randomUUID();
    const now = new Date().toISOString();
    const memoryIds: string[] = [];
    if (input.sourceDigest) this.clearUnreviewedFactsOf(candidateId, messageId);
    this.insertMessage(
      candidateId,
      conversationId,
      messageId,
      'user',
      input.sourceLabel,
      now,
    );
    for (const entry of input.entries) {
      // An import is replayable: re-importing the same document must refresh
      // the fact, never leave two copies of it in the dossier.
      this.database
        .prepare('DELETE FROM memory WHERE id = ? AND candidate_id = ?')
        .run(entry.memoryId, candidateId);
      this.database
        .prepare(
          `INSERT INTO memory
            (id, candidate_id, conversation_id, kind, domain, statement_cipher,
             confidence, source_message_ids, sensitive, status,
             created_at, updated_at)
           VALUES (?, ?, ?, 'fact', ?, ?, 'candidate-reported', ?, 0, 'proposed', ?, ?)`,
        )
        .run(
          entry.memoryId,
          candidateId,
          conversationId,
          entry.domain,
          this.sealedText.seal(
            entry.statement,
            memoryAssociatedData(candidateId, entry.memoryId),
          ),
          JSON.stringify([messageId]),
          now,
          now,
        );
      memoryIds.push(entry.memoryId);
    }
    this.touchConversation(conversationId, now);
    return { messageId, memoryIds };
  }

  /**
   * Reusing the message id means the prior reading's untouched facts are
   * sourced from the very id a same-document reimport is about to reuse —
   * clear them before inserting the fresh ones, or the dossier doubles under
   * new ids (the failure mode B162 fixed for the file-replace path). Only
   * facts still awaiting review go: re-reading the very same document must
   * not undo a confirmation or correction the candidate already made.
   */
  private clearUnreviewedFactsOf(candidateId: string, messageId: string): void {
    this.database
      .prepare(
        `DELETE FROM memory
         WHERE candidate_id = ? AND status = 'proposed'
           AND source_message_ids = ?`,
      )
      .run(candidateId, JSON.stringify([messageId]));
  }

  /**
   * Removes only facts the candidate never touched — awaiting review or
   * confirmed as imported — whose sole source was the replaced snapshot. A
   * corrected or deleted fact carries a candidate decision and stays (B166).
   */
  purgeReplacedImportedFacts(
    candidateId: string,
    sourceMessageId: string,
    memoryIds: readonly string[],
  ): void {
    const soleSource = JSON.stringify([sourceMessageId]);
    const statement = this.database.prepare(
      `DELETE FROM memory
       WHERE candidate_id = ? AND id = ? AND status IN ('proposed', 'confirmed')
         AND source_message_ids = ?`,
    );
    for (const memoryId of memoryIds) {
      statement.run(candidateId, memoryId, soleSource);
    }
  }

  /**
   * A plain file upload mints a fresh id for every fact, so the previous
   * upload's facts stayed in the dossier and it doubled with every re-upload
   * (B162). The platform path already displaces its predecessor through the
   * receipt; this is the same rule for a document that arrives without one.
   *
   * Only untouched facts of an earlier **file** import go. A corrected or
   * deleted fact carries a candidate decision, and a fact a platform snapshot
   * owns belongs to that connection's receipt.
   */
  purgeSupersededFileImportFacts(
    candidateId: string,
    keptMessageId: string,
    connectionMessageIds: readonly string[],
  ): void {
    const protectedMessages = new Set([keptMessageId, ...connectionMessageIds]);
    const rows = this.database
      .prepare(
        `SELECT id, source_message_ids FROM memory
         WHERE candidate_id = ? AND status IN ('proposed', 'confirmed')`,
      )
      .all(candidateId) as { id: string; source_message_ids: string }[];
    const remove = this.database.prepare(
      'DELETE FROM memory WHERE candidate_id = ? AND id = ?',
    );
    for (const row of rows) {
      if (!isImportedMemoryId(row.id)) continue;
      const sources = JSON.parse(row.source_message_ids) as string[];
      if (sources.length !== 1 || protectedMessages.has(sources[0])) continue;
      remove.run(candidateId, row.id);
    }
  }

  changeMemory(
    candidateId: string,
    memoryId: string,
    change: MemoryChange,
  ): StoredMemory | null {
    const row = this.database
      .prepare(
        `SELECT id, kind, domain, statement_cipher, confidence, source_message_ids,
                sensitive, status, created_at, updated_at
         FROM memory
         WHERE id = ? AND candidate_id = ? AND status != 'deleted'`,
      )
      .get(memoryId, candidateId) as MemoryRow | undefined;
    if (!row) {
      return null;
    }
    if (change.action === 'correct' && !change.statement?.trim()) {
      throw new CandidateStoreConflictError();
    }
    return this.applyMemoryChange(candidateId, row, change);
  }

  private persistMemoryRevision(
    candidateId: string,
    memoryId: string,
    action: MemoryChange['action'],
    previousStatement: string,
    nextStatement: string,
    nextSourceRefs: string[],
    nextStatus: 'confirmed' | 'corrected' | 'deleted',
    now: string,
  ): void {
    this.inTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO memory_revisions
            (id, memory_id, candidate_id, action, previous_digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          memoryId,
          candidateId,
          action,
          createHash('sha256').update(previousStatement).digest('hex'),
          now,
        );
      this.database
        .prepare(
          `UPDATE memory
           SET statement_cipher = ?, source_message_ids = ?, status = ?, updated_at = ?
           WHERE id = ? AND candidate_id = ?`,
        )
        .run(
          this.sealedText.seal(
            nextStatement,
            memoryAssociatedData(candidateId, memoryId),
          ),
          JSON.stringify(nextSourceRefs),
          nextStatus,
          now,
          memoryId,
          candidateId,
        );
    });
  }

  snapshotParts(candidateId: string): {
    messages: CoachMessage[];
    memory: StoredMemory[];
    turns: StoredTurn[];
    dossier: ReturnType<typeof buildExperienceDossier>;
  } {
    const memory = this.memory(candidateId);
    return {
      messages: this.messages(candidateId),
      memory,
      turns: this.turns(candidateId),
      dossier: buildExperienceDossier(memory),
    };
  }

  private applyMemoryChange(
    candidateId: string,
    row: MemoryRow,
    change: MemoryChange,
  ): StoredMemory | null {
    const currentStatement = this.openMemoryStatement(candidateId, row);
    const now = new Date().toISOString();
    const nextStatus = memoryStatusAfter(change);
    const nextStatement = memoryStatementAfter(change, currentStatement);
    const nextSourceRefs = memorySourceRefsAfter(change, row, now);

    this.persistMemoryRevision(
      candidateId,
      row.id,
      change.action,
      currentStatement,
      nextStatement,
      nextSourceRefs,
      nextStatus,
      now,
    );
    if (nextStatus === 'deleted') {
      return null;
    }
    return {
      id: row.id,
      kind: row.kind,
      domain: row.domain,
      statement: nextStatement,
      confidence: row.confidence,
      sourceMessageIds: nextSourceRefs,
      sensitive: row.sensitive === 1,
      status: nextStatus,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }

  private insertPendingTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): void {
    const conversationId = this.conversationId(candidateId);
    const now = new Date().toISOString();
    this.inTransaction(() => {
      this.insertMessage(
        candidateId,
        conversationId,
        request.messageId,
        'user',
        request.content,
        now,
      );
      this.database
        .prepare(
          `INSERT INTO turns
            (candidate_id, idempotency_key, conversation_id, user_message_id,
             request_digest, phase, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          candidateId,
          idempotencyKey,
          conversationId,
          request.messageId,
          turnRequestDigest(request),
          request.phase,
          now,
          now,
        );
      this.touchConversation(conversationId, now);
    });
  }

  private insertMessage(
    candidateId: string,
    conversationId: string,
    messageId: string,
    role: CoachMessage['role'],
    content: string,
    createdAt: string,
  ): void {
    // Every caller except the resume-import digest path mints a fresh random
    // id, so ON CONFLICT never fires for them. The digest path (B247 S6)
    // deliberately reuses an id to update the existing announcement message
    // in place — its position in the history (created_at) is left untouched.
    this.database
      .prepare(
        `INSERT INTO messages
          (id, candidate_id, conversation_id, role, body_cipher, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (candidate_id, id) DO UPDATE SET body_cipher = excluded.body_cipher`,
      )
      .run(
        messageId,
        candidateId,
        conversationId,
        role,
        this.sealedText.seal(
          content,
          messageAssociatedData(candidateId, messageId),
        ),
        createdAt,
      );
  }

  private messages(candidateId: string): CoachMessage[] {
    const rows = this.database
      .prepare(
        `SELECT id, role, body_cipher, created_at
         FROM messages WHERE candidate_id = ?
         ORDER BY created_at, id`,
      )
      .all(candidateId) as unknown as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: this.sealedText.open(
        row.body_cipher,
        messageAssociatedData(candidateId, row.id),
      ),
    }));
  }

  private getMessage(
    candidateId: string,
    messageId: string,
  ): CoachMessage | null {
    const row = this.database
      .prepare(
        `SELECT id, role, body_cipher, created_at
         FROM messages WHERE candidate_id = ? AND id = ?`,
      )
      .get(candidateId, messageId) as MessageRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      role: row.role,
      content: this.sealedText.open(
        row.body_cipher,
        messageAssociatedData(candidateId, row.id),
      ),
    };
  }

  private knowledgeContext(
    candidateId: string,
  ): NonNullable<CoachTurnInput['knowledgeContext']> {
    const memory = this.memory(candidateId);
    const confirmedFacts = memory
      .filter(
        (item) =>
          item.status === 'confirmed' || item.status === 'corrected',
      )
      .slice(-12)
      .map((item) => ({
        ref: `memory:${item.id}`,
        kind: item.kind,
        domain: item.domain,
        statement: item.statement,
        sourceRefs: item.sourceMessageIds,
        sensitive: item.sensitive,
      }));
    const openQuestions = memory
      .filter(
        (item) => item.kind === 'open-question' && item.status === 'proposed',
      )
      .slice(-12)
      .map((item) => ({
        ref: `memory:${item.id}`,
        statement: item.statement,
        sourceRefs: item.sourceMessageIds,
      }));
    return {
      confirmedFacts,
      openQuestions,
      documents: this.documentKnowledgeContext(candidateId),
    };
  }

  private documentKnowledgeContext(
    candidateId: string,
  ): NonNullable<CoachTurnInput['knowledgeContext']>['documents'] {
    return this.documentRepository
      .list(candidateId)
      .filter(
        (document) =>
          document.parseStatus === 'ready' &&
          (document.kind === 'resume' || document.kind === 'profile_export'),
      )
      .flatMap((document) => {
        const stored = this.documentRepository.get(candidateId, document.id);
        const excerpt = stored?.extractedText?.trim();
        return excerpt
          ? [
              {
                ref: `document:${document.id}`,
                kind: document.kind,
                fileName: document.fileName,
                version: document.version,
                sha256: document.sha256,
                excerpt: excerpt.slice(0, 6_000),
              },
            ]
          : [];
      })
      .slice(0, 2);
  }

  private memory(candidateId: string): StoredMemory[] {
    const rows = this.database
      .prepare(
        `SELECT id, kind, domain, statement_cipher, confidence, source_message_ids,
                sensitive, status, created_at, updated_at
         FROM memory
         WHERE candidate_id = ? AND status != 'deleted'
         ORDER BY created_at, id`,
      )
      .all(candidateId) as unknown as MemoryRow[];
    return rows.map((row) => this.memoryFromRow(candidateId, row));
  }

  getCoachTurn(candidateId: string, key: string) {
    const row = this.getTurn(candidateId, key);
    if (!row) return null;
    return { status: row.status, result: row.status === 'completed' ? this.outputFromTurn(candidateId, key, row).result : null };
  }

  private turns(candidateId: string): StoredTurn[] {
    const rows = this.database
      .prepare(
        `SELECT idempotency_key, status, phase, user_message_id, request_digest,
                result_cipher, provider, model, response_id,
                input_tokens, output_tokens, total_tokens,
                created_at, updated_at
         FROM turns WHERE candidate_id = ?
         ORDER BY created_at, idempotency_key`,
      )
      .all(candidateId) as unknown as TurnRow[];
    return rows.map((row) => {
      const output =
        row.status === 'completed'
          ? this.outputFromTurn(
              candidateId,
              row.idempotency_key,
              row,
            )
          : null;
      return {
        idempotencyKey: row.idempotency_key,
        phase: row.phase,
        status: row.status,
        result: output?.result ?? null,
        provenance: output
          ? {
              provider: output.provider,
              model: output.model,
              responseId: output.responseId,
              usage: output.usage,
            }
          : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private memoryFromRow(
    candidateId: string,
    row: MemoryRow,
  ): StoredMemory {
    if (row.status === 'deleted') {
      throw new Error('deleted memory cannot be materialized');
    }
    return {
      id: row.id,
      kind: row.kind,
      domain: row.domain,
      statement: this.openMemoryStatement(candidateId, row),
      confidence: row.confidence,
      sourceMessageIds: JSON.parse(row.source_message_ids) as string[],
      sensitive: row.sensitive === 1,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private openMemoryStatement(
    candidateId: string,
    row: MemoryRow,
  ): string {
    return this.sealedText.open(
      row.statement_cipher,
      memoryAssociatedData(candidateId, row.id),
    );
  }

  private outputFromTurn(
    candidateId: string,
    idempotencyKey: string,
    turn: TurnRow,
  ): CoachProviderResult {
    if (
      !turn.result_cipher ||
      !turn.provider ||
      !turn.model ||
      !turn.response_id
    ) {
      throw new Error('completed turn is incomplete');
    }
    const parsed = coachTurnResultSchema.parse(
      JSON.parse(
        this.sealedText.open(
          turn.result_cipher,
          turnAssociatedData(candidateId, idempotencyKey),
        ),
      ),
    ) as CoachTurnResult;
    return {
      result: parsed,
      provider: turn.provider,
      model: turn.model,
      responseId: turn.response_id,
      usage: {
        inputTokens: turn.input_tokens ?? 0,
        outputTokens: turn.output_tokens ?? 0,
        totalTokens: turn.total_tokens ?? 0,
      },
    };
  }

  private conversationId(candidateId: string): string {
    const row = this.database
      .prepare('SELECT id FROM conversations WHERE candidate_id = ?')
      .get(candidateId) as { id: string } | undefined;
    if (!row) {
      throw new CandidateNotFoundError();
    }
    return row.id;
  }

  private touchConversation(conversationId: string, now: string): void {
    this.database
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(now, conversationId);
  }

  private getTurn(
    candidateId: string,
    idempotencyKey: string,
  ): TurnRow | null {
    return (
      (this.database
        .prepare(
          `SELECT idempotency_key, status, phase, user_message_id, request_digest,
                  result_cipher, provider, model, response_id,
                  input_tokens, output_tokens, total_tokens,
                  created_at, updated_at
           FROM turns WHERE candidate_id = ? AND idempotency_key = ?`,
        )
        .get(candidateId, idempotencyKey) as TurnRow | undefined) ?? null
    );
  }

  private inTransaction<T>(operation: () => T): T {
    // SQLite has no nested BEGIN. A batch review runs several dossier writes
    // that each know how to be atomic on their own, so an outer transaction
    // joins them instead of crashing on the second BEGIN (B166).
    if (this.database.isTransaction) return operation();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function memoryStatusAfter(change: MemoryChange): 'confirmed' | 'corrected' | 'deleted' {
  if (change.action === 'confirm') return 'confirmed';
  return change.action === 'correct' ? 'corrected' : 'deleted';
}

function memoryStatementAfter(change: MemoryChange, currentStatement: string): string {
  if (change.action === 'correct') return change.statement!.trim();
  return change.action === 'delete' ? '[deleted]' : currentStatement;
}

function memorySourceRefsAfter(change: MemoryChange, row: MemoryRow, now: string): string[] {
  const currentSourceRefs = JSON.parse(row.source_message_ids) as string[];
  const activeSourceRefs = currentSourceRefs.filter(
    (ref) => !ref.startsWith('deleted-document:'),
  );
  return change.action !== 'delete' && activeSourceRefs.length === 0
    ? [`candidate-review:${now}`]
    : activeSourceRefs;
}
