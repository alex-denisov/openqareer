import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import { partitionProfileMemory } from './CareerProfileSurface';

const memory = (
  id: string,
  kind: CandidateMemory['kind'],
  status: CandidateMemory['status'],
): CandidateMemory => ({
  id,
  kind,
  domain: kind === 'open-question' ? 'gap' : 'outcome',
  statement: id,
  confidence: kind === 'open-question' ? 'coach-hypothesis' : 'candidate-reported',
  sourceMessageIds: ['message-1'],
  sensitive: false,
  status,
});

describe('compact profile memory partition', () => {
  it('keeps open questions out of both factual confirmation groups', () => {
    const result = partitionProfileMemory([
      memory('confirmed-result', 'fact', 'confirmed'),
      memory('proposed-result', 'fact', 'proposed'),
      memory('open-question', 'open-question', 'proposed'),
    ]);

    expect(result.confirmedFacts.map((item) => item.id)).toEqual(['confirmed-result']);
    expect(result.proposedFacts.map((item) => item.id)).toEqual(['proposed-result']);
    expect(result.openQuestions.map((item) => item.id)).toEqual(['open-question']);
  });
});
