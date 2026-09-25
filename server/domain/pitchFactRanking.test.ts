import { describe, expect, it } from 'vitest';
import { rankPitchFacts } from './pitchFactRanking';

describe('rankPitchFacts', () => {
  it('ставит релевантный опыт VP раньше сертификатов и навыков', () => {
    const facts = [
      { id: 'imp-c-cert-1', statement: 'ITIL 4 Foundation', domain: 'other' },
      { id: 'imp-c-cert-2', statement: 'Agile Fundamentals', domain: 'other' },
      { id: 'imp-c-cert-3', statement: 'AWS Fundamentals', domain: 'other' },
      { id: 'imp-c-skill-1', statement: 'Product strategy', domain: 'skill' },
      {
        id: 'imp-c-exp-2',
        statement: 'VP of Engineering — Infrastructure Group (2017 — 2020)',
        domain: 'role-evidence',
        updatedAt: '2020-12-31T00:00:00.000Z',
      },
      {
        id: 'imp-c-ach-1-1',
        statement: 'Led product and operations transformation across three business units',
        domain: 'outcome',
        updatedAt: '2024-12-31T00:00:00.000Z',
      },
      {
        id: 'imp-c-exp-1',
        statement: 'VP Product & Operations — Commerce Platform (2021 — present)',
        domain: 'role-evidence',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ] as const;

    const ranked = rankPitchFacts(facts, {
      title: 'Chief Product Technology Officer',
      description: 'Own product strategy, technology, and operations.',
    });

    expect(ranked.slice(0, 3).map((fact) => fact.id)).toEqual([
      'imp-c-exp-1',
      'imp-c-ach-1-1',
      'imp-c-exp-2',
    ]);
    expect(facts[0].id).toBe('imp-c-cert-1');
  });
});
