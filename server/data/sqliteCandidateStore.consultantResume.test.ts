import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createCandidate, createStore, output, turnRequest } from './sqliteTestHarness';

const KEY_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const KEY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const KEY_C = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const MSG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const MSG_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const MSG_C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const OLD_AT = '2026-10-02T10:00:00.000Z';

type Store = ReturnType<typeof createStore>;

function ask(store: Store, candidateId: string, key: string, messageId: string, content: string, stage: 'today' | 'profile' = 'today') {
  const started = store.startTurn(candidateId, key, { ...turnRequest, messageId, content, stage });
  if (started.state !== 'ready') throw new Error('expected a ready turn');
  store.completeTurn(candidateId, key, output);
  return started;
}

function backdate(store: Store, conversationId: string) {
  const database = (store as unknown as { database: DatabaseSync }).database;
  database.prepare('UPDATE consultant_conversations SET last_message_at = ? WHERE id = ?').run(OLD_AT, conversationId);
}

describe('consultant conversations: new and continued (B688)', () => {
  it('«Новый разговор» closes the open conversation and the next question starts another', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    ask(store, candidate.id, KEY_A, MSG_A, 'Первый вопрос');
    const open = store.currentConsultantConversation(candidate.id, 'today');
    expect(open?.messages.map((message) => message.id)).toContain(MSG_A);

    expect(store.closeConsultantConversation(candidate.id)).toBe(open?.id);
    expect(store.currentConsultantConversation(candidate.id, 'today')).toBeNull();
    expect(store.listConsultantConversations(candidate.id).items.map((item) => item.id)).toEqual([open?.id]);
    expect(store.closeConsultantConversation(candidate.id)).toBeNull();

    const next = ask(store, candidate.id, KEY_B, MSG_B, 'Второй вопрос');
    expect(next.input.messages.map((message) => message.id)).toEqual([MSG_B]);
  });

  it('continues a closed conversation: the current one closes, the next question goes into it', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    ask(store, candidate.id, KEY_A, MSG_A, 'Про профиль', 'profile');
    const first = store.currentConsultantConversation(candidate.id, 'profile')!;
    store.closeConsultantConversation(candidate.id);
    backdate(store, first.id);
    ask(store, candidate.id, KEY_B, MSG_B, 'Про сегодня');
    const second = store.currentConsultantConversation(candidate.id, 'today')!;

    const resumed = store.resumeConsultantConversation(candidate.id, first.id);
    expect(resumed?.closedAt).toBeNull();
    expect(resumed?.messages.map((message) => message.id)).toContain(MSG_A);
    expect(store.getConsultantConversation(candidate.id, second.id)?.closedAt).not.toBeNull();
    // Продолжённый разговор открыт в любом разделе, хотя последняя реплика старая.
    expect(store.currentConsultantConversation(candidate.id, 'today')?.id).toBe(first.id);

    const next = ask(store, candidate.id, KEY_C, MSG_C, 'Продолжаю', 'profile');
    expect(next.input.messages.map((message) => message.id)).toEqual(expect.arrayContaining([MSG_A, MSG_C]));
    expect(store.listConsultantConversations(candidate.id).items.map((item) => item.id)).toEqual([second.id]);
  });

  it('B738: a continued conversation stays in the export with its summary, marked open', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    ask(store, candidate.id, KEY_A, MSG_A, 'Про профиль', 'profile');
    const first = store.currentConsultantConversation(candidate.id, 'profile')!;
    store.closeConsultantConversation(candidate.id);
    const [task] = store.listPendingConsultantSummaries(candidate.id);
    expect(store.saveConsultantSummary(candidate.id, task!, output)).toBe(true);
    store.resumeConsultantConversation(candidate.id, first.id);

    const exported = store.exportCandidate(candidate.id).consultantConversations;
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ id: first.id, closedAt: null, open: true });
    expect(exported[0]?.summaries).toHaveLength(1);
    expect(exported[0]?.messages.map((message) => message.id)).toContain(MSG_A);
  });

  it('does not reopen an open or missing conversation', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const other = createCandidate(store);
    ask(store, candidate.id, KEY_A, MSG_A, 'Вопрос');
    const open = store.currentConsultantConversation(candidate.id, 'today')!;
    expect(store.resumeConsultantConversation(candidate.id, open.id)).toBeNull();
    store.closeConsultantConversation(candidate.id);
    expect(store.resumeConsultantConversation(other.id, open.id)).toBeNull();
    expect(store.resumeConsultantConversation(candidate.id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBeNull();
  });

  it('does not show an idle or other-section conversation as current', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    ask(store, candidate.id, KEY_A, MSG_A, 'Вопрос', 'profile');
    expect(store.currentConsultantConversation(candidate.id, 'today')).toBeNull();
    const open = store.currentConsultantConversation(candidate.id, 'profile')!;
    backdate(store, open.id);
    expect(store.currentConsultantConversation(candidate.id, 'profile')).toBeNull();
  });
});
