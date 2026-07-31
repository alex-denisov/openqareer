import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  coachTurnResultSchema,
  type CoachMessage,
  type CoachTurnResult,
} from '../domain/coach';
import type { CoachProviderResult } from '../providers/coachProvider';
import type {
  CandidateCredentials,
  CandidateIdentity,
  CandidateSnapshot,
  CandidateStore,
  MemoryChange,
  StartedTurn,
  StoredMemory,
  StoredTurn,
  TurnRequest,
} from './candidateStore';
import { SealedText } from './sealedText';
import { MIGRATION_1 } from './sqliteSchema';

interface SqliteCandidateStoreOptions {
  databasePath: string;
  encryptionKey: Buffer;
}

interface CandidateRow {
  id: string;
  data_class: CandidateIdentity['dataClass'];
  locale: CandidateIdentity['locale'];
  created_at: string;
}

interface MessageRow {
  id: string;
  role: CoachMessage['role'];
  body_cipher: string;
  created_at: string;
}

interface MemoryRow {
  id: string;
  kind: StoredMemory['kind'];
  statement_cipher: string;
  confidence: StoredMemory['confidence'];
  source_message_ids: string;
  sensitive: number;
  status: StoredMemory['status'] | 'deleted';
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  idempotency_key: string;
  status: 'pending' | 'failed' | 'completed';
  phase: TurnRequest['phase'];
  user_message_id: string;
  result_cipher: string | null;
  provider: CoachProviderResult['provider'] | null;
  model: string | null;
  response_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export class SqliteCandidateStore implements CandidateStore {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(options: SqliteCandidateStoreOptions) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), {
        recursive: true,
        mode: 0o700,
      });
    }
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    this.sealedText = new SealedText(options.encryptionKey);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA trusted_schema = OFF;
    `);
    this.migrate();
  }

  createCandidate(input: {
    dataClass: CandidateIdentity['dataClass'];
    locale: CandidateIdentity['locale'];
  }): CandidateCredentials {
    const id = randomUUID();
    const conversationId = randomUUID();
    const accessToken = `oqc_${randomBytes(32).toString('base64url')}`;
    const now = new Date().toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO candidates
            (id, token_hash, data_class, locale, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, hashToken(accessToken), input.dataClass, input.locale, now, now);
      this.database
        .prepare(
          `INSERT INTO conversations
            (id, candidate_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(conversationId, id, now, now);
    });
    return {
      id,
      accessToken,
      dataClass: input.dataClass,
      locale: input.locale,
      createdAt: now,
    };
  }

  authenticate(accessToken: string): CandidateIdentity | null {
    if (!/^oqc_[A-Za-z0-9_-]{40,}$/.test(accessToken)) {
      return null;
    }
    const row = this.database
      .prepare(
        `SELECT id, data_class, locale, created_at
         FROM candidates WHERE token_hash = ?`,
      )
      .get(hashToken(accessToken)) as CandidateRow | undefined;
    return row ? candidateFromRow(row) : null;
  }

  startTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): StartedTurn {
    const candidate = this.requireCandidate(candidateId);
    const existing = this.getTurn(candidateId, idempotencyKey);
    if (existing) {
      const storedMessage = this.getMessage(candidateId, existing.user_message_id);
      if (
        !storedMessage ||
        storedMessage.id !== request.messageId ||
        storedMessage.content !== request.content ||
        existing.phase !== request.phase
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
    this.transaction(() => {
      this.insertMessage(
        candidateId,
        conversationId,
        assistantMessageId,
        'assistant',
        output.result.message,
        now,
      );
      for (const memory of output.result.memoryCandidates) {
        const memoryId = randomUUID();
        this.database
          .prepare(
            `INSERT INTO memory
              (id, candidate_id, conversation_id, kind, statement_cipher,
               confidence, source_message_ids, sensitive, status,
               created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
          )
          .run(
            memoryId,
            candidateId,
            conversationId,
            memory.kind,
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
      this.touchConversation(conversationId, now);
    });
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

  getSnapshot(candidateId: string): CandidateSnapshot {
    const candidate = this.requireCandidate(candidateId);
    return {
      candidate,
      messages: this.messages(candidateId),
      memory: this.memory(candidateId),
      turns: this.turns(candidateId),
    };
  }

  changeMemory(
    candidateId: string,
    memoryId: string,
    change: MemoryChange,
  ): StoredMemory | null {
    const row = this.database
      .prepare(
        `SELECT id, kind, statement_cipher, confidence, source_message_ids,
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

    const currentStatement = this.openMemoryStatement(candidateId, row);
    const now = new Date().toISOString();
    const nextStatus =
      change.action === 'confirm'
        ? 'confirmed'
        : change.action === 'correct'
          ? 'corrected'
          : 'deleted';
    const nextStatement =
      change.action === 'correct'
        ? change.statement!.trim()
        : change.action === 'delete'
          ? '[deleted]'
          : currentStatement;

    this.transaction(() => {
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
          change.action,
          createHash('sha256').update(currentStatement).digest('hex'),
          now,
        );
      this.database
        .prepare(
          `UPDATE memory
           SET statement_cipher = ?, status = ?, updated_at = ?
           WHERE id = ? AND candidate_id = ?`,
        )
        .run(
          this.sealedText.seal(
            nextStatement,
            memoryAssociatedData(candidateId, memoryId),
          ),
          nextStatus,
          now,
          memoryId,
          candidateId,
        );
    });
    if (nextStatus === 'deleted') {
      return null;
    }
    return {
      id: row.id,
      kind: row.kind,
      statement: nextStatement,
      confidence: row.confidence,
      sourceMessageIds: JSON.parse(row.source_message_ids) as string[],
      sensitive: row.sensitive === 1,
      status: nextStatus,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }

  exportCandidate(candidateId: string): CandidateSnapshot {
    return this.getSnapshot(candidateId);
  }

  deleteCandidate(candidateId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM candidates WHERE id = ?')
      .run(candidateId);
    if (result.changes === 1) {
      this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
    return result.changes === 1;
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const row = this.database
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number | null };
    if ((row.version ?? 0) < 1) {
      this.transaction(() => {
        this.database.exec(MIGRATION_1);
        this.database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)',
          )
          .run(new Date().toISOString());
      });
    }
  }

  private insertPendingTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): void {
    const conversationId = this.conversationId(candidateId);
    const now = new Date().toISOString();
    this.transaction(() => {
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
             phase, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          candidateId,
          idempotencyKey,
          conversationId,
          request.messageId,
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
    this.database
      .prepare(
        `INSERT INTO messages
          (id, candidate_id, conversation_id, role, body_cipher, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
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

  private memory(candidateId: string): StoredMemory[] {
    const rows = this.database
      .prepare(
        `SELECT id, kind, statement_cipher, confidence, source_message_ids,
                sensitive, status, created_at, updated_at
         FROM memory
         WHERE candidate_id = ? AND status != 'deleted'
         ORDER BY created_at, id`,
      )
      .all(candidateId) as unknown as MemoryRow[];
    return rows.map((row) => this.memoryFromRow(candidateId, row));
  }

  private turns(candidateId: string): StoredTurn[] {
    const rows = this.database
      .prepare(
        `SELECT idempotency_key, status, phase, user_message_id,
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

  private requireCandidate(candidateId: string): CandidateIdentity {
    const row = this.database
      .prepare(
        `SELECT id, data_class, locale, created_at
         FROM candidates WHERE id = ?`,
      )
      .get(candidateId) as CandidateRow | undefined;
    if (!row) {
      throw new CandidateNotFoundError();
    }
    return candidateFromRow(row);
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
          `SELECT idempotency_key, status, phase, user_message_id,
                  result_cipher, provider, model, response_id,
                  input_tokens, output_tokens, total_tokens,
                  created_at, updated_at
           FROM turns WHERE candidate_id = ? AND idempotency_key = ?`,
        )
        .get(candidateId, idempotencyKey) as TurnRow | undefined) ?? null
    );
  }

  private transaction<T>(operation: () => T): T {
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

export class CandidateNotFoundError extends Error {}
export class CandidateStoreConflictError extends Error {}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function candidateFromRow(row: CandidateRow): CandidateIdentity {
  return {
    id: row.id,
    dataClass: row.data_class,
    locale: row.locale,
    createdAt: row.created_at,
  };
}

function messageAssociatedData(
  candidateId: string,
  messageId: string,
): string {
  return `candidate:${candidateId}:message:${messageId}`;
}

function memoryAssociatedData(
  candidateId: string,
  memoryId: string,
): string {
  return `candidate:${candidateId}:memory:${memoryId}`;
}

function turnAssociatedData(
  candidateId: string,
  idempotencyKey: string,
): string {
  return `candidate:${candidateId}:turn:${idempotencyKey}`;
}
