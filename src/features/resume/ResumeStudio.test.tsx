import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CandidateMemory } from '../coach/coachApi';
import { ResumeStudioSurface } from './ResumeStudio';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';

/**
 * The surface projects with the same engine the server runs, so these fixtures
 * are a draft plus dossier facts — never a hand-written projection that could
 * assert a document the engine would refuse to build.
 */
function memory(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    id: 'memory-1',
    kind: 'fact',
    domain: 'outcome',
    statement: 'Руководила операциями Example GmbH с 2022 года.',
    confidence: 'candidate-confirmed',
    sourceMessageIds: ['message-7'],
    sensitive: false,
    status: 'confirmed',
    ...overrides,
  };
}

const emptyDraft: ResumeDraft = {
  candidate: {},
  experience: [],
  education: [],
  languages: [],
};

const populatedDraft: ResumeDraft = {
  candidate: {
    fullName: 'Елена Тарасова',
    contact: { email: 'elena@example.com', links: [] },
  },
  targetRole: 'Operations Manager',
  experience: [
    {
      id: 'entry-1',
      chronologyMemoryId: 'memory-1',
      title: 'Руководитель операций',
      employer: 'Example GmbH',
      startDate: '2022-01',
      current: true,
      bulletMemoryIds: ['memory-42'],
    },
  ],
  education: [],
  languages: [],
};

const populatedMemory: CandidateMemory[] = [
  memory(),
  memory({
    id: 'memory-42',
    statement: 'Сократила цикл поставки на 30% без снижения контроля качества.',
    sourceMessageIds: ['message-9'],
  }),
];

function viewOf(overrides: Partial<ResumeStudioView> = {}): ResumeStudioView {
  return {
    draft: null,
    savedAt: null,
    // The surface recomputes both documents; only freshness and savedAt are read
    // from the server response, so an empty projection here is honest.
    projection: {
      master: emptyDocumentPlaceholder(),
      germanyVariant: emptyDocumentPlaceholder(),
      evidenceSnapshot: [],
      excludedEvidenceIds: [],
    },
    evidenceFreshness: { valid: true, stale: [] },
    ...overrides,
  };
}

function emptyDocumentPlaceholder() {
  return {
    kind: 'master' as const,
    targetRole: null,
    contact: { fullName: null, email: null, phone: null, location: null, links: [] },
    experience: [],
    education: [],
    languages: [],
    unknowns: [],
    conventions: {
      country: null,
      packVersion: null,
      reverseChronological: false,
      maxPages: null,
      recommendedBulletsPerRole: null,
      photo: 'omitted' as const,
      discriminatoryPii: 'omitted' as const,
    },
    length: { lines: 2, pages: 1, linesPerPage: 45 },
  };
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe('ResumeStudioSurface', () => {
  it('names every unknown instead of leaving a silent gap', () => {
    const html = render(
      <ResumeStudioSurface view={viewOf()} draft={emptyDraft} memory={[]} />,
    );
    expect(html).toMatch(/Укажите имя для заголовка резюме/u);
    expect(html).toMatch(/Добавьте хотя бы одну подтверждённую роль с датами/u);
    expect(html).toMatch(/Добавьте язык и подтверждённый уровень CEFR/u);
    expect(html).toMatch(/Уточнить/u);
  });

  it('keeps the provenance of every generated bullet visible', () => {
    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={populatedDraft}
        memory={populatedMemory}
      />,
    );
    expect(html).toMatch(/Сократила цикл поставки на 30%/u);
    expect(html).toMatch(/memory-42/u);
    expect(html).toMatch(/Требует подтверждения/u);
  });

  it('reflects an unsaved edit at once rather than waiting for the next save', () => {
    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={populatedDraft}
        memory={populatedMemory}
      />,
    );
    expect(html).toMatch(/Елена Тарасова/u);
    expect(html).not.toMatch(/Укажите имя для заголовка резюме/u);
  });

  it('states the German conventions the document actually follows', () => {
    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={populatedDraft}
        memory={populatedMemory}
        regions={['eu']}
        initialVariant="germany"
      />,
    );
    expect(html).toMatch(/Германия/u);
    expect(html).toMatch(/обратная хронология/iu);
    expect(html).toMatch(/2 страниц/u);
    expect(html).toMatch(/без фото/iu);
    expect(html).toMatch(/DE-CV-2026\.1/u);
  });

  it('does not offer a country pack to a candidate who never chose that region (B158)', () => {
    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={populatedDraft}
        memory={populatedMemory}
        regions={['ru']}
        initialVariant="germany"
      />,
    );

    expect(html).not.toMatch(/Германия/u);
    expect(html).not.toMatch(/DE-CV-2026\.1/u);
    expect(html).toMatch(/Мастер-резюме/u);
  });

  it('warns when approved evidence stopped being confirmed', () => {
    const view = viewOf({
      evidenceFreshness: {
        valid: false,
        stale: [{ memoryId: 'memory-42', reasons: ['missing', 'statement-changed'] }],
      },
    });
    const html = render(
      <ResumeStudioSurface view={view} draft={emptyDraft} memory={[]} />,
    );
    expect(html).toMatch(/memory-42/u);
    expect(html).toMatch(/отозван/iu);
  });

  it('reports evidence the engine refused rather than dropping it quietly', () => {
    const draft: ResumeDraft = {
      ...populatedDraft,
      experience: [
        { ...populatedDraft.experience[0]!, bulletMemoryIds: ['memory-unconfirmed'] },
      ],
    };
    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={draft}
        memory={[
          memory(),
          memory({ id: 'memory-unconfirmed', status: 'proposed' }),
        ]}
      />,
    );
    expect(html).toMatch(/memory-unconfirmed/u);
    expect(html).toMatch(/не попал/iu);
  });

  it('offers only evidence the engine accepts in the picker', () => {
    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={emptyDraft}
        memory={[
          memory({ id: 'ok', statement: 'Подтверждённый факт.' }),
          memory({ id: 'proposed', statement: 'Непринятый факт.', status: 'proposed' }),
        ]}
        onDraftChange={() => undefined}
      />,
    );
    expect(html).toMatch(/Подтверждённый факт/u);
    expect(html).not.toMatch(/Непринятый факт/u);
  });

  it('shows a loading state instead of an empty resume', () => {
    const html = render(<ResumeStudioSurface loading />);
    expect(html).toMatch(/Загружаем/iu);
    expect(html).not.toMatch(/Мастер-резюме<\/h2>/u);
  });

  it('shows the failure and a way to retry', () => {
    const html = render(
      <ResumeStudioSurface error="Сеть недоступна." onRetry={() => undefined} />,
    );
    expect(html).toMatch(/Сеть недоступна/u);
    expect(html).toMatch(/Повторить/u);
  });

  it('offers both variants as an explicit switch once the candidate chose the EU region', () => {
    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={emptyDraft}
        memory={[]}
        regions={['eu']}
      />,
    );
    expect(html).toMatch(/Мастер/u);
    expect(html).toMatch(/Германия/u);
  });

  it('renders all full resume sections: about, photo, telegram, skills, courses, tests, and recommendations', () => {
    const richDraft: ResumeDraft = {
      ...populatedDraft,
      candidate: {
        ...populatedDraft.candidate,
        about: 'Опытный технологический лидер с фокусом на масштабирование.',
        photoUrl: 'https://example.com/photo.jpg',
        contact: {
          ...populatedDraft.candidate.contact,
          telegram: '@techlead',
          phone: '+7 999 123-45-67',
          location: 'Москва, Россия',
        },
      },
      skills: [
        { id: 'skill-1', name: 'TypeScript' },
        { id: 'skill-2', name: 'Product Management' },
      ],
      courses: [
        {
          id: 'course-1',
          name: 'Executive Leadership',
          provider: 'Stanford Online',
          year: 2023,
        },
      ],
      tests: [
        {
          id: 'test-1',
          name: 'IELTS Academic',
          provider: 'British Council',
          score: '8.5',
          year: 2024,
        },
      ],
      recommendations: [
        {
          id: 'rec-1',
          author: 'Александр Смирнов',
          role: 'CTO Example Corp',
          text: 'Выдающийся руководитель и сильный инженер.',
        },
      ],
    };

    const html = render(
      <ResumeStudioSurface
        view={viewOf()}
        draft={richDraft}
        memory={populatedMemory}
      />,
    );

    expect(html).toMatch(/Опытный технологический лидер/u);
    expect(html).toMatch(/@techlead/u);
    expect(html).toMatch(/TypeScript/u);
    expect(html).toMatch(/Product Management/u);
    expect(html).toMatch(/Executive Leadership/u);
    expect(html).toMatch(/Stanford Online/u);
    expect(html).toMatch(/IELTS Academic/u);
    expect(html).toMatch(/8\.5/u);
    expect(html).toMatch(/Александр Смирнов/u);
    expect(html).toMatch(/CTO Example Corp/u);
  });
});
