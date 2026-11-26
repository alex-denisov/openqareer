import type { ResumeLang } from '../../shared/resumeVacancyEdits';
import { transliterate } from './letterLatinEmployers';
import { officialName } from './officialEmployerNames';
import type { ResumeDocument, ResumeProject } from './resumeStudioTypes';

/**
 * Д17: работодатель проекта назван так же, как место работы в профиле: в русском листе его названием,
 * в английском — официальным английским, если оно известно. Место узнаём по двум общим корням названия («Corporate University» — «Корпоративный
 * университет») и по годам; если подходит не одно место, строка остаётся исходной.
 */
const CYRILLIC = /\p{Script=Cyrillic}/u;
const STEM = 6;
const SHARED_STEMS = 2;

const stems = (text: string): ReadonlySet<string> =>
  new Set(
    transliterate(text)
      .toLocaleLowerCase('en-US')
      .replaceAll('k', 'c')
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length >= STEM)
      .map((word) => word.slice(0, STEM)),
  );

type Dated = Pick<ResumeProject, 'startDate' | 'endDate'>;

const yearOf = (value: string | undefined): number | undefined => {
  const year = /(?:19|20)\d{2}/u.exec(value ?? '')?.[0];
  return year ? Number(year) : undefined;
};

function within(project: Dated, place: Dated): boolean {
  const from = yearOf(project.startDate?.value);
  const placeFrom = yearOf(place.startDate?.value);
  if (from === undefined || placeFrom === undefined) return false;
  const to = yearOf(project.endDate?.value) ?? from;
  return from >= placeFrom && to <= (yearOf(place.endDate?.value) ?? Number.POSITIVE_INFINITY);
}

/** Русское название работодателя проекта из мест работы профиля. */
export function russianProjectEmployer(
  project: ResumeProject,
  basis: ResumeDocument,
): string | undefined {
  const name = project.employer?.value ?? '';
  if (!name || CYRILLIC.test(name)) return undefined;
  const own = stems(name);
  const found = basis.experience.flatMap((place) => {
    const employer = place.employer?.value.trim() ?? '';
    if (!CYRILLIC.test(employer) || !within(project, place)) return [];
    const shared = [...stems(employer)].filter((stem) => own.has(stem));
    return shared.length >= SHARED_STEMS ? [employer] : [];
  });
  const names = [...new Set(found)];
  return names.length === 1 ? names[0] : undefined;
}

export function withProjectEmployers(
  document: ResumeDocument,
  basis: ResumeDocument,
  lang: ResumeLang,
): ResumeDocument {
  if (!document.projects) return document;
  return {
    ...document,
    projects: document.projects.map((project) => {
      const place = russianProjectEmployer(project, basis);
      const value = place && lang === 'en' ? officialName(place) : place;
      return value && project.employer
        ? { ...project, employer: { ...project.employer, value } }
        : project;
    }),
  };
}
