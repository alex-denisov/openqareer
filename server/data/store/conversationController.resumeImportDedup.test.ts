import { describe, expect, it } from 'vitest';
import { createCandidate, createStore } from '../sqliteTestHarness';

/**
 * B247 S6: re-importing the same document must not add a second
 * "Импорт: ..." message to the Consultant's conversation history. Facts are
 * already replaced by id on reimport (B162); the message announcing the
 * import used to be inserted unconditionally on every call, so a retried
 * import wizard step or a re-parsed resume doubled the history line.
 */
describe('ConversationController.importResumeEvidence dedup (B247 S6)', () => {
  function evidence(overrides: { sourceDigest?: string; statement?: string } = {}) {
    return {
      sourceLabel: 'Импорт: PDF-резюме «resume.pdf»',
      sourceDigest: overrides.sourceDigest ?? 'digest-a'.repeat(8),
      entries: [
        {
          memoryId: `fact-${Math.random().toString(36).slice(2)}`,
          domain: 'outcome' as const,
          statement: overrides.statement ?? 'Запустил продукт и сократил срок релиза.',
        },
      ],
    };
  }

  it('reuses one message for two imports carrying the same source digest', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    store.importResumeEvidence(candidate.id, evidence());
    store.importResumeEvidence(candidate.id, evidence());

    const messages = store
      .getSnapshot(candidate.id)
      .messages.filter((message) => message.content.startsWith('Импорт:'));
    expect(messages).toHaveLength(1);
  });

  it('updates the existing message content on reimport instead of inserting a new one', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    const first = store.importResumeEvidence(candidate.id, evidence());
    const second = store.importResumeEvidence(
      candidate.id,
      evidence({ statement: 'Обновлённая формулировка после повторного разбора.' }),
    );

    expect(second.messageId).toBe(first.messageId);
    const messages = store.getSnapshot(candidate.id).messages;
    expect(messages.filter((message) => message.id === first.messageId)).toHaveLength(1);
  });

  it('still inserts a separate message when the document digest differs', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    store.importResumeEvidence(candidate.id, evidence({ sourceDigest: 'digest-a'.repeat(8) }));
    store.importResumeEvidence(candidate.id, evidence({ sourceDigest: 'digest-b'.repeat(8) }));

    const messages = store
      .getSnapshot(candidate.id)
      .messages.filter((message) => message.content.startsWith('Импорт:'));
    expect(messages).toHaveLength(2);
  });

  it('does not duplicate facts when the same digest reimport reuses the message id', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    store.importResumeEvidence(candidate.id, evidence());
    store.importResumeEvidence(candidate.id, evidence());

    const memory = store.getSnapshot(candidate.id).memory;
    expect(memory).toHaveLength(1);
  });

  it('keeps a candidate-confirmed fact when the same document is reimported', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    const imported = store.importResumeEvidence(candidate.id, evidence());
    store.changeMemory(candidate.id, imported.memoryIds[0], { action: 'confirm' });

    store.importResumeEvidence(candidate.id, evidence({ statement: 'Другая формулировка.' }));

    const memory = store.getSnapshot(candidate.id).memory;
    expect(memory.find((item) => item.id === imported.memoryIds[0])?.status).toBe('confirmed');
  });
});
