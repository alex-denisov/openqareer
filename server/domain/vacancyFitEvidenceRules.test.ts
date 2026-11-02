import { describe, expect, it } from 'vitest';
import { evaluateVacancyFit } from './vacancyFit';
import { fitInput } from './vacancyFit.test';
import { vacancyFitEvidenceFacts } from './vacancyFitProfileEvidence';

const skill = (id: string, text: string) => ({
  id,
  text,
  sourceQuote: text,
  origin: 'explicit' as const,
  importance: 'high' as const,
  kind: 'other' as const,
  hard: false,
  stopFactor: false,
});

describe('evidence quality (02.11)', () => {
  it('one quote backs at most two requirements in full; a third use counts partial, never «нет в профиле» (02.11 owner)', () => {
    const input = fitInput();
    const evidence = [{ factId: 'f1', quote: 'TypeScript services' }];
    const result = evaluateVacancyFit({
      ...input,
      assessments: ['r1', 's2', 's3'].map((requirementId) => ({
        requirementId,
        status: 'matched' as const,
        evidence,
      })),
    });
    expect(result.assessments.map((item) => item.status)).toEqual([
      'matched',
      'matched',
      'partial',
    ]);
    expect(result.assessments[2]!.evidence).toEqual(evidence);
  });

  it('many-to-many: a requirement with one fresh quote stays matched though another quote is used up', () => {
    const input = fitInput();
    const shared = { factId: 'f1', quote: 'TypeScript services' };
    const fresh = { factId: 'f1', quote: 'TypeScript' };
    const result = evaluateVacancyFit({
      ...input,
      assessments: [
        { requirementId: 'r1', status: 'matched' as const, evidence: [shared] },
        { requirementId: 's2', status: 'matched' as const, evidence: [shared] },
        { requirementId: 's3', status: 'matched' as const, evidence: [shared, fresh] },
      ],
    });
    expect(result.assessments.map((item) => item.status)).toEqual(['matched', 'matched', 'matched']);
  });

  it('a bare profile tag meets a requirement at most partially', () => {
    const input = fitInput();
    const tag = {
      ...input.facts[0],
      id: 'profile:skill:s1',
      statement: 'Executive Leadership',
      evidenceSource: 'profile' as const,
    };
    const result = evaluateVacancyFit({
      ...input,
      checkedFactIds: [],
      facts: [...input.facts, tag],
      assessments: [
        {
          requirementId: 'r1',
          status: 'matched',
          evidence: [{ factId: tag.id, quote: 'Executive Leadership' }],
        },
        { requirementId: 's2', status: 'matched', evidence: [{ factId: 'f1', quote: 'Node' }] },
        { requirementId: 's3', status: 'matched', evidence: [{ factId: 'f1', quote: 'SQL' }] },
      ],
    });
    expect(result.assessments[0].status).toBe('partial');
    expect(result.coveragePercent).toBe(83);
  });
});

describe('conditions the profile clearly does not meet (02.11)', () => {
  it('lists a contradicted work authorisation as a block and keeps the skill percent', () => {
    const input = fitInput();
    const location = {
      ...input.facts[0],
      id: 'profile:location',
      statement: 'Местоположение: Vilnius, Lithuania',
      evidenceSource: 'profile' as const,
    };
    const result = evaluateVacancyFit({
      ...input,
      description: `${input.description} US work authorization required. Bachelor degree.`,
      facts: [...input.facts, location],
      requirements: [
        ...input.requirements,
        { ...skill('c1', 'US work authorization required'), kind: 'workAuthorization' as const },
        { ...skill('c2', 'Bachelor degree'), kind: 'education' as const },
      ],
      assessments: [
        ...input.assessments!,
        {
          requirementId: 'c1',
          status: 'unmatched',
          evidence: [{ factId: location.id, quote: 'Vilnius, Lithuania' }],
        },
        { requirementId: 'c2', status: 'unknown', evidence: [] },
      ],
    });
    expect(result.coveragePercent).toBe(100);
    expect(result.conditionBlocks).toEqual([
      { requirementId: 'c1', text: 'US work authorization required', quote: 'Vilnius, Lithuania' },
    ]);
  });

  it('an unknown condition is no block', () => {
    expect(evaluateVacancyFit(fitInput()).conditionBlocks ?? []).toEqual([]);
  });
});

describe('profile evidence carries what experience says (02.11)', () => {
  const memory = (id: string, statement: string) => ({
    id,
    kind: 'fact',
    status: 'proposed',
    statement,
    sourceMessageIds: ['m'],
    sensitive: false,
  });
  const snapshot = {
    memory: [
      memory('b1', 'P&L ownership for a 40 M EUR business line'),
      memory('d1', 'VP Operations over 250 people'),
    ],
    resume: {
      draft: {
        candidate: { contact: { location: 'Vilnius, Lithuania' } },
        experience: [
          {
            id: 'e1',
            chronologyMemoryId: 'c1',
            title: 'VP Operations',
            employer: 'Acme',
            current: true,
            bulletMemoryIds: ['b1'],
            descriptionMemoryId: 'd1',
            skills: Array.from({ length: 60 }, (_, i) => `Skill${i}`),
          },
        ],
        skills: [],
        education: [],
        languages: [],
      },
    },
  } as never;

  it('includes the description and bullets of a place, before its skill tags, and the location', () => {
    const facts = vacancyFitEvidenceFacts('cand', snapshot);
    const place = facts.find((fact) => fact.id === 'profile:experience:e1')!.statement;
    expect(place).toContain('P&L ownership');
    expect(place).toContain('250 people');
    expect(place.indexOf('P&L')).toBeLessThan(place.indexOf('Skill0'));
    expect(facts.find((fact) => fact.id === 'profile:location')?.statement).toContain('Lithuania');
  });
});
