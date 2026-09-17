import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResumeAtsView } from './ResumeAtsView';
import type { CefrLevel, ResumeAssertion, ResumeDocument, ResumeDraft } from './resumeTypes';

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
    about: 'Опытный технический лидер и продуктовый менеджер.',
    contact: {
      email: 'elena@example.com',
      phone: '+49 1520 9733172',
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
    { id: 's2', name: 'Agile' },
  ],
  education: [
    {
      id: 'edu-1',
      evidenceMemoryId: 'mem-edu-1',
      institution: 'MATI',
      qualification: 'Engineer Degree',
      startDate: '2006',
      endDate: '2011',
    },
  ],
  languages: [
    {
      id: 'l1',
      evidenceMemoryId: 'mem-l1',
      name: 'English',
      cefr: 'C1',
    },
  ],
};

const mockDocument: ResumeDocument = {
  kind: 'master',
  targetRole: 'Technical Product Manager',
  about: 'Опытный технический лидер и продуктовый менеджер.',
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
        assertion('Автоматизировала систему защиты, снизив время реакции до секунд.', 'mem-b1'),
      ],
    },
  ],
  skills: [
    { id: 's1', name: 'Product Roadmaps' },
    { id: 's2', name: 'Agile' },
  ],
  education: [
    {
      id: 'edu-1',
      institution: assertion('MATI', 'mem-edu-1'),
      qualification: assertion('Engineer Degree', 'mem-edu-1'),
      startDate: assertion('2006', 'mem-edu-1'),
      endDate: assertion('2011', 'mem-edu-1'),
    },
  ],
  languages: [
    {
      id: 'l1',
      name: assertion('English', 'mem-l1'),
      cefr: assertion<CefrLevel>('C1', 'mem-l1'),
    },
  ],
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
  length: { lines: 30, pages: 1, linesPerPage: 45 },
};

describe('ResumeAtsView', () => {
  it('renders standard uppercase section markers for ATS parsers', () => {
    const html = renderToStaticMarkup(
      <ResumeAtsView document={mockDocument} draft={mockDraft} />,
    );

    expect(html).toMatch(/=== SUMMARY ===/u);
    expect(html).toMatch(/=== WORK EXPERIENCE ===/u);
    expect(html).toMatch(/=== SKILLS ===/u);
    expect(html).toMatch(/=== EDUCATION ===/u);
  });

  it('renders copy button and download txt button', () => {
    const html = renderToStaticMarkup(
      <ResumeAtsView document={mockDocument} draft={mockDraft} />,
    );

    expect(html).toMatch(/Копировать ATS-текст/u);
    expect(html).toMatch(/Скачать \.txt/u);
  });

  it('contains candidate facts formatted in monospace pre block', () => {
    const html = renderToStaticMarkup(
      <ResumeAtsView document={mockDocument} draft={mockDraft} />,
    );

    expect(html).toMatch(/ЕЛЕНА ТАРАСОВА/u);
    expect(html).toMatch(/Technical Product Manager/u);
    expect(html).toMatch(/Kaspersky/u);
    expect(html).toMatch(/career-resume-ats-pre/u);
  });
});
