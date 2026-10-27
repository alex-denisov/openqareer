import { ROLE_TITLE_WORDS } from './resumeParserConstants';
import { normalizeDate, type DetectedDateEntry } from './resumeParserDates';

/*
 * hh.ru's PDF read page by page splits the date column of a place across
 * lines, so the employer follows the dates instead of preceding them
 * (owner report, 2026-10-27).
 */

const DURATION_LINE = /^\d+\s+(?:год|года|лет|месяц|месяца|месяцев)(?=\s|$)/iu;
const isBulletLine = (line: string): boolean => /^[•\-*●]\s/u.test(line);

/** A wrapped line goes on in lower case, or after a comma, a dash or an open bracket. */
function continuesLine(previous: string, line: string): boolean {
  const opened = (previous.match(/\(/gu) ?? []).length > (previous.match(/\)/gu) ?? []).length;
  return /^[a-zа-яё(]/u.test(line) || /[,(\-–—]$/u.test(previous) || opened;
}

/**
 * The PDF fallback cuts a description at the page width; a line that does not
 * end a sentence goes on in the next one, unless that one opens a list item.
 */
export function joinWrappedLines(body: string[]): string[] {
  return body.reduce<string[]>((joined, line) => {
    const last = joined[joined.length - 1];
    const opensItem = isBulletLine(line) || /^\d+[).]\s/u.test(line);
    if (last !== undefined && !opensItem && !/[.!?:;]$/u.test(last)) {
      return [...joined.slice(0, -1), `${last} ${line}`];
    }
    return [...joined, line];
  }, []);
}

function readsAsTitleLine(line: string): boolean {
  return /^[A-ZА-ЯЁ]/u.test(line) && line.length <= 100 && !/[.;:,]$/u.test(line);
}

/**
 * After the dates of the split hh.ru layout come, in order: the city with the
 * site, the length of service, the industry, its bulleted list and then the
 * title, whatever the profession is called. The PDF fallback wraps any of
 * them onto a second line.
 */
export function readSplitHeader(
  lines: string[],
  start: number,
  end: number,
): { title?: string; location?: string; bodyStartIdx: number } {
  let k = start;
  let location: string | undefined;
  const duration = lines.slice(start, Math.min(start + 3, end)).findIndex((l) => DURATION_LINE.test(l));
  if (duration >= 0) {
    if (duration > 0) location = lines[start].split(/\s*,\s*/u)[0]?.trim() || undefined;
    k = start + duration + 1;
    if (k < end && /^(?:месяц|месяца|месяцев)$/iu.test(lines[k])) k++;
  }
  let previous = '';
  let industrySeen = false;
  for (; k < end; k++) {
    const line = lines[k];
    if (isBulletLine(line)) {
      previous = line;
      industrySeen = true;
      continue;
    }
    if (previous && continuesLine(previous, line)) {
      previous = line;
      continue;
    }
    const industry = !industrySeen && k + 1 < end && isBulletLine(lines[k + 1]);
    if (industry || (!industrySeen && !ROLE_TITLE_WORDS.test(line) && line.includes(','))) {
      previous = line;
      industrySeen = true;
      continue;
    }
    if (!readsAsTitleLine(line)) break;
    let title = line;
    let next = k + 1;
    while (next < end && next <= k + 2 && /^[a-zа-яё]/u.test(lines[next])) title = `${title} ${lines[next++]}`;
    return { title, location, bodyStartIdx: next };
  }
  return { location, bodyStartIdx: start };
}

export const SPLIT_START_LINE = /^((?:[А-Яа-яЁёA-Za-z]+\s+)?(?:19|20)\d\d)\s*[—–-]$/u;
const SPLIT_END_LINE =
  /^(по настоящее время|настоящее время|(?:[А-Яа-яЁёA-Za-z]+\s+)?(?:19|20)\d\d)(?:\s+(.*))?$/iu;

/**
 * The PDF reader breaks hh.ru's date column into three lines:
 * «Сентябрь 2024 —», the employer, then «Сентябрь 2026 Москва, сайт стаж отрасль».
 */
export function readSplitDateColumn(lines: string[], index: number): DetectedDateEntry | null {
  const start = lines[index].match(SPLIT_START_LINE);
  if (!start || index + 2 >= lines.length) return null;
  const employer = lines[index + 1];
  const end = lines[index + 2].match(SPLIT_END_LINE);
  if (!end || employer.length > 120 || SPLIT_START_LINE.test(employer)) return null;
  const current = /настоящее/iu.test(end[1]);
  const city = end[2]?.split(',')[0]?.trim();
  return {
    lineIdx: index,
    startDate: normalizeDate(start[1]),
    endDate: current ? undefined : normalizeDate(end[1]),
    current,
    employer,
    skipLines: 2,
    headerAfterDate: true,
    ...(city && /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s.-]*$/u.test(city) ? { location: city } : {}),
  };
}
