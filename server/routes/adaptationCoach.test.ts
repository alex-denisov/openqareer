import { describe, expect, it } from 'vitest';
import { scopeAdaptationKnowledge } from './adaptationCoach';
import type { CoachTurnInput } from '../domain/coach';

describe('B357 relevant confirmed evidence', () => {
  it('includes explicit work evidence without transferring unrelated or sensitive facts', () => {
    const fact = { ref: 'memory:one', kind: 'fact' as const, domain: 'outcome' as const, statement: 'В Норма Групп согласован план запуска', sourceRefs: ['message-1'], sensitive: false, source: 'confirmed' as const };
    const knowledge: NonNullable<CoachTurnInput['knowledgeContext']> = { confirmedFacts: [fact,
      { ...fact, ref: 'memory:other', statement: 'Результат в другой компании' },
      { ...fact, ref: 'memory:private', sensitive: true },
      { ...fact, ref: 'memory:unconfirmed', source: 'imported' },
      { ...fact, ref: 'memory:linked', statement: 'Согласован критерий готовности', sourceRefs: ['experience:experience-1'] },
    ], documents: [], openQuestions: [] };
    const scoped = scopeAdaptationKnowledge(knowledge, JSON.stringify({ company: 'Норма Групп', sourceExperienceId: 'experience-1' }));
    expect(scoped.confirmedFacts.map(item => item.ref)).toEqual(['memory:one', 'memory:linked']);
    expect(scoped.documents).toEqual([]);
  });
  it('uses honest unknowns if evidence cannot be associated with the selected work', () => {
    const knowledge: NonNullable<CoachTurnInput['knowledgeContext']> = { confirmedFacts: [], documents: [], openQuestions: [] };
    expect(scopeAdaptationKnowledge(knowledge, 'invalid-context').confirmedFacts).toEqual([]);
  });
});
