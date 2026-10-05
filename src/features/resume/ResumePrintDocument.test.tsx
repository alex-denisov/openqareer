import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResumePrintDocument } from './ResumePrintDocument';
import type { ResumeAssertion, ResumeDocument, ResumeDraft } from './resumeTypes';

function assertion<T extends string | boolean = string>(value: T): ResumeAssertion<T> {
  return { value, memoryId: 'mem-1', sourceMessageIds: ['msg-1'], reviewFlags: [] };
}

const draft: ResumeDraft = {
  candidate: {
    fullName: 'Елена Тарасова',
    about: 'Технический лидер.',
    contact: { email: 'elena@example.com', location: 'Munich' },
  },
  targetRole: 'Product Manager',
  experience: [],
  skills: [],
  education: [],
  languages: [],
};

const document: ResumeDocument = {
  kind: 'master',
  targetRole: 'Product Manager',
  about: 'Технический лидер.',
  contact: {
    fullName: 'Елена Тарасова',
    email: 'elena@example.com',
    phone: null,
    location: 'Munich',
    links: [],
  },
  experience: [
    {
      id: 'e1',
      title: assertion('Technical Product Manager'),
      employer: assertion('Kaspersky'),
      location: null,
      startDate: assertion('2021-10'),
      endDate: assertion('2024-08'),
      current: assertion(false),
      bullets: [assertion('Снизила время реакции.'), assertion('  ')],
    },
    {
      id: 'e2',
      title: null,
      employer: null,
      location: null,
      startDate: null,
      endDate: null,
      current: assertion(false),
      bullets: [],
    },
  ],
  skills: [
    { id: 's1', name: 'Agile' },
    { id: 's2', name: 'Roadmaps' },
  ],
  education: [],
  courses: [],
  recommendations: [],
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
  length: { lines: 10, pages: 1, linesPerPage: 45 },
};

const render = (d: ResumeDocument = document) =>
  renderToStaticMarkup(<ResumePrintDocument document={d} draft={draft} />);

describe('ResumePrintDocument', () => {
  it('has the print class and no editor hints', () => {
    const html = render();
    expect(html).toContain('career-resume-print');
    expect(html).not.toMatch(/Добавьте|Не указано|не указан|Например|<input|<textarea|<button/u);
  });

  it('shows title — employer and period', () => {
    const html = render();
    expect(html).toContain('Technical Product Manager — Kaspersky');
    expect(html).toContain('2021-10 — 2024-08');
    expect(html).toContain('Снизила время реакции.');
  });

  it('prints the city once, in the role line', () => {
    const html = render();
    expect(html).toContain('Product Manager | Munich');
    expect(html.match(/Munich/gu)).toHaveLength(1);
    expect(html).toContain('elena@example.com');
  });

  it('omits empty sections and their headings', () => {
    const html = render();
    expect(html).toContain('Навыки');
    expect(html).toContain('Agile, Roadmaps');
    expect(html).not.toMatch(/Образование|Курсы|Языки|Рекомендации/u);
    expect(html.match(/career-resume-print-entry/gu)).toHaveLength(1);
  });
});
