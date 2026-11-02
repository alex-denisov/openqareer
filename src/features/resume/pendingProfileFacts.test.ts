import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import { pendingProfileFactCount } from './pendingProfileFacts';
import type { ResumeDraft } from './resumeTypes';

const fact = (id: string, status: string): CandidateMemory =>
  ({ id, kind: 'fact', status, statement: id }) as unknown as CandidateMemory;

const draft = {
  experience: [{ id: 'e1', chronologyMemoryId: 'c1', bulletMemoryIds: ['b1', 'b2'] }],
  education: [{ id: 'ed1', evidenceMemoryId: 'ed-fact' }],
} as unknown as ResumeDraft;

describe('pendingProfileFactCount', () => {
  it('counts proposed facts the profile shows, not chat facts outside it (owner, 02.11)', () => {
    const memory = [
      fact('b1', 'proposed'),
      fact('ed-fact', 'proposed'),
      fact('b2', 'confirmed'),
      fact('chat-only', 'proposed'),
    ];
    expect(pendingProfileFactCount(draft, memory)).toBe(2);
  });
});
