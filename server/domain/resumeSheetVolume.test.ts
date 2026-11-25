import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { sheetFromDocument } from '../../src/features/b640/apply/model/resumeSheet';
import { renderResumePdf } from '../resumeBuilder/resumePdf';
import { relevanceOf, relevanceScore } from './resumeRelevance';
import { fitVacancyResume } from './resumeSheetVolume';
import { buildTargetedResumeSlice } from './resumeStudioTargeted';
import type { ResumeAssertion, ResumeDocument, ResumeExperience } from './resumeStudioTypes';

const fact = <T extends string | boolean>(value: T, memoryId: string): ResumeAssertion<T> => ({
  value,
  memoryId,
  sourceMessageIds: ['m'],
  reviewFlags: [],
});
const PROOF = 'Drove CSAT up and cut inbound tickets by 40% through self-service and AI search.';
const filler = (place: string, index: number) =>
  `Kept internal routines of the ${place} unit in order and prepared paperwork for the office, item ${index}.`;

function place(id: string, year: number): ResumeExperience {
  return {
    id,
    title: fact('Head', `${id}-t`),
    employer: fact(`Company ${id}`, `${id}-e`),
    location: null,
    startDate: fact(`${year}`, `${id}-s`),
    endDate: fact(`${year + 1}`, `${id}-f`),
    current: fact(false, `${id}-c`),
    bullets: [
      ...Array.from({ length: 12 }, (_, index) => fact(filler(id, index), `${id}-${index}`)),
      fact(id === 'cloud' ? PROOF : `Closing note of ${id}.`, `${id}-last`),
    ],
  };
}

const master = {
  kind: 'master',
  targetRole: 'CIO',
  contact: {
    fullName: 'Мария Пример',
    email: 'a@b.example',
    phone: null,
    location: null,
    links: [],
  },
  about: 'Руковожу поддержкой и эксплуатацией.',
  experience: [2024, 2022, 2020, 2016, 2012].map((year, index) =>
    place(index === 3 ? 'cloud' : `p${index}`, year),
  ),
  skills: Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, name: `Skill ${index}` })),
  projects: [],
  education: [],
  courses: [],
  certifications: [{ id: 'c1', name: 'ITIL 4', issuer: 'PeopleCert' }],
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
  length: { lines: 1, pages: 1, linesPerPage: 45 },
} satisfies ResumeDocument;

const view = {
  requirements: [],
  result: {
    assessments: [
      {
        requirementId: 'r1',
        status: 'matched',
        evidence: [{ factId: 'profile-cloud', quote: 'cut inbound tickets by 40%' }],
      },
    ],
  },
} as unknown as Pick<VacancyFitView, 'requirements' | 'result'>;

const fitted = () =>
  fitVacancyResume(
    buildTargetedResumeSlice(master, { title: 'CIO', requirements: [] }),
    relevanceOf(view, []),
  );

describe('отбор пунктов резюме под вакансию', () => {
  it('подтверждающий требование пункт остаётся и у старого места', () => {
    const { document, trimmed, pages } = fitted();
    const cloud = document.experience.find((item) => item.id === 'cloud');
    expect(cloud?.bullets.map((item) => item.value)).toContain(PROOF);
    expect(trimmed.some((item) => item.label === PROOF)).toBe(false);
    expect(pages).toBe(2);
    expect(document.experience).toHaveLength(5);
    for (const [index, item] of document.experience.entries()) {
      expect(item.bullets.length).toBeGreaterThanOrEqual(index < 3 ? 3 : 1);
    }
    expect(document.about).toBe(master.about);
    expect(document.certifications).toEqual(master.certifications);
  });

  it('каждый пункт дословно совпадает с профилем и несёт свой факт', () => {
    const { document } = fitted();
    for (const item of document.experience) {
      const own = master.experience.find(({ id }) => id === item.id)!;
      for (const bullet of item.bullets) expect(own.bullets).toContain(bullet);
    }
  });

  it('файл «Строгий» занимает не больше двух страниц', async () => {
    const pdf = await renderResumePdf(sheetFromDocument(fitted().document), 'strict');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/gu)?.length).toBeLessThanOrEqual(2);
  });

  it('сертификаты стоят своим разделом листа', () => {
    expect(sheetFromDocument(fitted().document).extra).toContainEqual({
      title: 'Certifications',
      lines: ['ITIL 4, PeopleCert'],
    });
    expect(sheetFromDocument({ ...master, certifications: undefined }).extra).toEqual([]);
  });

  it('без разбора сверяет слова требований', () => {
    const relevance = relevanceOf(
      {
        requirements: [{ text: 'Managing enterprise software implementation programs' }],
      } as unknown as Pick<VacancyFitView, 'requirements'>,
      ['ITIL'],
    );
    expect(relevanceScore(relevance, 'Led enterprise software implementation')).toBeGreaterThan(0);
    expect(relevanceScore(relevance, 'Introduced ITIL processes')).toBeGreaterThan(0);
    expect(relevanceScore(relevance, 'Organised the office party')).toBe(0);
  });
});
