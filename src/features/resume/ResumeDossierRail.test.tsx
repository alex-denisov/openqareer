import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import { ResumeDossierRail } from './ResumeDossierRail';
import type { ResumeDocument, ResumeDraft, ResumeEvidenceFreshness } from './resumeTypes';

const mockDraft: ResumeDraft = {
  candidate: { fullName: 'Елена Тарасова' },
  targetRole: 'Product Manager',
  experience: [
    {
      id: 'exp-1',
      chronologyMemoryId: 'mem-exp-1',
      title: 'Senior Product Manager',
      employer: 'TechCorp',
      startDate: '2022-01',
      current: true,
      bulletMemoryIds: ['mem-bullet-1'],
    },
  ],
  skills: [{ id: 'skill-1', name: 'Product Management' }],
  education: [],
  languages: [],
};

const mockDocument: ResumeDocument = {
  kind: 'master',
  targetRole: 'Product Manager',
  contact: { fullName: 'Елена Тарасова', email: 'elena@example.com', phone: null, location: null, links: [] },
  experience: [],
  education: [],
  languages: [],
  unknowns: [
    {
      code: 'missing-education',
      message: 'Укажите высшее или профессиональное образование',
      scope: 'both',
      blocking: true,
    },
    {
      code: 'missing-language-level',
      message: 'Укажите подтверждённый уровень языка',
      scope: 'both',
      blocking: false,
    },
  ],
  conventions: {
    country: null,
    packVersion: null,
    reverseChronological: true,
    maxPages: 2,
    recommendedBulletsPerRole: { min: 3, max: 5 },
    photo: 'omitted',
    discriminatoryPii: 'omitted',
  },
  length: { lines: 25, pages: 1, linesPerPage: 45 },
};

const mockMemory: CandidateMemory[] = [
  {
    id: 'mem-exp-1',
    kind: 'fact',
    domain: 'outcome',
    statement: 'Руководила продуктовой командой из 12 инженеров в TechCorp.',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['msg-1'],
    sensitive: false,
    status: 'confirmed',
  },
  {
    id: 'import-hh-skill-1',
    kind: 'fact',
    domain: 'skill',
    statement: 'Agile, Scrum, Roadmap planning, Data-Driven decision making',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['hh-msg-1'],
    sensitive: false,
    status: 'confirmed',
  },
  {
    id: 'import-linkedin-edu-1',
    kind: 'fact',
    domain: 'other',
    statement: 'МГТУ им. Баумана, Информационные системы, 2018',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['linkedin-msg-2'],
    sensitive: false,
    status: 'confirmed',
  },
  {
    id: 'mem-lang-1',
    kind: 'fact',
    domain: 'other',
    statement: 'Английский язык уровень C1 Advanced',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['msg-3'],
    sensitive: false,
    status: 'confirmed',
  },
];

const mockFreshness: ResumeEvidenceFreshness = {
  valid: true,
  stale: [],
};

describe('ResumeDossierRail', () => {
  it('renders fact filter tabs with category counts', () => {
    const html = renderToStaticMarkup(
      <ResumeDossierRail
        memory={mockMemory}
        draft={mockDraft}
        document={mockDocument}
        freshness={mockFreshness}
        excludedEvidenceIds={[]}
      />,
    );

    expect(html).toMatch(/Все/u);
    expect(html).toMatch(/Опыт/u);
    expect(html).toMatch(/Навыки/u);
    expect(html).toMatch(/Образование/u);
    expect(html).toMatch(/Языки/u);
  });

  it('renders fact cards with statements, provenance badges and usage status', () => {
    const html = renderToStaticMarkup(
      <ResumeDossierRail
        memory={mockMemory}
        draft={mockDraft}
        document={mockDocument}
        freshness={mockFreshness}
        excludedEvidenceIds={[]}
      />,
    );

    // Statements
    expect(html).toMatch(/Руководила продуктовой командой/u);
    expect(html).toMatch(/Agile, Scrum/u);

    // Provenance badges
    expect(html).toMatch(/hh\.ru/u);
    expect(html).toMatch(/LinkedIn/u);
    expect(html).toMatch(/Диалог с консультантом/u);

    // Usage status
    expect(html).toMatch(/В резюме/u);
    expect(html).toMatch(/Доступно для добавления/u);
  });

  it('integrates unknowns block with blocking status', () => {
    const html = renderToStaticMarkup(
      <ResumeDossierRail
        memory={mockMemory}
        draft={mockDraft}
        document={mockDocument}
        freshness={mockFreshness}
        excludedEvidenceIds={[]}
      />,
    );

    expect(html).toMatch(/Уточнить \(2\)/u);
    expect(html).toMatch(/Укажите высшее или профессиональное образование/u);
    expect(html).toMatch(/блокирует/u);
  });

  it('displays warnings for stale facts and excluded evidence', () => {
    const staleFreshness: ResumeEvidenceFreshness = {
      valid: false,
      stale: [{ memoryId: 'mem-exp-1', reasons: ['statement-changed'] }],
    };

    const html = renderToStaticMarkup(
      <ResumeDossierRail
        memory={mockMemory}
        draft={mockDraft}
        document={mockDocument}
        freshness={staleFreshness}
        excludedEvidenceIds={['import-hh-skill-1']}
      />,
    );

    expect(html).toMatch(/Требует обновления/u);
    expect(html).toMatch(/Не попало в документ/u);
  });

  it('integrates target vacancies block and imported source block when present', () => {
    const html = renderToStaticMarkup(
      <ResumeDossierRail
        memory={mockMemory}
        draft={mockDraft}
        document={mockDocument}
        freshness={mockFreshness}
        excludedEvidenceIds={[]}
        importedSource={{
          platform: 'hh',
          label: 'hh.ru',
          importedAt: '2026-08-27T09:30:00.000Z',
          factCount: 4,
        }}
      />,
    );

    expect(html).toMatch(/Подбор вакансий|Целевые вакансии/u);
    expect(html).toMatch(/Что дал источник/u);
  });
});
