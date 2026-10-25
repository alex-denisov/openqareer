import { describe, expect, it } from 'vitest';
import { coachTurnResultSchema } from '../../domain/coach';
import { withStoredMemoryCap } from './storedTurnMemoryCap';

const candidate = (index: number) => ({
  kind: 'fact',
  domain: 'outcome',
  statement: `Факт ${index}`,
  confidence: 'candidate-reported',
  sourceMessageIds: ['message-1'],
  sensitive: false,
});

describe('withStoredMemoryCap (26.10)', () => {
  it('lets a stored turn with more than 20 candidates be read again', () => {
    const stored = {
      message: 'Ответ',
      phase: 'evidence',
      memoryCandidates: Array.from({ length: 34 }, (_, index) => candidate(index)),
      nextQuestion: null,
      completeness: { known: [], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [],
    };
    expect(coachTurnResultSchema.safeParse(stored).success).toBe(false);
    const parsed = coachTurnResultSchema.parse(withStoredMemoryCap(stored));
    expect(parsed.memoryCandidates).toHaveLength(20);
    expect(parsed.memoryCandidates[0].statement).toBe('Факт 0');
  });

  it('leaves a valid record untouched', () => {
    const stored = { memoryCandidates: [candidate(1)] };
    expect(withStoredMemoryCap(stored)).toBe(stored);
  });
});
