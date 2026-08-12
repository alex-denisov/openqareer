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
import { buildExperienceDossier } from '../domain/dossier';
import type {
  AssessmentId,
  AssessmentResult,
  AssessmentSubmission,
} from '../domain/assessment';
import type { CoachProviderResult } from '../providers/coachProvider';
import type {
  CandidateCredentials,
  CandidateIdentity,
  CandidateSnapshot,
  CandidateStore,
  MemoryChange,
  StartedTurn,
  StoredAssessment,
  StoredGermanyMarket,
  StoredMemory,
  StoredTurn,
  TurnRequest,
  ConsumedOAuthAuthorization,
  OAuthAuthorizationInput,
  OAuthConnectionInput,
  StoredOAuthConnection,
} from './candidateStore';
import type { OAuthPlatform } from '../connectors/oauthTypes';
import type { ConnectorActionRecord } from '../connectors/connectorActionQueue';
import { SealedText } from './sealedText';
import { SqliteAssessmentRepository } from './sqliteAssessmentRepository';
import { SqliteMarketRepository } from './sqliteMarketRepository';
import { SqliteCareerCommandRepository } from './sqliteCareerCommandRepository';
import type {
  GermanyMarketResult,
  GermanyMarketSubmission,
} from '../domain/germanyMarket';
import {
  MIGRATION_1,
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
  MIGRATION_6,
  MIGRATION_7,
  MIGRATION_8,
} from './sqliteSchema';
import type {
  CareerCommandRecord,
  VerifiedCareerApproval,
} from '../orchestration/careerCommandPlanner';
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
  domain: StoredMemory['domain'];
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
  request_digest: string | null;
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
  private readonly assessmentsRepository: SqliteAssessmentRepository;
  private readonly marketRepository: SqliteMarketRepository;
  private readonly careerCommandRepository: SqliteCareerCommandRepository;

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
    this.assessmentsRepository = new SqliteAssessmentRepository(
      this.database,
      this.sealedText,
    );
    this.marketRepository = new SqliteMarketRepository(
      this.database,
      this.sealedText,
    );
    this.careerCommandRepository = new SqliteCareerCommandRepository(
      this.database,
      this.sealedText,
    );
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
    const memory = this.memory(candidateId);
    return {
      candidate,
      messages: this.messages(candidateId),
      memory,
      turns: this.turns(candidateId),
      dossier: buildExperienceDossier(memory),
      assessments: this.assessmentsRepository.list(candidateId),
      germanyMarket: this.marketRepository.get(candidateId),
    };
  }
  saveAssessment(
    candidateId: string,
    assessmentId: AssessmentId,
    submission: AssessmentSubmission,
    result: AssessmentResult,
  ): StoredAssessment {
    this.requireCandidate(candidateId);
    return this.assessmentsRepository.save(
      candidateId,
      assessmentId,
      submission,
      result,
    );
  }
  saveGermanyMarket(
    candidateId: string,
    submission: GermanyMarketSubmission,
    result: GermanyMarketResult,
  ): StoredGermanyMarket {
    this.requireCandidate(candidateId);
    return this.marketRepository.save(candidateId, submission, result);
  }
  createOAuthAuthorization(
    candidateId: string,
    authorization: OAuthAuthorizationInput,
  ): void {
    this.requireCandidate(candidateId);
    if (!/^[a-f0-9]{64}$/.test(authorization.stateDigest)) {
      throw new Error('OAuth state digest must be lowercase SHA-256 hex');
    }
    const now = new Date().toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          `DELETE FROM oauth_authorizations
           WHERE expires_at <= ? OR (candidate_id = ? AND platform = ?)`,
        )
        .run(now, candidateId, authorization.platform);
      this.database
        .prepare(
          `INSERT INTO oauth_authorizations
            (state_digest, candidate_id, platform, code_verifier_cipher,
             expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          authorization.stateDigest,
          candidateId,
          authorization.platform,
          this.sealedText.seal(
            authorization.codeVerifier,
            oauthAuthorizationAssociatedData(
              candidateId,
              authorization.platform,
              authorization.stateDigest,
            ),
          ),
          authorization.expiresAt,
          now,
        );
    });
  }
  consumeOAuthAuthorization(
    platform: OAuthPlatform,
    stateDigest: string,
    consumedAt: string,
  ): ConsumedOAuthAuthorization | null {
    let consumed: ConsumedOAuthAuthorization | null = null;
    this.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT candidate_id, code_verifier_cipher, expires_at
           FROM oauth_authorizations
           WHERE state_digest = ? AND platform = ?`,
        )
        .get(stateDigest, platform) as
        | {
            candidate_id: string;
            code_verifier_cipher: string;
            expires_at: string;
          }
        | undefined;
      this.database
        .prepare('DELETE FROM oauth_authorizations WHERE state_digest = ?')
        .run(stateDigest);
      if (!row || row.expires_at <= consumedAt) return;
      consumed = {
        candidateId: row.candidate_id,
        codeVerifier: this.sealedText.open(
          row.code_verifier_cipher,
          oauthAuthorizationAssociatedData(
            row.candidate_id,
            platform,
            stateDigest,
          ),
        ),
      };
    });
    return consumed;
  }
  saveOAuthConnection(
    candidateId: string,
    connection: OAuthConnectionInput,
  ): StoredOAuthConnection {
    this.requireCandidate(candidateId);
    const existing = this.getOAuthConnection(candidateId, connection.platform);
    const now = new Date().toISOString();
    const stored: StoredOAuthConnection = {
      ...connection,
      capabilities: [...connection.capabilities],
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    };
    const cipher = this.sealedText.seal(
      JSON.stringify(stored),
      oauthConnectionAssociatedData(candidateId, connection.platform),
    );
    this.database
      .prepare(
        `INSERT INTO oauth_connections
          (candidate_id, platform, connection_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, platform) DO UPDATE SET
           connection_cipher = excluded.connection_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        connection.platform,
        cipher,
        stored.connectedAt,
        stored.updatedAt,
      );
    return stored;
  }
  getOAuthConnection(
    candidateId: string,
    platform: OAuthPlatform,
  ): StoredOAuthConnection | null {
    this.requireCandidate(candidateId);
    const row = this.database
      .prepare(
        `SELECT connection_cipher FROM oauth_connections
         WHERE candidate_id = ? AND platform = ?`,
      )
      .get(candidateId, platform) as { connection_cipher: string } | undefined;
    if (!row) return null;
    return JSON.parse(
      this.sealedText.open(
        row.connection_cipher,
        oauthConnectionAssociatedData(candidateId, platform),
      ),
    ) as StoredOAuthConnection;
  }
  listOAuthConnections(candidateId: string): StoredOAuthConnection[] {
    this.requireCandidate(candidateId);
    const rows = this.database
      .prepare(
        `SELECT platform, connection_cipher FROM oauth_connections
         WHERE candidate_id = ? ORDER BY platform`,
      )
      .all(candidateId) as Array<{
      platform: OAuthPlatform;
      connection_cipher: string;
    }>;
    return rows.map((row) =>
      JSON.parse(
        this.sealedText.open(
          row.connection_cipher,
          oauthConnectionAssociatedData(candidateId, row.platform),
        ),
      ) as StoredOAuthConnection,
    );
  }
  deleteOAuthConnection(
    candidateId: string,
    platform: OAuthPlatform,
  ): boolean {
    this.requireCandidate(candidateId);
    return (
      this.database
        .prepare(
          `DELETE FROM oauth_connections
           WHERE candidate_id = ? AND platform = ?`,
        )
        .run(candidateId, platform).changes === 1
    );
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
      domain: row.domain,
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
  saveCareerCommand(command: CareerCommandRecord): CareerCommandRecord {
    this.requireCandidate(command.candidateId);
    return this.careerCommandRepository.save(command);
  }
  getCareerCommand(
    candidateId: string,
    commandId: string,
  ): CareerCommandRecord | null {
    return this.careerCommandRepository.get(candidateId, commandId);
  }
  approveCareerCommand(input: {
    candidateId: string;
    commandId: string;
    approval: VerifiedCareerApproval;
    consumedAt: string;
  }): CareerCommandRecord {
    return this.careerCommandRepository.approve(input);
  }
  claimCareerCommand(
    candidateId: string,
    commandId: string,
    execution: ConnectorActionRecord,
    claimedAt: string,
  ): CareerCommandRecord {
    return this.careerCommandRepository.claim(
      candidateId,
      commandId,
      execution,
      claimedAt,
    );
  }
  finishCareerCommand(
    candidateId: string,
    commandId: string,
    command: CareerCommandRecord,
  ): CareerCommandRecord {
    return this.careerCommandRepository.finish(
      candidateId,
      commandId,
      command,
    );
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
    if ((row.version ?? 0) < 2) {
      this.transaction(() => {
        this.database.exec(MIGRATION_2);
        this.database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)',
          )
          .run(new Date().toISOString());
      });
    }
    if ((row.version ?? 0) < 3) {
      this.transaction(() => {
        this.database.exec(MIGRATION_3);
        this.database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)',
          )
          .run(new Date().toISOString());
      });
    }
    if ((row.version ?? 0) < 4) {
      this.transaction(() => {
        this.database.exec(MIGRATION_4);
        this.database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)',
          )
          .run(new Date().toISOString());
      });
    }
    if ((row.version ?? 0) < 5) {
      this.transaction(() => {
        this.database.exec(MIGRATION_5);
        this.database.prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)',
        ).run(new Date().toISOString());
      });
    }
    if ((row.version ?? 0) < 6) {
      this.transaction(() => {
        this.database.exec(MIGRATION_6);
        this.database.prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)',
        ).run(new Date().toISOString());
      });
    }
    if ((row.version ?? 0) < 7) {
      this.transaction(() => {
        this.database.exec(MIGRATION_7);
        this.database.prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)',
        ).run(new Date().toISOString());
      });
    }
    if ((row.version ?? 0) < 8) {
      this.transaction(() => {
        this.database.exec(MIGRATION_8);
        this.database.prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)',
        ).run(new Date().toISOString());
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
        `SELECT id, kind, domain, statement_cipher, confidence, source_message_ids,
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
          `SELECT idempotency_key, status, phase, user_message_id, request_digest,
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
function turnRequestDigest(request: TurnRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.messageId,
        request.content,
        request.marketQuery ?? null,
      ]),
    )
    .digest('hex');
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
function oauthAuthorizationAssociatedData(
  candidateId: string,
  platform: OAuthPlatform,
  stateDigest: string,
): string {
  return `candidate:${candidateId}:oauth:${platform}:authorization:${stateDigest}`;
}
function oauthConnectionAssociatedData(
  candidateId: string,
  platform: OAuthPlatform,
): string {
  return `candidate:${candidateId}:oauth:${platform}:connection`;
}
