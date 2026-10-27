import { transliterateToLatin } from '../recruiterIntelligenceService';

/**
 * Формула рабочей почты компании по её же опубликованным адресам (B258):
 * имя и адрес сотрудника рядом на открытой странице показывают шаблон.
 */
export const EMAIL_FORMAT_IDS = ['first.last', 'f.last', 'firstlast', 'flast', 'first', 'last.first', 'first_last', 'last'] as const;
export type EmailFormatId = (typeof EMAIL_FORMAT_IDS)[number];

export interface EmailSample {
  readonly fullName: string;
  readonly email: string;
}

export interface EmailFormat {
  readonly id: EmailFormatId;
  /** Сколько опубликованных адресов следуют формуле. */
  readonly support: number;
}

function nameParts(fullName: string): { first: string; last: string } | null {
  const parts = transliterateToLatin(fullName.normalize('NFKC'))
    .toLowerCase()
    .replace(/[^a-z\s-]/gu, '')
    .split(/\s+/u)
    .filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

function localPart(id: EmailFormatId, first: string, last: string): string {
  switch (id) {
    case 'first.last': return `${first}.${last}`;
    case 'f.last': return `${first[0]}.${last}`;
    case 'firstlast': return `${first}${last}`;
    case 'flast': return `${first[0]}${last}`;
    case 'first': return first;
    case 'last.first': return `${last}.${first}`;
    case 'first_last': return `${first}_${last}`;
    case 'last': return last;
  }
}

export function applyEmailFormat(id: EmailFormatId, fullName: string, domain: string): string | null {
  const name = nameParts(fullName);
  return name ? `${localPart(id, name.first, name.last)}@${domain.toLowerCase()}` : null;
}

export function formatsOf(sample: EmailSample): EmailFormatId[] {
  const name = nameParts(sample.fullName);
  const local = sample.email.split('@')[0]?.toLowerCase();
  if (!name || !local) return [];
  return EMAIL_FORMAT_IDS.filter((id) => localPart(id, name.first, name.last) === local);
}

/** Формула большинства примеров; без единого совпадения имени и адреса — null. */
export function inferEmailFormat(samples: readonly EmailSample[]): EmailFormat | null {
  const counts = new Map<EmailFormatId, number>();
  for (const sample of samples) {
    for (const id of formatsOf(sample)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: EmailFormat | null = null;
  // Порядок EMAIL_FORMAT_IDS решает ничью: точечные формулы встречаются чаще.
  for (const id of EMAIL_FORMAT_IDS) {
    const support = counts.get(id) ?? 0;
    if (support > 0 && (!best || support > best.support)) best = { id, support };
  }
  return best;
}

const NAME_BEFORE_CHARS = 160;
const NAME_WORD = /\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?/gu;

/** Соседние слова с заглавной буквы, с перекрытием: «Write Mary Major» даёт и «Mary Major». */
function nameCandidates(text: string): string[] {
  const words = [...text.matchAll(NAME_WORD)];
  const pairs: string[] = [];
  for (let index = 1; index < words.length; index += 1) {
    const prev = words[index - 1]!;
    const word = words[index]!;
    const gap = text.slice(prev.index + prev[0].length, word.index);
    if (/^[ \t\u00a0]+$/u.test(gap)) pairs.push(`${prev[0]} ${word[0]}`);
  }
  return pairs;
}

/** Общие ящики и шаблонные имена-примеры: по ним формула не выводится. */
const ROLE_MAILBOXES = new Set([
  'recruiting', 'recruitment', 'recruiter', 'hr', 'jobs', 'job', 'careers', 'career', 'talent', 'hiring', 'info',
  'team', 'press', 'media', 'hello', 'contact', 'contacts', 'support', 'sales', 'office', 'admin', 'mail', 'privacy',
]);
const PLACEHOLDER_NAMES = new Set(['john doe', 'jane doe', 'john smith', 'jane smith', 'ivan ivanov', 'иван иванов', 'first last']);

function isPersonalSample(sample: EmailSample): boolean {
  const local = sample.email.split('@')[0] ?? '';
  return !ROLE_MAILBOXES.has(local) && !PLACEHOLDER_NAMES.has(sample.fullName.trim().toLowerCase());
}

const LOCAL_CHAR = /[A-Za-z0-9._%+-]/u;
const MAX_LOCAL_CHARS = 64;

/**
 * Пары «имя — адрес» на домене компании; общие ящики без имени не берутся.
 * Поиск через indexOf, без регулярного выражения по всему телу: страницу
 * пишет чужой сайт, и квадратичный разбор повесил бы процесс.
 */
export function samplesFromText(text: string, domain: string): EmailSample[] {
  const lower = text.toLowerCase();
  const needle = `@${domain.toLowerCase()}`;
  const samples: EmailSample[] = [];
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    const after = lower[at + needle.length];
    if (after && /[a-z0-9-]/u.test(after)) continue;
    let start = at;
    while (start > 0 && at - start < MAX_LOCAL_CHARS && LOCAL_CHAR.test(text[start - 1]!)) start -= 1;
    if (start === at) continue;
    const email = lower.slice(start, at + needle.length);
    const before = text.slice(Math.max(0, start - NAME_BEFORE_CHARS), start);
    const fullName = nameCandidates(before).reverse().find((name) => formatsOf({ fullName: name, email }).length > 0);
    if (fullName && isPersonalSample({ fullName, email }) && !samples.some((sample) => sample.email === email)) samples.push({ fullName, email });
  }
  return samples;
}
