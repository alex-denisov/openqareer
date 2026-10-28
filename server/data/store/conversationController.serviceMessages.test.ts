import { describe, expect, it } from 'vitest';
import { createCandidate, createStore, output } from '../sqliteTestHarness';
import { messageKind } from './messageKind';

const FACT = 'Образование / Учебное заведение: МГУ / Начало: 2008-09';

function storeWithServiceRecords() {
  const store = createStore();
  const candidate = createCandidate(store);
  store.addManualExperienceFact(candidate.id, 'manual-fact-education', FACT);
  store.connectNativeSourceOnly(
    candidate.id,
    {
      platform: 'linkedin',
      accessMode: 'native_session_snapshot',
      sourceUrl: 'https://www.linkedin.com/in/synthetic-candidate-731/',
      capturedAt: '2026-10-28T12:00:00.000Z',
      importDigest: 'a'.repeat(64),
    },
    'Подключено: LinkedIn',
  );
  const key = '51df5f57-df61-4ac2-98af-202610280001';
  store.startTurn(candidate.id, key, {
    messageId: '51df5f57-df61-4ac2-98af-202610280002',
    content: 'С чего начать поиск?',
    phase: 'discovery',
    stage: 'today',
  });
  store.completeTurn(candidate.id, key, output);
  return { store, candidate };
}

describe('messageKind', () => {
  it('reads a user row as dialogue only when a turn owns it', () => {
    const turnMessageIds = new Set(['turn-message']);
    expect(messageKind({ id: 'turn-message', role: 'user' }, turnMessageIds)).toBe('dialogue');
    expect(messageKind({ id: 'fact-message', role: 'user' }, turnMessageIds)).toBe('service');
    expect(messageKind({ id: 'reply', role: 'assistant' }, turnMessageIds)).toBe('dialogue');
  });
});

describe('consultant feed hides service records (block A recheck 28.10)', () => {
  it('shows only the dialogue in the today and profile feeds', () => {
    const { store, candidate } = storeWithServiceRecords();
    for (const stage of ['today', 'profile'] as const) {
      const contents = store.getMessages(candidate.id, stage).map((message) => message.content);
      expect(contents).not.toContain(FACT);
      expect(contents).not.toContain('Подключено: LinkedIn');
    }
    const today = store.getMessages(candidate.id, 'today').map((message) => message.content);
    expect(today).toEqual(['С чего начать поиск?', output.result.message]);
  });

  it('keeps service records out of the staged snapshot the panel reads', () => {
    const { store, candidate } = storeWithServiceRecords();
    const contents = store.getSnapshot(candidate.id, 'today').messages.map((m) => m.content);
    expect(contents).not.toContain(FACT);
    expect(contents).not.toContain('Подключено: LinkedIn');
  });

  it('loses no data: the unstaged snapshot and export still hold service records', () => {
    const { store, candidate } = storeWithServiceRecords();
    const contents = store.getSnapshot(candidate.id).messages.map((m) => m.content);
    expect(contents).toContain(FACT);
    expect(contents).toContain('Подключено: LinkedIn');
  });

  it('still hands the profile fact to the consultant model as context', () => {
    const { store, candidate } = storeWithServiceRecords();
    const turn = store.startTurn(candidate.id, '51df5f57-df61-4ac2-98af-202610280003', {
      messageId: '51df5f57-df61-4ac2-98af-202610280004',
      content: 'Что дальше?',
      phase: 'discovery',
      stage: 'today',
    });
    if (turn.state !== 'ready') throw new Error('expected ready turn');
    const facts = turn.input.knowledgeContext?.confirmedFacts.map((fact) => fact.statement);
    expect(facts).toContain(FACT);
  });
});
