import { shownCertifications } from './resumeCertifications';
import type {
  ResumeAssertion,
  ResumeExperience,
  ResumeDocument,
  TargetedResumeSlice,
} from './resumeStudioTypes';
import { resultStrength } from './resumeResult';
import { relevanceScore, type ResumeRelevance } from './resumeRelevance';
import type { TargetedResumeTrim, TargetedResumeVolume } from './resumeTargetedVolume';

/** Лист файла «Строгий»: DejaVu Serif 10,5 pt на A4 с полями 54 pt (`templateStyle`). */
const COLUMNS = 78;
const PAGE_LINES = 50;
const MAX_PAGES = 2;
const HEAD_LINES = 4;
const SECTION_LINES = 2.4;
const PLACE_LINES = 2.4;
const ENTRY_LINES = 2;
/** Три последних места держат три-четыре пункта, остальные — один: ни одно место не становится голой строкой. */
const RECENT_PLACES = 3;
const RECENT_BULLETS = 3;
const MAX_RECENT_BULLETS = 4;
const OLDER_BULLETS = 1;
/** Столько остаётся в разделе, когда он уступает место пунктам опыта. */
const MIN_SKILLS = 8;
const MIN_CERTIFICATES = 2;
/** Больше любой суммы совпадений: результат всегда важнее. */
const RESULT_WEIGHT = 1000;
/** Количество без изменения решает только при равном совпадении. */
const COUNT_WEIGHT = 0.25;
const REASON = 'В пункте меньше всего совпадений с требованиями вакансии.';

const wrapped = (text: string): number =>
  text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / COLUMNS)), 0);

const section = (lines: readonly string[]): number =>
  lines.length === 0 ? 0 : SECTION_LINES + lines.reduce((sum, line) => sum + wrapped(line), 0);

function measure(document: ResumeDocument): { readonly lines: number; readonly pages: number } {
  const places = document.experience.reduce(
    (sum, place) =>
      sum +
      PLACE_LINES +
      (place.description ? wrapped(place.description.value) : 0) +
      place.bullets.reduce((total, bullet) => total + wrapped(bullet.value), 0),
    document.experience.length > 0 ? SECTION_LINES : 0,
  );
  const education =
    document.education.length > 0 ? SECTION_LINES + document.education.length * ENTRY_LINES : 0;
  const skills = (document.skills ?? []).map((item) => item.name).join(', ');
  const lines =
    HEAD_LINES +
    places +
    education +
    section(document.about ? [document.about] : []) +
    section(skills ? [skills] : []) +
    (document.languages.length > 0 ? section(['']) : 0) +
    section((document.certifications ?? []).map((item) => item.name)) +
    section((document.courses ?? []).map((item) => [item.name, item.provider].join(', '))) +
    section(
      (document.projects ?? []).map(
        (item) => `${item.name.value}. ${item.description?.value ?? ''}`,
      ),
    );
  return { lines: Math.ceil(lines), pages: Math.max(1, Math.ceil(lines / PAGE_LINES)) };
}

/** Последняя строка раздела, которая вакансии не отвечает, если раздел ещё может уступить. */
function weakest<T>(
  items: readonly T[] | undefined,
  min: number,
  score: (item: T) => number,
): number {
  if (!items || items.length <= min) return -1;
  return items.reduce((found, item, index) => (score(item) === 0 ? index : found), -1);
}

const without = <T>(items: readonly T[] | undefined, at: number): T[] =>
  (items ?? []).filter((_, index) => index !== at);

/** Документ с одной уступкой другого раздела; уступать нечего — `null`. */
function yieldSection(document: ResumeDocument, relevance: ResumeRelevance): ResumeDocument | null {
  const score = (text: string) => relevanceScore(relevance, text);
  const course = weakest(document.courses, 0, (item) => score(item.name));
  if (course >= 0) return { ...document, courses: without(document.courses, course) };
  const project = weakest(document.projects, 0, (item) =>
    score(`${item.name.value} ${item.description?.value ?? ''}`),
  );
  if (project >= 0) return { ...document, projects: without(document.projects, project) };
  const skill = weakest(document.skills, MIN_SKILLS, (item) => score(item.name));
  if (skill >= 0) return { ...document, skills: without(document.skills, skill) };
  const certificates = document.certifications ?? [];
  if (certificates.length > MIN_CERTIFICATES) {
    return { ...document, certifications: certificates.slice(0, -1) };
  }
  return null;
}

/** Сначала измеримые результаты, среди равных — отвечающие вакансии. */
function rankOf(bullet: ResumeAssertion, relevance: ResumeRelevance): number {
  const strength = resultStrength(bullet.value);
  return (
    (strength >= 2 ? strength * RESULT_WEIGHT : strength * COUNT_WEIGHT) +
    relevanceScore(relevance, bullet.value, bullet.memoryId)
  );
}

/** Сильнейшие пункты места в прежнем порядке. */
function strongest(place: ResumeExperience, relevance: ResumeRelevance): ResumeExperience {
  const kept = new Set(
    [...place.bullets]
      .sort((left, right) => rankOf(right, relevance) - rankOf(left, relevance))
      .slice(0, MAX_RECENT_BULLETS),
  );
  return { ...place, bullets: place.bullets.filter((bullet) => kept.has(bullet)) };
}

interface Weak {
  readonly place: ResumeExperience;
  readonly index: number;
  readonly score: number;
}

/** Наименее подходящий пункт всех мест; при равенстве — у более старого места, ближе к концу. */
function weakestBullet(document: ResumeDocument, relevance: ResumeRelevance): Weak | null {
  const all = document.experience.flatMap((place, order): Weak[] => {
    const min = order < RECENT_PLACES ? RECENT_BULLETS : OLDER_BULLETS;
    if (place.bullets.length <= min) return [];
    return place.bullets.map((bullet, index) => ({
      place,
      index,
      score: rankOf(bullet, relevance),
    }));
  });
  return all.reduce<Weak | null>(
    (found, item) => (!found || item.score <= found.score ? item : found),
    null,
  );
}

function withShownCertificates(
  document: ResumeDocument,
  relevance: ResumeRelevance,
  now: Date,
): ResumeDocument {
  if (!document.certifications) return document;
  return {
    ...document,
    certifications: shownCertifications(document.certifications, relevance, now),
  };
}

const trimOf = (place: ResumeExperience, bullet: ResumeAssertion): TargetedResumeTrim => ({
  id: `bullet:${place.id}:${bullet.memoryId}`,
  kind: 'bullet',
  label: bullet.value,
  reason: REASON,
});

/** Версия под вакансию на двух страницах: остаются пункты, отвечающие её требованиям, дословно. */
export function fitVacancyResume(
  slice: TargetedResumeSlice,
  relevance: ResumeRelevance,
  now: Date = new Date(),
): TargetedResumeVolume {
  const trimmed: TargetedResumeTrim[] = [];
  let document = withShownCertificates(slice.document, relevance, now);
  let size = measure(document);
  if (size.pages > MAX_PAGES) {
    const experience = document.experience.map((place, order) =>
      order < RECENT_PLACES ? strongest(place, relevance) : place,
    );
    for (const [order, place] of document.experience.entries()) {
      const dropped = place.bullets.filter((item) => !experience[order]!.bullets.includes(item));
      trimmed.push(...dropped.map((item) => trimOf(place, item)));
    }
    document = { ...document, experience };
    size = measure(document);
  }
  while (size.pages > MAX_PAGES) {
    const less = yieldSection(document, relevance);
    const weak = less ? null : weakestBullet(document, relevance);
    if (!less && !weak) break;
    if (weak) {
      const { place, index } = weak;
      trimmed.push(trimOf(place, place.bullets[index]!));
      const bullets = without(place.bullets, index);
      document = {
        ...document,
        experience: document.experience.map((item) =>
          item === place ? { ...item, bullets } : item,
        ),
      };
    } else if (less) document = less;
    size = measure(document);
  }
  return volumeOf(slice, document, size, trimmed);
}

function volumeOf(
  slice: TargetedResumeSlice,
  document: ResumeDocument,
  { lines, pages }: { readonly lines: number; readonly pages: number },
  trimmed: readonly TargetedResumeTrim[],
): TargetedResumeVolume {
  const idsOf = (has: boolean) =>
    document.experience.filter((role) => role.bullets.length > 0 === has).map((role) => role.id);
  return {
    ...slice,
    document: { ...document, length: { lines, pages, linesPerPage: PAGE_LINES } },
    detailedExperienceIds: idsOf(true),
    compressedExperienceIds: idsOf(false),
    highlightedProjectIds: (document.projects ?? []).map((project) => project.id),
    estimatedPages: pages,
    pages,
    trimmed,
    warning:
      pages > MAX_PAGES
        ? `После отбора нерелевантных пунктов целевое резюме занимает ${pages} стр. Сократите его вручную.`
        : null,
  };
}
