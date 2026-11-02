import { describe, expect, it } from 'vitest';
import type {
  ResumeAssertion,
  ResumeDocument,
  ResumeExperience,
} from './resumeStudioTypes';
import { buildResumeAtsAssessment } from './resumeAtsAssessment';

function fact<Value extends string | boolean = string>(
  value: Value,
  memoryId: string,
): ResumeAssertion<Value> {
  return {
    value,
    memoryId,
    sourceMessageIds: ['source-' + memoryId],
    reviewFlags: [],
  };
}

function experience(
  id: string,
  start: string | null,
  end: string | null,
  current: boolean,
  bullets: readonly string[],
): ResumeExperience {
  return {
    id,
    title: fact('Platform Engineer', id + '-title'),
    employer: fact('Example Systems', id + '-employer'),
    location: null,
    startDate: start ? fact(start, id + '-start') : null,
    endDate: end ? fact(end, id + '-end') : null,
    current: fact(current, id + '-current'),
    bullets: bullets.map((value, index) => fact(value, id + '-bullet-' + index)),
  };
}

function makeDocument(
  roles: readonly ResumeExperience[] = [
    experience(
      'platform-role',
      '2020-01',
      '2024-03',
      false,
      ['Built Kubernetes services and PostgreSQL data pipelines.'],
    ),
  ],
): ResumeDocument {
  return {
    kind: 'master',
    targetRole: 'Platform Engineer',
    contact: {
      fullName: 'Ada Example',
      email: 'ada@example.test',
      phone: null,
      location: 'Helsinki',
      links: [],
    },
    about: 'Platform engineer focused on reliable services.',
    experience: roles,
    skills: [
      { id: 'skill-kubernetes', name: 'Kubernetes' },
      { id: 'skill-postgres', name: 'PostgreSQL' },
    ],
    education: [
      {
        id: 'education-1',
        institution: fact('Example University', 'education-school'),
        qualification: fact('BSc', 'education-qualification'),
        startDate: fact('2015', 'education-start'),
        endDate: fact('2019', 'education-end'),
      },
    ],
    projects: [],
    languages: [],
    unknowns: [],
    conventions: {
      country: null,
      packVersion: null,
      reverseChronological: true,
      maxPages: null,
      recommendedBulletsPerRole: null,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    },
    length: { lines: 20, pages: 1, linesPerPage: 45 },
  };
}

const requirementSource = {
  kind: 'candidate_input' as const,
  label: 'Platform Engineer vacancy requirements',
  capturedAt: '2026-10-17T10:00:00.000Z',
};

const evaluatedAt = '2026-10-17T10:05:00.000Z';

describe('buildResumeAtsAssessment', () => {
  it('calculates each dimension from the resume and sourced requirements', () => {
    const result = buildResumeAtsAssessment({
      document: makeDocument(),
      atsText: [
        'ADA EXAMPLE',
        'Platform Engineer',
        'ada@example.test',
        '=== WORK EXPERIENCE ===',
        'Platform Engineer | Example Systems',
        '2020-01 - 2024-03',
        '- Built Kubernetes services and PostgreSQL data pipelines.',
        '=== EDUCATION ===',
        'Example University | BSc | 2015 - 2019',
        '=== SKILLS ===',
        'Kubernetes, PostgreSQL',
      ].join('\n'),
      requirements: ['Kubernetes', 'Terraform', 'Ansible'],
      requirementSource,
      resumeUpdatedAt: '2026-10-17T09:30:00.000Z',
      resumeSourceRevision: 'opaque-resume-revision',
      evaluatedAt,
    });

    expect(result.total).toEqual({ score: 80, maximum: 100, status: 'measured' });
    expect(result.dimensions).toMatchObject({
      structure: { score: 25, maximum: 25, sampleSize: 5, status: 'measured' },
      keywords: {
        score: 10,
        maximum: 30,
        sampleSize: 3,
        status: 'measured',
        matched: 1,
        required: 3,
        matchedRequirements: ['Kubernetes'],
        unmatchedRequirements: ['Terraform', 'Ansible'],
        evidence: [
          {
            requirement: 'Kubernetes',
            matches: [
              {
                field: 'Опыт: пункт',
                text: 'Built Kubernetes services and PostgreSQL data pipelines.',
              },
              { field: 'Навыки', text: 'Kubernetes' },
            ],
          },
          { requirement: 'Terraform', matches: [] },
          { requirement: 'Ansible', matches: [] },
        ],
      },
      dates: { score: 20, maximum: 20, sampleSize: 1, status: 'measured' },
      format: { score: 25, maximum: 25, status: 'measured' },
    });
    expect(result.evaluatedAt).toBe(evaluatedAt);
    expect(result.context.resumeUpdatedAt).toBe('2026-10-17T09:30:00.000Z');
    expect(result.context.resumeSourceRevision).toBe('opaque-resume-revision');
    expect(result.context.requirementSource).toEqual(requirementSource);
    expect(result.disclaimer).toMatch(/не гарантирует прохождение/u);
  });

  it('keeps the keyword dimension and total unknown without sourced requirements', () => {
    const result = buildResumeAtsAssessment({
      document: makeDocument(),
      atsText: 'ADA EXAMPLE\n=== WORK EXPERIENCE ===',
      requirements: [],
      requirementSource: null,
      resumeUpdatedAt: null,
      evaluatedAt,
    });

    const { structure, dates, format } = result.dimensions;
    const measured = [structure, dates, format];
    expect(result.total).toEqual({
      score: measured.reduce((sum, item) => sum + (item.score ?? 0), 0),
      maximum: measured.reduce((sum, item) => sum + item.maximum, 0),
      status: 'partial',
    });
    expect(result.total.maximum).toBeLessThan(100);
    expect(result.dimensions.keywords).toMatchObject({
      score: null,
      maximum: 30,
      sampleSize: 0,
      status: 'unknown',
      source: 'Нет проверенных требований вакансии',
    });
    expect(result.dimensions.structure.status).toBe('measured');
    expect(result.dimensions.dates.status).toBe('measured');
    expect(result.dimensions.format.status).toBe('measured');
    expect(result.context.requirementSource).toBeNull();
  });

  it('treats whitespace-only requirements as missing input', () => {
    const result = buildResumeAtsAssessment({
      document: makeDocument(),
      atsText: 'ADA EXAMPLE\n=== WORK EXPERIENCE ===',
      requirements: [' ', '\n\t'],
      requirementSource,
      resumeUpdatedAt: null,
      evaluatedAt,
    });

    expect(result.dimensions.keywords.status).toBe('unknown');
    expect(result.dimensions.keywords.sampleSize).toBe(0);
    expect(result.total).toMatchObject({ status: 'partial', maximum: 70 });
  });

  it('reports missing experience dates and empty ATS text as unknown samples', () => {
    const result = buildResumeAtsAssessment({
      document: makeDocument([
        experience('undated', null, null, false, ['Maintained services.']),
      ]),
      atsText: '',
      requirements: ['Maintained services'],
      requirementSource,
      resumeUpdatedAt: null,
      evaluatedAt,
    });

    expect(result.dimensions.dates).toMatchObject({
      score: 0,
      sampleSize: 1,
      status: 'measured',
    });
    expect(result.dimensions.format).toMatchObject({
      score: null,
      sampleSize: 0,
      status: 'unknown',
    });
    expect(result.total.status).toBe('partial');
    expect(result.total.maximum).toBe(45);
  });

  it('uses whole normalized phrases and reports matching terms and source fields', () => {
    const candidateDocument: ResumeDocument = {
      ...makeDocument([
        experience(
          'platform-role',
          '2020-01',
          '2024-03',
          false,
          ['Built JavaScript clients and NoSQL services.'],
        ),
      ]),
      skills: [
        { id: 'skill-js', name: 'JavaScript' },
        { id: 'skill-nosql', name: 'NoSQL' },
      ],
    };
    const result = buildResumeAtsAssessment({
      document: candidateDocument,
      atsText: 'ADA EXAMPLE\n=== WORK EXPERIENCE ===\nBuilt JavaScript clients and NoSQL services.',
      requirements: ['Java', 'JavaScript', 'SQL', 'NoSQL'],
      requirementSource,
      resumeUpdatedAt: null,
      evaluatedAt,
    });

    expect(result.dimensions.keywords).toMatchObject({
      score: 15,
      matchedRequirements: ['JavaScript', 'NoSQL'],
      unmatchedRequirements: ['Java', 'SQL'],
      evidence: [
        {
          requirement: 'Java',
          matches: [],
        },
        {
          requirement: 'JavaScript',
          matches: [
            { field: 'Опыт: пункт', text: 'Built JavaScript clients and NoSQL services.' },
            { field: 'Навыки', text: 'JavaScript' },
          ],
        },
        {
          requirement: 'SQL',
          matches: [],
        },
        {
          requirement: 'NoSQL',
          matches: [
            { field: 'Опыт: пункт', text: 'Built JavaScript clients and NoSQL services.' },
            { field: 'Навыки', text: 'NoSQL' },
          ],
        },
      ],
    });
  });

  describe('cross-language keywords and minimum sample', () => {
    const englishDocument: ResumeDocument = {
      ...makeDocument([
        experience('exec-role', '2018-01', '2024-03', false, [
          'Led a team of 40 engineers across three countries.',
        ]),
      ]),
      skills: [{ id: 'skill-tl', name: 'Team Leadership' }],
    };
    const run = (requirements: readonly string[]) =>
      buildResumeAtsAssessment({
        document: englishDocument,
        atsText: 'ADA EXAMPLE',
        requirements,
        requirementSource,
        resumeUpdatedAt: null,
        evaluatedAt,
      }).dimensions.keywords;

    it('matches a Russian dictionary requirement against English facts', () => {
      const keywords = run(['Управление командой', 'Kubernetes', 'Terraform']);
      expect(keywords.status).toBe('measured');
      expect(keywords.matchedRequirements).toEqual(['Управление командой']);
      expect(keywords.evidence?.[0]?.matches).toEqual([
        { field: 'Опыт: пункт', text: 'Led a team of 40 engineers across three countries.' },
        { field: 'Навыки', text: 'Team Leadership' },
      ]);
    });

    it('still needs an exact match for terms outside the dictionary', () => {
      const keywords = run(['Квантовая запутанность', 'Terraform', 'Ansible']);
      expect(keywords.matched).toBe(0);
      expect(keywords.score).toBe(0);
    });

    it('is unknown below three distinct requirements but keeps evidence', () => {
      const result = buildResumeAtsAssessment({
        document: englishDocument,
        atsText: 'ADA EXAMPLE',
        requirements: ['Управление командой', 'управление  командой!', 'Terraform'],
        requirementSource,
        resumeUpdatedAt: null,
        evaluatedAt,
      });
      const keywords = result.dimensions.keywords;
      expect(keywords).toMatchObject({
        status: 'unknown',
        score: null,
        sampleSize: 2,
        matchedRequirements: ['Управление командой'],
        unmatchedRequirements: ['Terraform'],
        summary: 'Недостаточно требований для оценки: нужно хотя бы 3, сейчас 2.',
      });
      expect(keywords.evidence).toHaveLength(2);
      expect(result.total.status).toBe('partial');
    });

    it('is measured from three requirements', () => {
      const keywords = run(['Управление командой', 'Terraform', 'Ansible']);
      expect(keywords).toMatchObject({ status: 'measured', score: 10, sampleSize: 3 });
    });
  });

  it('does not treat the target-role header as keyword evidence by itself', () => {
    const document: ResumeDocument = {
      ...makeDocument([]),
      about: '',
      skills: [],
      education: [],
      targetRole: 'Platform Engineer',
    };
    const result = buildResumeAtsAssessment({
      document,
      atsText: 'ADA EXAMPLE\\nPlatform Engineer',
      requirements: ['Platform Engineer', 'Terraform', 'Ansible'],
      requirementSource,
      resumeUpdatedAt: null,
      evaluatedAt,
    });

    expect(result.dimensions.keywords).toMatchObject({
      score: 0,
      matched: 0,
      unmatchedRequirements: ['Platform Engineer', 'Terraform', 'Ansible'],
      evidence: expect.arrayContaining([{ requirement: 'Platform Engineer', matches: [] }]),
    });
  });

  it('is deterministic for the same resume, context, and evaluation time', () => {
    const input = {
      document: makeDocument(),
      atsText: 'ADA EXAMPLE\n=== WORK EXPERIENCE ===',
      requirements: ['Kubernetes'],
      requirementSource,
      resumeUpdatedAt: null,
      evaluatedAt,
    };

    expect(buildResumeAtsAssessment(input)).toEqual(buildResumeAtsAssessment(input));
  });
});
