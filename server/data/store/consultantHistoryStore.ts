import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CoachMessage, CoachTurnInput, CoachTurnStage } from '../../domain/coach';
import type { CoachProviderResult } from '../../providers/coachProvider';
import type {
  ConsultantConversationDetail,
  ConsultantConversationExport,
  ConsultantConversationMessage,
  ConsultantConversationPage,
  ConsultantConversationSummary,
  ConsultantSummaryTask,
  TurnRequest,
} from '../candidateStore';
import { SealedText } from '../sealedText';
import { messageAssociatedData } from './shared';
import {
  CONSULTANT_FTS_RESULT_LIMIT,
  CONSULTANT_MESSAGE_SNIPPET_CHAR_LIMIT,
  CONSULTANT_SUMMARY_COUNT_LIMIT,
  fitConsultantHistoryContext,
  relatedConsultantStages,
} from './consultantContextBudget';

const IDLE_CLOSE_MS = 30 * 60 * 1_000;
const SUMMARY_ASSOCIATED_DATA = (candidateId: string, conversationId: string, count: number, version: number) =>
  `candidate:${candidateId}:consultant-summary:${conversationId}:${count}:${version}`;

interface ConversationRow {
  id: string;
  stage: CoachTurnStage;
  opened_at: string;
  last_message_at: string;
  closed_at: string | null;
  message_count: number;
  first_user_message_id: string | null;
}

interface SummaryRow {
  id: string;
  conversation_id: string;
  message_count: number;
  version: number;
  summary_cipher: string;
  created_at: string;
  stage: CoachTurnStage;
}

interface LegacyMessageRow {
  id: string;
  role: CoachMessage['role'];
  body_cipher: string;
  created_at: string;
  stage: CoachTurnStage;
  idempotency_key: string;
}

interface LegacyTurnRow {
  idempotency_key: string;
  user_id: string;
  user_role: CoachMessage['role'];
  user_cipher: string;
  user_created_at: string;
  assistant_id: string | null;
  assistant_role: CoachMessage['role'] | null;
  assistant_cipher: string | null;
  assistant_created_at: string | null;
  stage: CoachTurnStage;
}

export class ConsultantHistoryStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  ensureLegacyHistory(candidateId: string): void {
    const complete = this.database
      .prepare('SELECT 1 FROM consultant_history_backfill WHERE candidate_id = ?')
      .get(candidateId);
    if (complete) return;
    this.backfillTurns(candidateId);
    this.database
      .prepare('INSERT OR IGNORE INTO consultant_history_backfill (candidate_id, completed_at) VALUES (?, ?)')
      .run(candidateId, new Date().toISOString());
  }

  private backfillTurns(candidateId: string): void {
    let active: ConversationRow | null = null;
    for (const turn of this.legacyTurns(candidateId)) {
      active = this.backfillTurn(candidateId, turn, active);
    }
    if (active && Date.now() - Date.parse(active.last_message_at) > IDLE_CLOSE_MS) {
      this.close(active, 'idle_timeout', new Date().toISOString());
    }
  }

  private legacyTurns(candidateId: string): LegacyTurnRow[] {
    return this.database
      .prepare(
        `SELECT t.idempotency_key, t.user_message_id, t.assistant_message_id,
                COALESCE(ts.stage, 'today') AS stage, COALESCE(ts.is_service, 0) AS is_service,
                u.id AS user_id, u.role AS user_role,
                u.body_cipher AS user_cipher, u.created_at AS user_created_at,
                a.id AS assistant_id, a.role AS assistant_role,
                a.body_cipher AS assistant_cipher, a.created_at AS assistant_created_at
         FROM turns t
         LEFT JOIN turn_stages ts
           ON ts.candidate_id = t.candidate_id AND ts.idempotency_key = t.idempotency_key
         INNER JOIN messages u ON u.candidate_id = t.candidate_id AND u.id = t.user_message_id
         LEFT JOIN messages a ON a.candidate_id = t.candidate_id AND a.id = t.assistant_message_id
         WHERE t.candidate_id = ? AND ts.is_service = 0
         ORDER BY u.created_at, u.id`,
      )
      .all(candidateId) as unknown as LegacyTurnRow[];
  }

  private backfillTurn(
    candidateId: string,
    turn: LegacyTurnRow,
    active: ConversationRow | null,
  ): ConversationRow | null {
    for (const message of this.legacyMessages(turn)) active = this.backfillMessage(candidateId, active, message);
    return active;
  }

  private legacyMessages(turn: LegacyTurnRow): LegacyMessageRow[] {
    return [
      {
        id: turn.user_id,
        role: turn.user_role,
        body_cipher: turn.user_cipher,
        created_at: turn.user_created_at,
        stage: turn.stage,
        idempotency_key: turn.idempotency_key,
      },
      ...(turn.assistant_id && turn.assistant_created_at && turn.assistant_cipher && turn.assistant_role
        ? [{
            id: turn.assistant_id,
            role: turn.assistant_role,
            body_cipher: turn.assistant_cipher,
            created_at: turn.assistant_created_at,
            stage: turn.stage,
            idempotency_key: turn.idempotency_key,
          }]
        : []),
    ];
  }

  private backfillMessage(
    candidateId: string,
    active: ConversationRow | null,
    message: LegacyMessageRow,
  ): ConversationRow {
    const timestamp = Date.parse(message.created_at);
    const idle = active ? timestamp - Date.parse(active.last_message_at) > IDLE_CLOSE_MS : false;
    if (active && (active.stage !== message.stage || idle)) {
      this.close(active, active.stage === message.stage ? 'idle_timeout' : 'stage_changed', message.created_at);
      active = null;
    }
    active ??= this.createConversation(candidateId, message.stage, message.created_at);
    this.attachMessage(candidateId, active, message.id, message.role, message.body_cipher, message.created_at);
    this.database.prepare(
      `INSERT OR IGNORE INTO consultant_conversation_turns
       (candidate_id, idempotency_key, conversation_id) VALUES (?, ?, ?)`,
    ).run(candidateId, message.idempotency_key, active.id);
    return active;
  }

  recordUserTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): { readonly currentConversationId: string; readonly closedConversations: ConsultantSummaryTask[] } {
    this.ensureLegacyHistory(candidateId);
    const existingMapping = this.database
      .prepare('SELECT conversation_id FROM consultant_conversation_turns WHERE candidate_id = ? AND idempotency_key = ?')
      .get(candidateId, idempotencyKey) as { conversation_id: string } | undefined;
    if (existingMapping) {
      return { currentConversationId: existingMapping.conversation_id, closedConversations: [] };
    }
    const stage = request.stage ?? 'today';
    const now = new Date().toISOString();
    const active = this.activeConversation(candidateId);
    const closedConversations: ConsultantSummaryTask[] = [];
    let conversation = active;
    if (active && (active.stage !== stage || Date.now() - Date.parse(active.last_message_at) > IDLE_CLOSE_MS)) {
      const reason = active.stage === stage ? 'idle_timeout' : 'stage_changed';
      const task = this.close(active, reason, now);
      if (task) closedConversations.push(task);
      conversation = null;
    }
    if (!conversation) conversation = this.createConversation(candidateId, stage, now);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO consultant_conversation_turns
         (candidate_id, idempotency_key, conversation_id) VALUES (?, ?, ?)`,
      )
      .run(candidateId, idempotencyKey, conversation.id);
    const storedTurn = this.database
      .prepare('SELECT conversation_id FROM consultant_conversation_turns WHERE candidate_id = ? AND idempotency_key = ?')
      .get(candidateId, idempotencyKey) as { conversation_id: string };
    const existingMessage = this.database
      .prepare('SELECT role, body_cipher, created_at FROM messages WHERE candidate_id = ? AND id = ?')
      .get(candidateId, request.messageId) as { role: CoachMessage['role']; body_cipher: string; created_at: string } | undefined;
    if (existingMessage) {
      const owner = this.getConversation(candidateId, storedTurn.conversation_id);
      if (owner) this.attachMessage(candidateId, owner, request.messageId, existingMessage.role, existingMessage.body_cipher, existingMessage.created_at);
    }
    return { currentConversationId: storedTurn.conversation_id, closedConversations };
  }

  recordAssistantTurn(candidateId: string, idempotencyKey: string): void {
    const mapping = this.database
      .prepare('SELECT conversation_id FROM consultant_conversation_turns WHERE candidate_id = ? AND idempotency_key = ?')
      .get(candidateId, idempotencyKey) as { conversation_id: string } | undefined;
    if (!mapping) return;
    const row = this.database
      .prepare(
        `SELECT t.assistant_message_id, m.role, m.body_cipher, m.created_at
         FROM turns t LEFT JOIN messages m
           ON m.candidate_id = t.candidate_id AND m.id = t.assistant_message_id
         WHERE t.candidate_id = ? AND t.idempotency_key = ?`,
      )
      .get(candidateId, idempotencyKey) as {
      assistant_message_id: string | null;
      role: CoachMessage['role'] | null;
      body_cipher: string | null;
      created_at: string | null;
    } | undefined;
    const conversation = this.getConversation(candidateId, mapping.conversation_id);
    if (!row?.assistant_message_id || !row.role || !row.body_cipher || !row.created_at || !conversation) return;
    this.attachMessage(candidateId, conversation, row.assistant_message_id, row.role, row.body_cipher, row.created_at);
  }

  activeMessages(candidateId: string, conversationId: string): CoachMessage[] {
    return this.readMessages(candidateId, conversationId).slice(-30).map(({ id, role, content }) => ({ id, role, content }));
  }

  buildHistoryContext(
    candidateId: string,
    stage: CoachTurnStage,
    query: string,
    base: NonNullable<CoachTurnInput['knowledgeContext']>,
  ): NonNullable<CoachTurnInput['knowledgeContext']> {
    const related = relatedConsultantStages(stage);
    const summaries = this.recentSummaries(candidateId, related);
    const messageSnippets = this.searchSnippets(candidateId, related, query);
    return fitConsultantHistoryContext(base, { summaries, messageSnippets });
  }

  private recentSummaries(candidateId: string, stages: readonly CoachTurnStage[]) {
    const placeholders = stages.map(() => '?').join(',');
    const rows = this.database
      .prepare(
        `SELECT s.id, s.conversation_id, s.message_count, s.version, s.summary_cipher,
                s.created_at, c.stage
         FROM consultant_summaries s
         JOIN consultant_conversations c
           ON c.candidate_id = s.candidate_id AND c.id = s.conversation_id
         WHERE s.candidate_id = ? AND c.closed_at IS NOT NULL
           AND c.stage IN (${placeholders})
           AND s.version = (SELECT MAX(s2.version) FROM consultant_summaries s2
             WHERE s2.candidate_id = s.candidate_id AND s2.conversation_id = s.conversation_id)
         ORDER BY c.closed_at DESC, s.id DESC LIMIT ?`,
      )
      .all(candidateId, ...stages, CONSULTANT_SUMMARY_COUNT_LIMIT) as unknown as SummaryRow[];
    return rows.map((row) => ({
      ref: `consultant-summary:${row.id}`,
      stage: row.stage,
      createdAt: row.created_at,
      summary: this.sealedText.open(
        row.summary_cipher,
        SUMMARY_ASSOCIATED_DATA(candidateId, row.conversation_id, row.message_count, row.version),
      ).slice(0, 2_000),
    }));
  }

  private searchSnippets(candidateId: string, stages: readonly CoachTurnStage[], query: string) {
    const terms = this.tokens(query).slice(0, 8);
    if (!terms.length) return [];
    const expression = terms.map((term) => this.sealedText.indexToken(candidateId, term)).join(' OR ');
    const placeholders = stages.map(() => '?').join(',');
    const rows = this.database
      .prepare(
        `SELECT f.message_id, f.conversation_id, cm.role, cm.stage, cm.created_at,
                m.body_cipher
         FROM consultant_messages_fts f
         JOIN consultant_conversation_messages cm
           ON cm.candidate_id = f.candidate_id AND cm.conversation_id = f.conversation_id
          AND cm.message_id = f.message_id
         JOIN messages m ON m.candidate_id = f.candidate_id AND m.id = f.message_id
         JOIN consultant_conversations c
           ON c.candidate_id = f.candidate_id AND c.id = f.conversation_id
         WHERE consultant_messages_fts MATCH ? AND f.candidate_id = ?
           AND cm.stage IN (${placeholders}) AND c.closed_at IS NOT NULL
         ORDER BY bm25(consultant_messages_fts), cm.created_at DESC LIMIT ?`,
      )
      .all(expression, candidateId, ...stages, CONSULTANT_FTS_RESULT_LIMIT) as unknown as Array<{
      message_id: string;
      conversation_id: string;
      role: CoachMessage['role'];
      stage: CoachTurnStage;
      created_at: string;
      body_cipher: string;
    }>;
    return rows.map((row) => ({
      ref: `consultant-message:${row.message_id}`,
      stage: row.stage,
      role: row.role,
      createdAt: row.created_at,
      content: this.openMessage(candidateId, row.message_id, row.body_cipher).slice(0, CONSULTANT_MESSAGE_SNIPPET_CHAR_LIMIT),
    }));
  }

  getSummaryInput(candidateId: string, task: ConsultantSummaryTask, candidate: { dataClass: 'personal' | 'synthetic'; locale: 'ru-RU' | 'en-US' }): CoachTurnInput | null {
    const conversation = this.getConversation(candidateId, task.conversationId);
    if (!conversation?.closed_at || conversation.message_count !== task.messageCount || this.hasPendingTurns(candidateId, task.conversationId)) return null;
    const messages = this.readMessages(candidateId, task.conversationId).slice(-30);
    if (!messages.length) return null;
    return {
      candidateReference: candidateId,
      dataClass: candidate.dataClass,
      locale: candidate.locale,
      phase: 'evidence',
      internalPurpose: 'consultant-summary',
      messages: messages.map(({ id, role, content }) => ({ id, role, content })),
    };
  }

  saveSummary(candidateId: string, task: ConsultantSummaryTask, result: CoachProviderResult): boolean {
    const conversation = this.getConversation(candidateId, task.conversationId);
    if (!conversation?.closed_at || conversation.message_count !== task.messageCount || this.hasPendingTurns(candidateId, task.conversationId)) return false;
    const exists = this.database
      .prepare('SELECT 1 FROM consultant_summaries WHERE candidate_id = ? AND conversation_id = ? AND message_count = ?')
      .get(candidateId, task.conversationId, task.messageCount);
    if (exists) return false;
    const version = this.database
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM consultant_summaries WHERE candidate_id = ? AND conversation_id = ?')
      .get(candidateId, task.conversationId) as { next: number };
    const id = randomUUID();
    const summary = result.result.message.trim().slice(0, 2_000);
    const cipher = this.sealedText.seal(
      summary,
      SUMMARY_ASSOCIATED_DATA(candidateId, task.conversationId, task.messageCount, version.next),
    );
    const inserted = this.database
      .prepare(
        `INSERT OR IGNORE INTO consultant_summaries
         (id, candidate_id, conversation_id, message_count, version, summary_cipher,
          provider, model, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, candidateId, task.conversationId, task.messageCount, version.next, cipher,
        result.provider, result.model, result.usage.inputTokens, result.usage.outputTokens, new Date().toISOString());
    if (inserted.changes !== 1) return false;
    this.database.prepare('DELETE FROM consultant_summary_claims WHERE candidate_id = ? AND conversation_id = ? AND message_count = ?')
      .run(candidateId, task.conversationId, task.messageCount);
    return true;
  }

  pendingSummaryTasks(candidateId: string, limit = 3): ConsultantSummaryTask[] {
    const rows = this.database
      .prepare(
        `SELECT c.id, c.stage, c.message_count FROM consultant_conversations c
         WHERE c.candidate_id = ? AND c.closed_at IS NOT NULL AND c.message_count > 0
           AND NOT EXISTS (SELECT 1 FROM consultant_summaries s
             WHERE s.candidate_id = c.candidate_id AND s.conversation_id = c.id
               AND s.message_count = c.message_count)
           AND NOT EXISTS (SELECT 1 FROM consultant_conversation_turns ct
             JOIN turns t ON t.candidate_id = ct.candidate_id AND t.idempotency_key = ct.idempotency_key
             WHERE ct.candidate_id = c.candidate_id AND ct.conversation_id = c.id AND t.status = 'pending')
         ORDER BY c.closed_at, c.id LIMIT ?`,
      )
      .all(candidateId, Math.max(1, Math.min(10, limit))) as unknown as Array<{
      id: string;
      stage: CoachTurnStage;
      message_count: number;
    }>;
    return rows.map((row) => ({
      conversationId: row.id,
      stage: row.stage,
      messageCount: row.message_count,
    }));
  }

  claimSummary(candidateId: string, task: ConsultantSummaryTask, now: string): boolean {
    const prior = this.database
      .prepare('SELECT claimed_at FROM consultant_summary_claims WHERE candidate_id = ? AND conversation_id = ? AND message_count = ?')
      .get(candidateId, task.conversationId, task.messageCount) as { claimed_at: string } | undefined;
    if (prior && Date.now() - Date.parse(prior.claimed_at) < 10 * 60 * 1_000) return false;
    if (prior) {
      this.database.prepare('DELETE FROM consultant_summary_claims WHERE candidate_id = ? AND conversation_id = ? AND message_count = ?')
        .run(candidateId, task.conversationId, task.messageCount);
    }
    return this.database.prepare(
      'INSERT OR IGNORE INTO consultant_summary_claims (candidate_id, conversation_id, message_count, claimed_at) VALUES (?, ?, ?, ?)',
    ).run(candidateId, task.conversationId, task.messageCount, now).changes === 1;
  }

  releaseSummaryClaim(candidateId: string, task: ConsultantSummaryTask): void {
    this.database.prepare('DELETE FROM consultant_summary_claims WHERE candidate_id = ? AND conversation_id = ? AND message_count = ?')
      .run(candidateId, task.conversationId, task.messageCount);
  }

  private hasPendingTurns(candidateId: string, conversationId: string): boolean {
    return Boolean(this.database.prepare(
      `SELECT 1 FROM consultant_conversation_turns ct
       JOIN turns t ON t.candidate_id = ct.candidate_id AND t.idempotency_key = ct.idempotency_key
       WHERE ct.candidate_id = ? AND ct.conversation_id = ? AND t.status = 'pending' LIMIT 1`,
    ).get(candidateId, conversationId));
  }

  list(candidateId: string, options: { cursor?: string; limit?: number } = {}): ConsultantConversationPage {
    this.ensureLegacyHistory(candidateId);
    const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)));
    const cursor = options.cursor ? this.decodeCursor(options.cursor) : null;
    const rows = this.database
      .prepare(
        `SELECT id, stage, opened_at, last_message_at, closed_at, message_count, first_user_message_id
         FROM consultant_conversations
         WHERE candidate_id = ? AND closed_at IS NOT NULL
           AND (? IS NULL OR opened_at < ? OR (opened_at = ? AND id < ?))
         ORDER BY opened_at DESC, id DESC LIMIT ?`,
      )
      .all(candidateId, cursor?.openedAt ?? null, cursor?.openedAt ?? null, cursor?.openedAt ?? null, cursor?.id ?? null, limit + 1) as unknown as ConversationRow[];
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    return {
      items: visible.map((row) => this.summaryView(candidateId, row)),
      nextCursor: hasMore && visible.length ? this.encodeCursor(visible[visible.length - 1]!) : null,
    };
  }

  get(candidateId: string, conversationId: string): ConsultantConversationDetail | null {
    this.ensureLegacyHistory(candidateId);
    const row = this.getConversation(candidateId, conversationId);
    if (!row?.closed_at) return null;
    return { ...this.summaryView(candidateId, row), messages: this.readMessages(candidateId, conversationId) };
  }

  export(candidateId: string): ConsultantConversationExport[] {
    this.ensureLegacyHistory(candidateId);
    const rows = this.database
      .prepare('SELECT id, stage, opened_at, last_message_at, closed_at, message_count, first_user_message_id FROM consultant_conversations WHERE candidate_id = ? AND closed_at IS NOT NULL ORDER BY opened_at, id')
      .all(candidateId) as unknown as ConversationRow[];
    return rows.map((row) => {
      const versions = this.database
        .prepare('SELECT id, message_count, version, summary_cipher, created_at FROM consultant_summaries WHERE candidate_id = ? AND conversation_id = ? ORDER BY version')
        .all(candidateId, row.id) as unknown as Array<Pick<SummaryRow, 'id' | 'message_count' | 'version' | 'summary_cipher' | 'created_at'>>;
      return {
        ...this.summaryView(candidateId, row),
        messages: this.readMessages(candidateId, row.id),
        summaries: versions.map((summary) => ({
          version: summary.version,
          messageCount: summary.message_count,
          summary: this.sealedText.open(summary.summary_cipher,
            SUMMARY_ASSOCIATED_DATA(candidateId, row.id, summary.message_count, summary.version)),
          createdAt: summary.created_at,
        })),
      };
    });
  }

  delete(candidateId: string, conversationId: string): boolean {
    const conversation = this.getConversation(candidateId, conversationId);
    if (!conversation?.closed_at) return false;
    this.database.prepare('DELETE FROM consultant_messages_fts WHERE candidate_id = ? AND conversation_id = ?')
      .run(candidateId, conversationId);
    this.database.prepare('DELETE FROM message_stages WHERE candidate_id = ? AND message_id IN (SELECT message_id FROM consultant_conversation_messages WHERE candidate_id = ? AND conversation_id = ?)')
      .run(candidateId, candidateId, conversationId);
    this.database.prepare('DELETE FROM turn_stages WHERE candidate_id = ? AND idempotency_key IN (SELECT idempotency_key FROM consultant_conversation_turns WHERE candidate_id = ? AND conversation_id = ?)')
      .run(candidateId, candidateId, conversationId);
    this.database.prepare('DELETE FROM turns WHERE candidate_id = ? AND idempotency_key IN (SELECT idempotency_key FROM consultant_conversation_turns WHERE candidate_id = ? AND conversation_id = ?)')
      .run(candidateId, candidateId, conversationId);
    this.database.prepare('DELETE FROM messages WHERE candidate_id = ? AND id IN (SELECT message_id FROM consultant_conversation_messages WHERE candidate_id = ? AND conversation_id = ?)')
      .run(candidateId, candidateId, conversationId);
    this.database.prepare('DELETE FROM consultant_conversations WHERE candidate_id = ? AND id = ?')
      .run(candidateId, conversationId);
    return true;
  }

  deleteAllIndexes(candidateId: string): void {
    this.database.prepare('DELETE FROM consultant_messages_fts WHERE candidate_id = ?').run(candidateId);
  }

  private summaryView(candidateId: string, row: ConversationRow): ConsultantConversationSummary {
    const first = row.first_user_message_id
      ? this.message(candidateId, row.id, row.first_user_message_id)
      : null;
    const latest = this.latestSummary(candidateId, row.id);
    return {
      id: row.id,
      stage: row.stage,
      openedAt: row.opened_at,
      lastMessageAt: row.last_message_at,
      closedAt: row.closed_at,
      messageCount: row.message_count,
      firstPhrase: (first?.content ?? '').slice(0, 240),
      summary: latest?.summary ?? null,
    };
  }

  private latestSummary(candidateId: string, conversationId: string): { summary: string; createdAt: string } | null {
    const row = this.database
      .prepare('SELECT message_count, version, summary_cipher, created_at FROM consultant_summaries WHERE candidate_id = ? AND conversation_id = ? ORDER BY version DESC LIMIT 1')
      .get(candidateId, conversationId) as { message_count: number; version: number; summary_cipher: string; created_at: string } | undefined;
    if (!row) return null;
    return {
      summary: this.sealedText.open(row.summary_cipher,
        SUMMARY_ASSOCIATED_DATA(candidateId, conversationId, row.message_count, row.version)),
      createdAt: row.created_at,
    };
  }

  private readMessages(candidateId: string, conversationId: string): ConsultantConversationMessage[] {
    const rows = this.database
      .prepare(
        `SELECT cm.message_id AS id, cm.role, cm.created_at, m.body_cipher
         FROM consultant_conversation_messages cm
         JOIN messages m ON m.candidate_id = cm.candidate_id AND m.id = cm.message_id
         WHERE cm.candidate_id = ? AND cm.conversation_id = ? ORDER BY cm.ordinal`,
      )
      .all(candidateId, conversationId) as unknown as Array<{ id: string; role: CoachMessage['role']; created_at: string; body_cipher: string }>;
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: this.openMessage(candidateId, row.id, row.body_cipher),
      createdAt: row.created_at,
    }));
  }

  private message(candidateId: string, conversationId: string, messageId: string): CoachMessage | null {
    const row = this.database
      .prepare(
        `SELECT m.role, m.body_cipher FROM messages m
         JOIN consultant_conversation_messages cm
           ON cm.candidate_id = m.candidate_id AND cm.message_id = m.id
         WHERE m.candidate_id = ? AND cm.conversation_id = ? AND m.id = ?`,
      )
      .get(candidateId, conversationId, messageId) as { role: CoachMessage['role']; body_cipher: string } | undefined;
    return row ? { id: messageId, role: row.role, content: this.openMessage(candidateId, messageId, row.body_cipher) } : null;
  }

  private createConversation(candidateId: string, stage: CoachTurnStage, at: string): ConversationRow {
    const row: ConversationRow = {
      id: randomUUID(), stage, opened_at: at, last_message_at: at, closed_at: null,
      message_count: 0, first_user_message_id: null,
    };
    this.database.prepare(
      `INSERT INTO consultant_conversations (id, candidate_id, stage, opened_at, last_message_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(row.id, candidateId, stage, at, at);
    return row;
  }

  private close(row: ConversationRow, reason: 'stage_changed' | 'idle_timeout', at: string): ConsultantSummaryTask | null {
    this.database.prepare('UPDATE consultant_conversations SET closed_at = ?, close_reason = ? WHERE id = ? AND closed_at IS NULL')
      .run(at, reason, row.id);
    return row.message_count > 0
      ? { conversationId: row.id, stage: row.stage, messageCount: row.message_count }
      : null;
  }

  private activeConversation(candidateId: string): ConversationRow | null {
    const row = this.database
      .prepare('SELECT id, stage, opened_at, last_message_at, closed_at, message_count, first_user_message_id FROM consultant_conversations WHERE candidate_id = ? AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1')
      .get(candidateId) as ConversationRow | undefined;
    return row ?? null;
  }

  private getConversation(candidateId: string, conversationId: string): ConversationRow | null {
    const row = this.database
      .prepare('SELECT id, stage, opened_at, last_message_at, closed_at, message_count, first_user_message_id FROM consultant_conversations WHERE candidate_id = ? AND id = ?')
      .get(candidateId, conversationId) as ConversationRow | undefined;
    return row ?? null;
  }

  private attachMessage(
    candidateId: string,
    conversation: ConversationRow,
    messageId: string,
    role: CoachMessage['role'],
    cipher: string,
    createdAt: string,
  ): void {
    const ordinal = conversation.message_count + 1;
    const inserted = this.database.prepare(
      `INSERT OR IGNORE INTO consultant_conversation_messages
       (candidate_id, conversation_id, message_id, role, stage, created_at, ordinal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(candidateId, conversation.id, messageId, role, conversation.stage, createdAt, ordinal);
    if (inserted.changes === 0) return;
    const content = this.openMessage(candidateId, messageId, cipher);
    const terms = [...new Set(this.tokens(content).map((term) => this.sealedText.indexToken(candidateId, term)))];
    this.database.prepare(
      'INSERT INTO consultant_messages_fts (candidate_id, conversation_id, message_id, tokens) VALUES (?, ?, ?, ?)',
    ).run(candidateId, conversation.id, messageId, terms.join(' '));
    this.database.prepare(
      `UPDATE consultant_conversations
       SET last_message_at = ?, message_count = message_count + 1,
           first_user_message_id = CASE WHEN first_user_message_id IS NULL AND ? = 'user' THEN ? ELSE first_user_message_id END
       WHERE candidate_id = ? AND id = ?`,
    ).run(createdAt, role, messageId, candidateId, conversation.id);
    conversation.message_count += 1;
    conversation.last_message_at = createdAt;
    if (role === 'user' && !conversation.first_user_message_id) conversation.first_user_message_id = messageId;
  }

  private tokens(text: string): string[] {
    return text.toLocaleLowerCase('und').match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  }

  private openMessage(candidateId: string, messageId: string, cipher: string): string {
    return this.sealedText.open(cipher, messageAssociatedData(candidateId, messageId));
  }

  private encodeCursor(row: ConversationRow): string {
    return Buffer.from(JSON.stringify({ openedAt: row.opened_at, id: row.id }), 'utf8').toString('base64url');
  }

  private decodeCursor(value: string): { openedAt: string; id: string } {
    try {
      const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { openedAt?: unknown; id?: unknown };
      if (typeof decoded.openedAt === 'string' && typeof decoded.id === 'string') return { openedAt: decoded.openedAt, id: decoded.id };
    } catch {
      // The API maps invalid cursors to a stable client error.
    }
    throw new Error('invalid consultant history cursor');
  }
}
