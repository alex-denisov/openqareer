import { describe, expect, it } from 'vitest';
import { carriesProfileSubstance, planResumeImport } from './resumeImport';
import { resumeDraftSchema } from './resumeDraft';
import { buildResumeStudioProjection } from './resumeStudio';
import type { ParsedResume } from '../../src/features/workspace/resumeParser';

function resume(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    fullName: 'Marina Orlova',
    targetRole: 'VP of Technology',
    about: 'Fifteen years in cloud and enterprise IT.',
    contact: {
      email: 'qa.candidate@example.test',
      phone: '+7 900 000 0000',
      telegram: '@marina_orlova',
      location: 'Dubai',
      links: ['https://www.linkedin.com/in/marina-orlova-qa'],
    },
    experience: [
      {
        title: 'VP of Technology & IT Operations',
        employer: 'Enterprise Energy IT Services',
        startDate: '2023-04',
        endDate: '2025-10',
        current: false,
        responsibilities: ['Rebuilt ITIL 4 processes across two divisions'],
        achievements: ['Grew combined revenue 4x'],
      },
    ],
    skills: ['ITIL', 'DevOps'],
    education: [
      {
        institution: 'Universitatea Tehnică a Moldovei',
        qualification: 'BE, Information Technology',
        endDate: '2010',
      },
    ],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [{ name: 'English', cefr: 'C1' }],
    rawText: 'raw',
    ...overrides,
  };
}

function evidenceFor(plan: ReturnType<typeof planResumeImport>) {
  return plan.evidence.map((item) => ({
    id: item.memoryId,
    kind: 'fact' as const,
    status: 'confirmed' as const,
    statement: item.statement,
    sourceMessageIds: ['import-message'],
    sensitive: false,
  }));
}

describe('planResumeImport', () => {
  it('produces a draft the resume schema accepts', () => {
    const plan = planResumeImport(resume(), { idPrefix: 'imp1' });

    expect(resumeDraftSchema.safeParse(plan.draft).success).toBe(true);
  });

  it('keeps every role, school and language once the evidence is stored', () => {
    const plan = planResumeImport(resume(), { idPrefix: 'imp1' });

    const projection = buildResumeStudioProjection({
      ...plan.draft,
      evidence: evidenceFor(plan),
    });

    expect(projection.master.experience).toHaveLength(1);
    expect(projection.master.experience[0].employer?.value).toBe(
      'Enterprise Energy IT Services',
    );
    expect(projection.master.experience[0].bullets).toHaveLength(2);
    expect(projection.master.education).toHaveLength(1);
    expect(projection.master.languages).toHaveLength(1);
    expect(projection.excludedEvidenceIds).toEqual([]);
  });

  it('records skills, headline, summary and location as dossier facts', () => {
    const plan = planResumeImport(resume(), { idPrefix: 'imp1' });
    const domains = plan.evidence.map((item) => item.domain);

    expect(domains).toContain('skill');
    expect(domains).toContain('role-evidence');
    expect(domains).toContain('constraint');
    expect(plan.evidence.map((item) => item.statement)).toContain('ITIL');
  });

  it('drops an address the extractor mangled rather than losing the import', () => {
    const plan = planResumeImport(
      resume({
        contact: {
          email: 'qa.candidate@example.test (Home)',
          links: [],
        },
      }),
      { idPrefix: 'imp1' },
    );

    expect(plan.draft.candidate.contact?.email).toBeUndefined();
    expect(resumeDraftSchema.safeParse(plan.draft).success).toBe(true);
  });

  it('clamps an over-long extraction instead of failing validation', () => {
    const plan = planResumeImport(
      resume({
        targetRole: 'x'.repeat(900),
        skills: ['y'.repeat(500)],
        experience: [
          {
            title: 'z'.repeat(600),
            employer: 'Company',
            current: true,
            responsibilities: Array.from({ length: 40 }, (_, i) => `Task ${i}`),
            achievements: ['Result'],
          },
        ],
      }),
      { idPrefix: 'imp1' },
    );

    expect(plan.draft.targetRole).toHaveLength(300);
    expect(plan.draft.experience[0].bulletMemoryIds.length).toBeLessThanOrEqual(20);
    expect(resumeDraftSchema.safeParse(plan.draft).success).toBe(true);
  });

  it('gives every generated id a schema-legal shape', () => {
    const plan = planResumeImport(resume(), { idPrefix: '///bad prefix///' });

    for (const entry of plan.draft.experience) {
      expect(entry.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u);
    }
    expect(resumeDraftSchema.safeParse(plan.draft).success).toBe(true);
  });

  it('carries courses, tests, recommendations and additional details across', () => {
    const plan = planResumeImport(
      resume({
        courses: [
          { name: 'ITIL 4 Foundation', institution: 'IT Expert', year: '2019' },
          { name: '   ', institution: 'ignored' },
        ],
        tests: [{ name: 'IELTS', provider: 'British Council', score: '7.5', year: '2021' }],
        recommendations: [
          { recommender: 'Степан Рукосуев', organization: 'Россети Цифра' },
        ],
        additional: {
          citizenship: 'Россия',
          workSchedule: 'полная занятость',
          relocation: 'готов',
          driversLicense: 'B',
        },
      }),
      { idPrefix: 'imp1' },
    );

    expect(plan.draft.courses).toHaveLength(1);
    expect(plan.draft.tests?.[0].score).toBe('7.5');
    expect(plan.draft.recommendations?.[0].organization).toBe('Россети Цифра');
    expect(plan.draft.additional?.driversLicense).toBe('B');
    expect(resumeDraftSchema.safeParse(plan.draft).success).toBe(true);
  });

  it('leaves punctuation out of the dossier instead of confirming it as a skill', () => {
    const plan = planResumeImport(
      resume({
        skills: ['. . . . .', '---', 'ITIL'],
        education: [{ institution: '. . . .' }],
        languages: [{ name: '—' }],
      }),
      { idPrefix: 'imp1' },
    );

    expect(plan.draft.skills?.map((item) => item.name)).toEqual(['ITIL']);
    expect(plan.draft.education).toEqual([]);
    expect(plan.draft.languages).toEqual([]);
  });

  it('knows a document with nothing but punctuation is not a resume', () => {
    expect(
      carriesProfileSubstance(
        resume({
          fullName: undefined,
          targetRole: undefined,
          about: undefined,
          experience: [],
          education: [{ institution: '. . . .' }],
          skills: ['. . . .'],
          languages: [],
        }),
      ),
    ).toBe(false);
  });

  it('accepts a thin but real resume that only lists skills', () => {
    expect(
      carriesProfileSubstance(
        resume({
          fullName: undefined,
          targetRole: undefined,
          about: undefined,
          experience: [],
          education: [],
          skills: ['ITIL', 'DevOps', 'Kubernetes'],
          languages: [],
        }),
      ),
    ).toBe(true);
  });

  it('drops an entry with neither title nor employer', () => {
    const plan = planResumeImport(
      resume({
        experience: [
          { title: '', employer: '', current: false, responsibilities: [], achievements: [] },
        ],
      }),
      { idPrefix: 'imp1' },
    );

    expect(plan.draft.experience).toEqual([]);
  });

  it('names a role the document left unnamed rather than storing a blank fact', () => {
    const plan = planResumeImport(
      resume({
        experience: [
          {
            title: '',
            employer: 'OptiLab AI',
            current: false,
            responsibilities: [],
            achievements: [],
          },
        ],
      }),
      { idPrefix: 'imp1' },
    );

    expect(plan.evidence[0].statement).toContain('Роль не названа');
  });

  it('marks an ongoing role as current and leaves its end date empty', () => {
    const plan = planResumeImport(
      resume({
        experience: [
          {
            title: 'Consultant',
            employer: 'OptiLab AI',
            startDate: '2025-11',
            current: true,
            responsibilities: [],
            achievements: [],
          },
        ],
      }),
      { idPrefix: 'imp1' },
    );

    expect(plan.draft.experience[0].current).toBe(true);
    expect(plan.draft.experience[0].endDate).toBeUndefined();
  });
});
