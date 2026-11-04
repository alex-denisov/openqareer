import type { ParsedResume } from '../../src/features/workspace/resumeParser';

/** Below this the document is read whole: one call is fast enough and cannot lose a seam. */
export const RESUME_WHOLE_READ_MAX_CHARACTERS = 5_000;
const FRAGMENT_TARGET_CHARACTERS = 4_000;
/** Parallel calls per resume; a longer document gets longer fragments, not more of them. */
const MAX_FRAGMENTS = 6;
/** Lines repeated at a seam, so a heading above a date line stays with its place. */
const SEAM_OVERLAP_LINES = 3;
const HEADING_MAX_CHARACTERS = 80;

/** Marks bullets whose heading stayed in the previous fragment. */
export const RESUME_CONTINUED_TITLE = '(continued)';

const DATE_RANGE =
  /(?:19|20)\d{2}\s*(?:[-–—]|по\b|to\b)|(?:[-–—]|по\b|to\b)\s*(?:(?:19|20)\d{2}|настоящее|наст\.|present|current|now)/iu;

/** Short lines right above a seam may be the heading of the next place; a bullet never is. */
function headingLinesAbove(lines: readonly string[], index: number, floor: number): number {
  let count = 0;
  while (count < SEAM_OVERLAP_LINES && index - count - 1 > floor) {
    const line = (lines[index - count - 1] ?? '').trim();
    if (line === '' || line.length > HEADING_MAX_CHARACTERS || /^[-–—•*·]/u.test(line)) break;
    count += 1;
  }
  return count;
}

/**
 * Splits a resume at the start of a place of work where it can. A seam goes before the block
 * that holds a date range, or at a blank line when no such block comes in time.
 */
export function splitResumeIntoFragments(source: string): string[] {
  if (source.length <= RESUME_WHOLE_READ_MAX_CHARACTERS) return [source];
  const target = Math.max(FRAGMENT_TARGET_CHARACTERS, Math.ceil(source.length / MAX_FRAGMENTS));
  const lines = source.split('\n');
  const fragments: string[] = [];
  let start = 0;
  let size = 0;
  let lastBlank = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const ready = size >= target;
    const overdue = size >= target * 1.3;
    const atPlace = ready && DATE_RANGE.test(line) && index > start + SEAM_OVERLAP_LINES;
    const atBlank = overdue && line.trim() === '' && index > lastBlank;
    const atLimit = size >= target * 1.6 && index > start + SEAM_OVERLAP_LINES;
    if (atPlace || atBlank || atLimit) {
      fragments.push(lines.slice(start, index).join('\n'));
      start = index - headingLinesAbove(lines, index, start);
      size = lines.slice(start, index).join('\n').length;
    }
    if (line.trim() === '') lastBlank = index;
    size += line.length + 1;
  }
  fragments.push(lines.slice(start).join('\n'));
  return fragments;
}

type Place = ParsedResume['experience'][number];

function norm(value: string | undefined | null): string {
  return (value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function samePlace(a: Place, b: Place): boolean {
  const title = norm(a.title) === norm(b.title) && norm(a.title) !== '';
  const employer = norm(a.employer) === norm(b.employer) && norm(a.employer) !== '';
  const aStart = norm(a.startDate);
  const bStart = norm(b.startDate);
  if (aStart && bStart) return aStart === bStart && (title || employer);
  // One half of a seam came without dates: only both names together make it the same place.
  const oneNameMissing = !norm(a.title) || !norm(b.title) || !norm(a.employer) || !norm(b.employer);
  return oneNameMissing ? title || employer : title && employer;
}

function joinPlaces(a: Place, b: Place): Place {
  return {
    ...a,
    title: a.title || b.title,
    employer: a.employer || b.employer,
    location: a.location ?? b.location,
    startDate: a.startDate ?? b.startDate,
    endDate: a.endDate ?? b.endDate,
    current: a.current || b.current,
    responsibilities: uniqueBy([...a.responsibilities, ...b.responsibilities], norm),
    achievements: uniqueBy([...a.achievements, ...b.achievements], norm),
  };
}

function mergePlaces(parts: readonly ParsedResume[]): Place[] {
  return parts
    .flatMap((part) => part.experience)
    .reduce<Place[]>((places, place) => {
      if (place.title.trim() === RESUME_CONTINUED_TITLE && places.length > 0) {
        const last = places.length - 1;
        return places.map((known, index) => (index === last ? joinPlaces(known, { ...place, title: '' }) : known));
      }
      const at = places.findIndex((known) => samePlace(known, place));
      if (at < 0) return [...places, place];
      return places.map((known, index) => (index === at ? joinPlaces(known, place) : known));
    }, []);
}

/** Facts in document order; a scalar comes from the first fragment that has it. */
export function mergeResumeFragments(parts: readonly ParsedResume[], rawText: string): ParsedResume {
  const first = parts[0]!;
  const pick = <T>(read: (part: ParsedResume) => T | undefined | null): T | undefined =>
    parts.map(read).find((value) => value !== undefined && value !== null);
  const all = <T>(read: (part: ParsedResume) => readonly T[] | undefined): T[] =>
    parts.flatMap((part) => read(part) ?? []);
  return {
    ...first,
    fullName: pick((part) => part.fullName),
    targetRole: pick((part) => part.targetRole),
    about: pick((part) => part.about),
    contact: {
      email: pick((part) => part.contact.email),
      phone: pick((part) => part.contact.phone),
      telegram: pick((part) => part.contact.telegram),
      location: pick((part) => part.contact.location),
      links: uniqueBy(all((part) => part.contact.links), norm),
    },
    experience: mergePlaces(parts),
    skills: uniqueBy(all((part) => part.skills), norm),
    education: uniqueBy(all((part) => part.education), (item) => norm(`${item.institution} ${item.qualification ?? ''}`)),
    courses: uniqueBy(all((part) => part.courses), (item) => norm(item.name)),
    tests: uniqueBy(all((part) => part.tests), (item) => norm(item.name)),
    recommendations: uniqueBy(all((part) => part.recommendations), (item) => norm(`${item.recommender ?? ''} ${item.text ?? ''}`)),
    languages: uniqueBy(all((part) => part.languages), (item) => norm(item.name)),
    additional: pick((part) => part.additional),
    rawText,
  };
}
