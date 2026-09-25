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

  it('оставляет одну копию факта, повторённого разными импортами', () => {
    // Прод 25.09: три импорта LinkedIn дали три копии «Co-Founder & COO» с разным форматом дат.
    const facts = [
      {
        id: 'imp33a5fdc156-exp-4',
        statement: 'Co-Founder & COO — Fishance (Jul 2016 — Oct 2019).',
        domain: 'role-evidence',
        updatedAt: '2026-09-20T00:00:00.000Z',
      },
      {
        id: 'impb545a1a59d-exp-4',
        statement: 'Co-Founder & COO — Fishance · 3 yrs 4 mos',
        domain: 'role-evidence',
        updatedAt: '2026-09-25T00:00:00.000Z',
      },
      {
        id: 'impeebbeb2c85-exp-4',
        statement: 'Co-Founder & COO (2016-07 — 2019-10)',
        domain: 'role-evidence',
        updatedAt: '2026-09-22T00:00:00.000Z',
      },
      {
        id: 'impeebbeb2c85-exp-5',
        statement: 'Co-Founder & COO — second venture',
        domain: 'role-evidence',
      },
      {
        id: 'impeebbeb2c85-exp-1',
        statement: 'VP of Technology — Enterprise Energy',
        domain: 'role-evidence',
      },
    ];

    const ranked = rankPitchFacts(facts, { title: 'Chief Operating Officer' });

    expect(ranked.map((fact) => fact.id).sort()).toEqual([
      'impb545a1a59d-exp-4',
      'impeebbeb2c85-exp-1',
      'impeebbeb2c85-exp-5',
    ]);
  });

  it('убирает один и тот же текст под разными хвостами идентификатора', () => {
    // Прод 25.09: «Drove CSAT from 23% to 68%…» пришёл как resp-3-2 и как ach-3-1.
    const statement = 'Drove CSAT from 23% to 68% and FCR from 5% to 83%.';
    const facts = [
      { id: 'imp33a5fdc156-resp-3-2', statement, domain: 'responsibility' },
      { id: 'impb545a1a59d-ach-3-1', statement: ` ${statement.toUpperCase()} `, domain: 'outcome' },
      {
        id: 'imp33a5fdc156-resp-3-4',
        statement: 'Modernized the support stack.',
        domain: 'responsibility',
      },
    ];

    expect(rankPitchFacts(facts, { title: 'SVP' })).toHaveLength(2);
  });
});
