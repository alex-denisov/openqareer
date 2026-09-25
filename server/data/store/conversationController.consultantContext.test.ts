import { describe, expect, it } from 'vitest';
import { createCandidate, createStore, turnRequest } from '../sqliteTestHarness';

/**
 * B266 S3: the consultant asked a candidate with a fully imported LinkedIn
 * profile to describe their experience, and its history showed «Вы: Импорт: …»
 * bubbles. Imported facts are known context; import announcements are events.
 */
describe('consultant turn context (B266 S3)', () => {
  function importProfile(store: ReturnType<typeof createStore>, candidateId: string) {
    store.importResumeEvidence(candidateId, {
      sourceLabel: 'Импорт: профиль LinkedIn',
      sourceDigest: 'digest-li'.repeat(7),
      entries: [
        {
          memoryId: 'imp0123456789-exp-1',
          domain: 'outcome' as const,
          statement: 'VP of Technology & IT Operations в Enterprise Energy, 2023–2025.',
        },
        {
          memoryId: 'imp0123456789-skill-1',
          domain: 'outcome' as const,
          statement: 'Навык: P&L Management.',
        },
      ],
    });
  }

  it('gives the model the imported profile as known, flagged facts', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    importProfile(store, candidate.id);

    const turn = store.startTurn(candidate.id, '51df5f57-df61-4ac2-98af-202609250001', turnRequest);
    if (turn.state !== 'ready') throw new Error('expected ready turn');

    const facts = turn.input.knowledgeContext.confirmedFacts;
    expect(facts.map((fact) => fact.statement)).toContain(
      'VP of Technology & IT Operations в Enterprise Energy, 2023–2025.',
    );
    expect(facts.every((fact) => fact.source === 'imported')).toBe(true);
  });

  it('never sends an import announcement to the model as a candidate turn', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    importProfile(store, candidate.id);

    const turn = store.startTurn(candidate.id, '51df5f57-df61-4ac2-98af-202609250002', turnRequest);
    if (turn.state !== 'ready') throw new Error('expected ready turn');

    expect(turn.input.messages.some((message) => message.content.startsWith('Импорт:'))).toBe(false);
  });
});
