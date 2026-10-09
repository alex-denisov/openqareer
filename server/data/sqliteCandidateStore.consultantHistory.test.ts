import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CoachProviderResult } from '../providers/coachProvider';
import { createCandidate, createStore, output, turnRequest } from './sqliteTestHarness';

const FIRST_MESSAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const FIRST_TURN_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const SECOND_MESSAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const SECOND_TURN_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const OLD_AT = '2026-10-02T10:00:00.000Z';

function assistantAnswer(message: string): CoachProviderResult {
  return {
    ...output,
    result: { ...output.result, message, memoryCandidates: [], nextQuestion: null },
  };
}

function backdateOpenConversation(store: ReturnType<typeof createStore>, candidateId: string) {
  const database = (store as unknown as { database: DatabaseSync }).database;
  const row = database
    .prepare('SELECT id FROM consultant_conversations WHERE candidate_id = ? AND closed_at IS NULL')
    .get(candidateId) as { id: string };
  database
    .prepare('UPDATE consultant_conversations SET last_message_at = ? WHERE id = ?')
    .run(OLD_AT, row.id);
  database
    .prepare('UPDATE consultant_conversation_messages SET created_at = ? WHERE conversation_id = ?')
    .run(OLD_AT, row.id);
  database
    .prepare(
      `UPDATE messages SET created_at = ? WHERE candidate_id = ? AND id IN (
         SELECT message_id FROM consultant_conversation_messages WHERE conversation_id = ?
       )`,
    )
    .run(OLD_AT, candidateId, row.id);
  return row.id;
}

describe('SQLite consultant conversation history (B436)', () => {
  it('uses a week-old conversation through FTS and closes it once on section change', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const firstText = 'Я внедрил Kafka и сократил задержку платежей до 20 мс.';
    const first = store.startTurn(candidate.id, FIRST_TURN_KEY, {
      ...turnRequest,
      messageId: FIRST_MESSAGE_ID,
      content: firstText,
      stage: 'profile',
    });
    expect(first.state).toBe('ready');
    store.completeTurn(candidate.id, FIRST_TURN_KEY, assistantAnswer('Зафиксировали миграцию Kafka.'));
    const firstConversationId = backdateOpenConversation(store, candidate.id);

    const next = store.startTurn(candidate.id, SECOND_TURN_KEY, {
      ...turnRequest,
      messageId: SECOND_MESSAGE_ID,
      content: 'Какую задержку удалось получить после миграции?',
      stage: 'career',
    });
    expect(next.state).toBe('ready');
    if (next.state !== 'ready') throw new Error('expected a new ready turn');
    expect(next.closedConversations).toEqual([
      { conversationId: firstConversationId, messageCount: 2, stage: 'profile' },
    ]);
    expect(next.input.messages).toEqual([
      {
        id: SECOND_MESSAGE_ID,
        role: 'user',
        content: 'Какую задержку удалось получить после миграции?',
      },
    ]);
    expect(next.input.knowledgeContext.consultantHistory?.messageSnippets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'profile',
          content: expect.stringContaining('20 мс'),
          createdAt: OLD_AT,
        }),
      ]),
    );

    const database = (store as unknown as { database: DatabaseSync }).database;
    const indexed = database
      .prepare('SELECT tokens FROM consultant_messages_fts WHERE candidate_id = ? AND conversation_id = ?')
      .get(candidate.id, firstConversationId) as { tokens: string };
    expect(indexed.tokens.split(' ')).not.toContain('Kafka');
    expect(indexed.tokens.split(' ')).not.toContain('20');
  });

  it('waits for in-flight turns before scheduling the closed conversation summary', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const first = store.startTurn(candidate.id, FIRST_TURN_KEY, {
      ...turnRequest,
      messageId: FIRST_MESSAGE_ID,
      content: 'Ход пока ожидает ответа модели.',
      stage: 'profile',
    });
    const next = store.startTurn(candidate.id, SECOND_TURN_KEY, {
      ...turnRequest,
      messageId: SECOND_MESSAGE_ID,
      content: 'Новый раздел, отдельная беседа.',
      stage: 'career',
    });
    expect(first.state).toBe('ready');
    expect(next.state).toBe('ready');
    if (next.state !== 'ready') throw new Error('expected a new ready turn');
    expect(next.closedConversations).toEqual([]);
    expect(store.listPendingConsultantSummaries(candidate.id)).toEqual([]);

    store.completeTurn(candidate.id, FIRST_TURN_KEY, assistantAnswer('Ответ по старому разделу.'));
    expect(store.listPendingConsultantSummaries(candidate.id)).toEqual([
      expect.objectContaining({ stage: 'profile', messageCount: 2 }),
    ]);
  });

  it('deleting a conversation removes it from read history, summaries and FTS', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const otherCandidate = createCandidate(store);
    store.startTurn(candidate.id, FIRST_TURN_KEY, {
      ...turnRequest,
      messageId: FIRST_MESSAGE_ID,
      content: 'Секретная фраза для удаления из истории.',
      stage: 'profile',
    });
    store.completeTurn(candidate.id, FIRST_TURN_KEY, assistantAnswer('Что решили по этому вопросу.'));
    const conversationId = backdateOpenConversation(store, candidate.id);
    expect(store.getConsultantConversation(otherCandidate.id, conversationId)).toBeNull();
    const next = store.startTurn(candidate.id, SECOND_TURN_KEY, {
      ...turnRequest,
      messageId: SECOND_MESSAGE_ID,
      content: 'Новый вопрос в другом разделе.',
      stage: 'career',
    });
    expect(next.state).toBe('ready');
    if (next.state !== 'ready' || !next.closedConversations?.[0]) {
      throw new Error('expected the previous conversation to close');
    }
    store.saveConsultantSummary(
      candidate.id,
      next.closedConversations[0],
      assistantAnswer('Что выяснили: было решение о запуске. Что решили: продолжать. Что осталось открытым: метрика.'),
    );
    const detail = store.getConsultantConversation(candidate.id, conversationId);
    expect(detail?.summary).toBeTruthy();

    expect(store.deleteConsultantConversation(candidate.id, conversationId)).toBe(true);
    expect(store.getConsultantConversation(candidate.id, conversationId)).toBeNull();
    expect(
      store.listConsultantConversations(candidate.id, { limit: 20 }).items,
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: conversationId })]));
    const database = (store as unknown as { database: DatabaseSync }).database;
    expect(
      database.prepare('SELECT 1 FROM consultant_messages_fts WHERE conversation_id = ?').get(conversationId),
    ).toBeUndefined();
    expect(
      database.prepare('SELECT 1 FROM consultant_summaries WHERE conversation_id = ?').get(conversationId),
    ).toBeUndefined();
    const afterDelete = store.startTurn(candidate.id, 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', {
      ...turnRequest,
      messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      content: 'Вспомни секретную фразу для удаления из истории.',
      stage: 'responses',
    });
    expect(afterDelete.state).toBe('ready');
    if (afterDelete.state !== 'ready') throw new Error('expected a new ready turn');
    expect(JSON.stringify(afterDelete.input.knowledgeContext.consultantHistory ?? null)).not.toContain(
      'Секретная фраза',
    );
  });

  it('exports closed history and clears FTS before account cascade deletion', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    store.startTurn(candidate.id, FIRST_TURN_KEY, {
      ...turnRequest,
      messageId: FIRST_MESSAGE_ID,
      content: 'Экспортируемый опыт с PostgreSQL.',
      stage: 'profile',
    });
    store.completeTurn(candidate.id, FIRST_TURN_KEY, assistantAnswer('Проверили результат PostgreSQL.'));
    const closedId = backdateOpenConversation(store, candidate.id);
    const next = store.startTurn(candidate.id, SECOND_TURN_KEY, {
      ...turnRequest,
      messageId: SECOND_MESSAGE_ID,
      content: 'Новый карьерный вопрос.',
      stage: 'career',
    });
    expect(next.state).toBe('ready');
    expect(store.exportCandidate(candidate.id).consultantConversations[0]?.id).toBe(closedId);

    const database = (store as unknown as { database: DatabaseSync }).database;
    expect(database.prepare('SELECT 1 FROM consultant_messages_fts WHERE candidate_id = ?').get(candidate.id)).toBeTruthy();
    expect(store.deleteCandidate(candidate.id)).toBe(true);
    expect(database.prepare('SELECT 1 FROM consultant_messages_fts WHERE candidate_id = ?').get(candidate.id)).toBeUndefined();
    expect(database.prepare('SELECT 1 FROM consultant_conversations WHERE candidate_id = ?').get(candidate.id)).toBeUndefined();
  });
});
