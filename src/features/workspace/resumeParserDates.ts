import { MONTHS_EN, MONTHS_RU } from './resumeParserConstants';

export const SINGLE_DATE_REGEX = /(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|[А-Яа-яЁё]+)\s+)?\d{4}\s*(?:—|-|to|–)\s*(?:по настоящее время|наст\. время|настоящее время|present|current|\d{4}|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|[А-Яа-яЁё]+)\s+)?\d{4})/iu;
export const HH_START_DATE_REGEX = /^(?:(?:[А-Яа-яЁёA-Za-z]+)\s+)?(?:19\d\d|20\d\d)\s*(?:—|-|–)\s*(.+)$/u;

export function cleanPeriodDates(period: string): { start?: string; end?: string; current: boolean } {
  const cleaned = period.replace(/\s*\([^)]*\)/gu, '').replace(/\s*·.*$/gu, '').trim();
  const isCurrent = /настоящее|наст\.|present|current/iu.test(cleaned);
  const parts = cleaned.split(/\s*(?:—|-|to|–)\s*/u);
  const start = parts[0] ? normalizeDate(parts[0].trim()) : undefined;
  const end = isCurrent ? undefined : parts[1] ? normalizeDate(parts[1].trim()) : undefined;
  return { start, end, current: isCurrent };
}

export interface DetectedDateEntry {
  lineIdx: number;
  startDate?: string;
  endDate?: string;
  current: boolean;
  employer?: string;
  inlineTitle?: string;
  skipLines: number;
}

 


export function normalizeDate(raw: string): string {
  if (!raw) return '';
  const cleanStr = raw.toLowerCase().trim();
  const yearMatch = cleanStr.match(/\b(19\d\d|20\d\d)\b/u);
  const year = yearMatch?.[1];
  if (!year) return raw;

  for (const [month, num] of Object.entries(MONTHS_RU)) {
    if (cleanStr.includes(month)) return `${year}-${num}`;
  }
  for (const [month, num] of Object.entries(MONTHS_EN)) {
    if (cleanStr.includes(month)) return `${year}-${num}`;
  }
  return year;
}

