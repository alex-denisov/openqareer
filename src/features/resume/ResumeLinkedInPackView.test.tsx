import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResumeLinkedInPackView } from './ResumeLinkedInPackView';
import type { ResumeAssertion, ResumeDocument, ResumeDraft } from './resumeTypes';

function assertion<T extends string | boolean = string>(
  value: T,
  memoryId = 'mem-1'
): ResumeAssertion<T> {
  return {
    value,
    memoryId,
    sourceMessageIds: ['msg-1'],
    reviewFlags: [],
  };
}

const mockDraft: ResumeDraft = {
  candidate: {
    fullName: 'Елена Тарасова',
    about: 'Продуктовый лидер с 10+ годами опыта в высоконагруженных распределенных системах.',
    contact: {
      email: 'elena@example.com',
      location: 'Munich, Germany',
    },
  },
  targetRole: 'Technical Product Manager',
  experience: [
    {
      id: 'exp-1',
      chronologyMemoryId: 'mem-1',
      title: 'Technical Product Manager',
      employer: 'Kaspersky',
      startDate: '2021-10',
      endDate: '2024-08',
      current: false,
      bulletMemoryIds: ['mem-b1'],
    },
  ],
  skills: [
    { id: 's1', name: 'Product Roadmaps' },
    { id: 's2', name: 'Agile Methodology' },
    { id: 's3', name: 'Infrastructure Observability' },
  ],
  education: [],
  languages: [],
};

const mockDocument: ResumeDocument = {
  kind: 'master',
  targetRole: 'Technical Product Manager',
  about: 'Продуктовый лидер с 10+ годами опыта в высоконагруженных распределенных системах.',
  contact: {
    fullName: 'Елена Тарасова',
    email: 'elena@example.com',
    phone: '+49 1520 9733172',
    location: 'Munich, Germany',
    links: [],
  },
  experience: [
    {
      id: 'exp-1',
      title: assertion('Technical Product Manager'),
      employer: assertion('Kaspersky'),
      location: assertion('Munich'),
      startDate: assertion('2021-10'),
      endDate: assertion('2024-08'),
      current: assertion(false),
      bullets: [
        assertion('Внедрила автоматизацию DDoS mitigation, снизив время реакции до секунд.', 'mem-b1'),
      ],
    },
  ],
  skills: [
    { id: 's1', name: 'Product Roadmaps' },
    { id: 's2', name: 'Agile Methodology' },
    { id: 's3', name: 'Infrastructure Observability' },
  ],
  education: [],
  languages: [],
  unknowns: [],
  conventions: {
    country: null,
    packVersion: null,
    reverseChronological: true,
    maxPages: 2,
    recommendedBulletsPerRole: null,
    photo: 'omitted',
    discriminatoryPii: 'omitted',
  },
  length: { lines: 20, pages: 1, linesPerPage: 45 },
};

describe('ResumeLinkedInPackView', () => {
  it('renders headline section with character limit counter and copy button', () => {
    const html = renderToStaticMarkup(
      <ResumeLinkedInPackView document={mockDocument} draft={mockDraft} />,
    );

    expect(html).toMatch(/Заголовок профиля \(Headline\)/u);
    expect(html).toMatch(/\/ 220/u);
    expect(html).toMatch(/Копировать заголовок/u);
  });

  it('renders about section with character limit counter and copy button', () => {
    const html = renderToStaticMarkup(
      <ResumeLinkedInPackView document={mockDocument} draft={mockDraft} />,
    );

    expect(html).toMatch(/О себе \(About\)/u);
    expect(html).toMatch(/\/ 2600/u);
    expect(html).toMatch(/Копировать About/u);
    expect(html).toMatch(/Продуктовый лидер с 10\+ годами опыта/u);
  });

  it('renders experience section optimized for LinkedIn reading with copy button', () => {
    const html = renderToStaticMarkup(
      <ResumeLinkedInPackView document={mockDocument} draft={mockDraft} />,
    );

    expect(html).toMatch(/Опыт работы для LinkedIn/u);
    expect(html).toMatch(/Kaspersky/u);
    expect(html).toMatch(/Копировать опыт/u);
  });

  it('renders top skills for recruiter search with copy button', () => {
    const html = renderToStaticMarkup(
      <ResumeLinkedInPackView document={mockDocument} draft={mockDraft} />,
    );

    expect(html).toMatch(/Навыки для поиска \(Top Skills\)/u);
    expect(html).toMatch(/Product Roadmaps/u);
    expect(html).toMatch(/Agile Methodology/u);
    expect(html).toMatch(/Копировать навыки/u);
  });
});
