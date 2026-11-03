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
  it('one strong quote backs any number of requirements in full (owner 02.11, was two)', () => {
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
      'matched',
    ]);
    expect(result.coveragePercent).toBe(100);
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
    expect(result.coveragePercent).toBe(79);
  });
});

describe('fit accuracy audit (owner 02.11)', () => {
  it('a quote from the skills list of a place is a tag: it alone meets a requirement partially', () => {
    const input = fitInput();
    const place = {
      ...input.facts[0],
      id: 'profile:experience:e1',
      statement: 'VP Operations — Acme; led support; навыки: Linux, Kubernetes',
      evidenceSource: 'profile' as const,
    };
    const result = evaluateVacancyFit({
      ...input,
      checkedFactIds: [],
      facts: [...input.facts, place],
      assessments: [
        { requirementId: 'r1', status: 'matched', evidence: [{ factId: place.id, quote: 'Linux' }] },
        { requirementId: 's2', status: 'matched', evidence: [{ factId: place.id, quote: 'led support' }] },
        { requirementId: 's3', status: 'matched', evidence: [{ factId: 'f1', quote: 'SQL' }] },
      ],
    });
    expect(result.assessments.map((item) => item.status)).toEqual(['partial', 'matched', 'matched']);
  });

  it('a location quote backs only a location condition: elsewhere it is dropped and the claim is unknown', () => {
    const input = fitInput();
    const location = {
      ...input.facts[0],
      id: 'impe12a7b15ff-location',
      status: 'proposed' as const,
      statement: 'Dubai, United Arab Emirates',
    };
    const result = evaluateVacancyFit({
      ...input,
      description: `${input.description} Must be located within the US.`,
      facts: [...input.facts, location],
      requirements: [
        ...input.requirements,
        { ...skill('c1', 'Must be located within the US'), skill: false },
      ],
      assessments: [
        { requirementId: 'r1', status: 'unmatched', evidence: [{ factId: location.id, quote: 'Dubai' }] },
        {
          requirementId: 's2',
          status: 'matched',
          evidence: [
            { factId: location.id, quote: 'Dubai' },
            { factId: 'f1', quote: 'Node' },
          ],
        },
        { requirementId: 's3', status: 'matched', evidence: [{ factId: 'f1', quote: 'SQL' }] },
        { requirementId: 'c1', status: 'unmatched', evidence: [{ factId: location.id, quote: 'Dubai' }] },
      ],
    });
    const byId = new Map(result.assessments.map((item) => [item.requirementId, item]));
    expect(['r1', 's2', 's3', 'c1'].map((id) => byId.get(id)?.status)).toEqual(['unknown', 'matched', 'matched', 'unmatched']);
    expect(byId.get('s2')?.evidence).toEqual([{ factId: 'f1', quote: 'Node' }]);
  });

  it('generic skill tags of a job board are no requirements of the percent', () => {
    const input = fitInput();
    const tags = ['Critical Thinking', 'Emotional Intelligence', 'Communication', 'AI Proficiency'];
    const result = evaluateVacancyFit({
      ...input,
      description: `${input.description} ${tags.join(' ')}`,
      requirements: [
        ...input.requirements,
        ...tags.map((text, index) => ({ ...skill(`t${index}`, text), origin: 'structural' as const, label: text, skill: true })),
      ],
    });
    expect(result.coverage.total).toBe(3);
    expect(result.assessments.map((item) => item.requirementId)).toEqual(['r1', 's2', 's3']);
  });

  it('a sentence that names communication stays a requirement', () => {
    const input = fitInput();
    const text = 'Strong verbal and written communication skills';
    const result = evaluateVacancyFit({
      ...input,
      description: `${input.description} ${text}`,
      requirements: [...input.requirements, { ...skill('t1', text), label: 'Communication', skill: true }],
    });
    expect(result.coverage.total).toBe(4);
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

describe('a location line is judged by the search conditions, not the profile city (03.11)', () => {
  // Prod 03.11, hh 138955968 for adenisov.test: the profile says Dubai (set for Dubai recruiters),
  // the search places are Москва, Удалённо из РФ, ОАЭ. The office line was «unmatched» by Dubai.
  const office = 'Работа из офиса в Москве, график 5/2, 09:00–18:00';
  const dubai = (input: ReturnType<typeof fitInput>) => ({
    ...input.facts[0],
    id: 'profile:location',
    statement: 'Местоположение: Dubai, United Arab Emirates',
    evidenceSource: 'profile' as const,
  });
  const officeInput = (placeCovered?: boolean) => {
    const input = fitInput();
    const location = dubai(input);
    return {
      ...input,
      description: `${input.description} ${office}`,
      facts: [...input.facts, location],
      requirements: [...input.requirements, { ...skill('c1', office), kind: 'workFormat' as const }],
      assessments: [
        ...input.assessments!,
        { requirementId: 'c1', status: 'unmatched' as const, evidence: [{ factId: location.id, quote: 'Dubai, United Arab Emirates' }] },
      ],
      ...(placeCovered === undefined ? {} : { placeCovered }),
    };
  };

  it('search places that cover the vacancy meet the line: no block, counted as met, the stored claim kept', () => {
    const before = evaluateVacancyFit(officeInput());
    expect(before.conditionBlocks).toEqual([{ requirementId: 'c1', text: office, quote: 'Dubai, United Arab Emirates' }]);
    expect(before.conditionCoverage).toMatchObject({ matched: 0, total: 1 });

    const after = evaluateVacancyFit(officeInput(true));
    expect(after.coveragePercent).toBe(100);
    expect(after.conditionBlocks).toEqual([]);
    expect(after.placeCovered).toEqual(['c1']);
    expect(after.conditionCoverage).toMatchObject({ matched: 1, total: 1 });
    // A cached result is read again without a model call: its assessments must stay as stored.
    expect(after.assessments).toEqual(before.assessments);
  });

  it('a location line the model left unknown is met as well', () => {
    const input = officeInput(true);
    const result = evaluateVacancyFit({
      ...input,
      assessments: [...fitInput().assessments!, { requirementId: 'c1', status: 'unknown', evidence: [] }],
    });
    expect(result.placeCovered).toEqual(['c1']);
    expect(result.conditionCoverage).toMatchObject({ matched: 1, total: 1 });
  });

  it('search places that miss the vacancy keep the verdict; without places the profile city decides', () => {
    expect(evaluateVacancyFit(officeInput(false)).conditionBlocks).toHaveLength(1);
    expect(evaluateVacancyFit(officeInput(false)).placeCovered).toBeUndefined();
    expect(evaluateVacancyFit(officeInput()).placeCovered).toBeUndefined();
  });

  it('a covered place is no work permit and no education', () => {
    const input = fitInput();
    const location = dubai(input);
    const result = evaluateVacancyFit({
      ...input,
      description: `${input.description} Right to work in Russia. Bachelor degree.`,
      facts: [...input.facts, location],
      requirements: [
        ...input.requirements,
        { ...skill('c1', 'Right to work in Russia'), kind: 'workAuthorization' as const },
        { ...skill('c2', 'Bachelor degree'), kind: 'education' as const },
      ],
      assessments: [
        ...input.assessments!,
        { requirementId: 'c1', status: 'unmatched', evidence: [{ factId: location.id, quote: 'Dubai, United Arab Emirates' }] },
        { requirementId: 'c2', status: 'unknown', evidence: [] },
      ],
      placeCovered: true,
    });
    expect(result.placeCovered).toBeUndefined();
    expect(result.conditionBlocks).toHaveLength(1);
  });
});
