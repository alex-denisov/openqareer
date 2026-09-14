import type { UnifiedVacancy, VacancySalary } from '../domain/unifiedVacancy';
import { decodeFeedEntities } from '../connectors/feedText';
import {
  asArray,
  buildJsonVacancy,
  isUsableVacancy,
  listOf,
  numeric,
  record,
  text,
  type JsonAdapterContext,
} from './jsonVacancyRecord';

export const HN_SOURCE_ID = 'src-hn-whoishiring';
export const HN_ALGOLIA_SEARCH_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Ask+HN:+Who+is+hiring';
export const HN_ITEM_BASE_URL = 'https://news.ycombinator.com/item?id=';

const CURRENCY_MAP: Readonly<Record<string, string>> = {
  $: 'USD',
  USD: 'USD',
  '€': 'EUR',
  EUR: 'EUR',
  '£': 'GBP',
  GBP: 'GBP',
  '¥': 'JPY',
  JPY: 'JPY',
  CAD: 'CAD',
  AUD: 'AUD',
  CHF: 'CHF',
  RUR: 'RUR',
  RUB: 'RUR',
  '₽': 'RUR',
};

const KNOWN_TECH_KEYWORDS = new Set([
  'react',
  'react native',
  'vue',
  'angular',
  'svelte',
  'next.js',
  'node',
  'node.js',
  'typescript',
  'javascript',
  'python',
  'golang',
  'go',
  'rust',
  'c++',
  'c#',
  '.net',
  'java',
  'kotlin',
  'swift',
  'ruby',
  'rails',
  'php',
  'elixir',
  'clojure',
  'scala',
  'aws',
  'gcp',
  'azure',
  'docker',
  'kubernetes',
  'k8s',
  'terraform',
  'graphql',
  'postgres',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'kafka',
  'elasticsearch',
  'ai',
  'ml',
  'pytorch',
  'tensorflow',
  'llm',
  'nlp',
  'embedded',
  'linux',
  'ros',
  'ros2',
]);

function parseNumberWithK(numStr: string, hasK: boolean): number | undefined {
  const clean = numStr.replace(/,/g, '').trim();
  const val = Number.parseFloat(clean);
  if (Number.isNaN(val) || val <= 0) return undefined;
  return hasK || val < 1000 ? Math.round(val * 1000) : Math.round(val);
}

export function parseSalary(partText: string): VacancySalary | undefined {
  const rangeMatch =
    /([$€£¥]|USD|EUR|GBP|CHF|CAD|AUD)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?\s*(?:-|–|—|to)\s*([$€£¥]|USD|EUR|GBP|CHF|CAD|AUD)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?\s*(USD|EUR|GBP|CHF|CAD|AUD)?/i.exec(
      partText,
    );

  if (rangeMatch) {
    const rawCur = rangeMatch[1] || rangeMatch[4] || rangeMatch[7];
    const currency = rawCur ? CURRENCY_MAP[rawCur.toUpperCase()] || CURRENCY_MAP[rawCur] : 'USD';
    const hasK2 = Boolean(rangeMatch[6]);
    const hasK1 = Boolean(rangeMatch[3]) || hasK2;
    const from = parseNumberWithK(rangeMatch[2]!, hasK1);
    const to = parseNumberWithK(rangeMatch[5]!, hasK2);
    if (from !== undefined || to !== undefined) {
      return { from, to, currency: currency ?? 'USD' };
    }
  }

  const singleMatch =
    /([$€£¥]|USD|EUR|GBP|CHF|CAD|AUD)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/i.exec(
      partText,
    );
  if (singleMatch) {
    const rawCur = singleMatch[1]!;
    const currency = CURRENCY_MAP[rawCur.toUpperCase()] || CURRENCY_MAP[rawCur] || 'USD';
    const hasK = Boolean(singleMatch[3]);
    const from = parseNumberWithK(singleMatch[2]!, hasK);
    if (from !== undefined) {
      return { from, currency };
    }
  }

  return undefined;
}

export function parseEmploymentType(part: string): string | undefined {
  if (/\bfull[-\s]?time\b/i.test(part)) return 'Full-time';
  if (/\bpart[-\s]?time\b/i.test(part)) return 'Part-time';
  if (/\bcontract(?:or)?\b/i.test(part)) return 'Contract';
  if (/\bintern(?:ship)?\b/i.test(part)) return 'Internship';
  if (/\bfreelance\b/i.test(part)) return 'Freelance';
  return undefined;
}

export function detectIsRemote(text: string): boolean {
  if (/\b(?:no\s+remote|onsite\s+only|not\s+remote|in-office\s+only)\b/i.test(text)) {
    return false;
  }
  return /\bremote\b/i.test(text);
}

export function isHnMetaComment(headerLine: string, fullText: string, author?: string): boolean {
  if (author === 'whoishiring') return true;
  const h = headerLine.toLowerCase();
  const f = fullText.toLowerCase();
  if (
    h.includes('please follow this format') ||
    h.includes('please follow the format') ||
    h.includes('rules:') ||
    h.includes('thread rules') ||
    h.startsWith('location:') ||
    h.startsWith('seeking:') ||
    h.startsWith('feedback or criticism') ||
    f.includes('only post if you are personally part of the hiring company') ||
    f.includes('no third-party recruiters')
  ) {
    return true;
  }
  return false;
}

export function extractSkillsFromPart(part: string): string[] {
  if (part.includes(',')) {
    const items = part
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const hasTech = items.some((item) => KNOWN_TECH_KEYWORDS.has(item.toLowerCase()));
    if (hasTech) {
      return items;
    }
  }
  if (KNOWN_TECH_KEYWORDS.has(part.toLowerCase())) {
    return [part];
  }
  return [];
}

export interface HnHeaderParsed {
  readonly company: string;
  readonly title: string;
  readonly location?: string;
  readonly isRemote: boolean;
  readonly salary?: VacancySalary;
  readonly skills: readonly string[];
  readonly employmentType?: string;
}

export function parseHnHeaderLine(line: string): HnHeaderParsed | null {
  const clean = decodeFeedEntities(line.replace(/<[^>]+>/g, ' ')).trim();
  if (!clean.includes('|') || isHnMetaComment(clean, clean)) return null;

  const parts = clean
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const company = parts[0]!;
  const title = parts[1]!;
  if (!company || !title) return null;
  if (/^(?:please|note:|format:|ask hn|rules:)/i.test(company)) return null;

  const isRemote = detectIsRemote(clean);
  const remaining = parts.slice(2);

  let salary: VacancySalary | undefined;
  let employmentType: string | undefined;
  const skills: string[] = [];
  const locationCandidates: string[] = [];

  for (const part of remaining) {
    const s = parseSalary(part);
    if (s && !salary) {
      salary = s;
      continue;
    }
    const emp = parseEmploymentType(part);
    if (emp && !employmentType) {
      employmentType = emp;
      continue;
    }
    const sk = extractSkillsFromPart(part);
    if (sk.length > 0) {
      skills.push(...sk);
      continue;
    }
    if (
      /^(?:onsite|remote|hybrid|in[-\s]office|in[-\s]person)(?:\s+only)?(?:\s*\(no\s+remote\))?$/i.test(
        part,
      ) ||
      /\b(?:onsite\s+only|no\s+remote)\b/i.test(part)
    ) {
      continue;
    }
    if (/^https?:\/\//i.test(part) || /^www\./i.test(part)) {
      continue;
    }
    locationCandidates.push(part);
  }

  let location: string | undefined = locationCandidates[0];
  if (!location && isRemote) {
    const remotePart = remaining.find((p) => /remote/i.test(p));
    if (remotePart) location = remotePart;
  }

  return {
    company,
    title,
    location,
    isRemote,
    salary,
    skills,
    employmentType,
  };
}

export function extractHnHeaderAndBody(rawHtml: string): {
  headerLine: string;
  bodyText: string;
} {
  const normalized = rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p>/gi, '\n\n');

  const decoded = decodeFeedEntities(normalized);
  const lines = decoded
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headerLine: '', bodyText: '' };
  }

  const headerLine = lines[0]!;
  const bodyText = lines.slice(1).join('\n\n');
  return { headerLine, bodyText };
}

export function parseHnCommentToVacancy(
  comment: unknown,
  context?: { observedAt?: string; storyId?: number | string; sourceName?: string },
): UnifiedVacancy | null {
  const c = record(comment);
  if (c.deleted === true || c.dead === true) return null;

  const objectID = text(c.objectID);
  if (!objectID) return null;

  const rawText = text(c.comment_text);
  if (!rawText) return null;

  const parentId = numeric(c.parent_id);
  const storyId = numeric(c.story_id);
  const author = text(c.author);

  if (author === 'whoishiring') return null;

  if (parentId !== undefined && storyId !== undefined && parentId !== storyId) {
    return null;
  }
  if (
    context?.storyId !== undefined &&
    parentId !== undefined &&
    String(parentId) !== String(context.storyId)
  ) {
    return null;
  }

  const { headerLine, bodyText } = extractHnHeaderAndBody(rawText);
  if (!headerLine || isHnMetaComment(headerLine, rawText, author)) return null;

  const header = parseHnHeaderLine(headerLine);
  if (!header || !header.company || !header.title) return null;

  const observedAt = context?.observedAt || new Date().toISOString();
  const url = `${HN_ITEM_BASE_URL}${objectID}`;
  const fullDescription = [headerLine, bodyText].filter(Boolean).join('\n\n');

  const vacancy = buildJsonVacancy({
    sourceId: HN_SOURCE_ID,
    context: {
      observedAt,
      sourceName: context?.sourceName ?? 'Hacker News (Who is hiring)',
      sourceUrl: url,
    },
    externalId: objectID,
    title: header.title,
    company: header.company,
    location: header.location,
    isRemote: header.isRemote,
    salary: header.salary,
    description: fullDescription || header.title,
    skills: [...header.skills],
    employmentType: header.employmentType,
    url,
    publishedAt: text(c.created_at) || observedAt,
  });

  return {
    ...vacancy,
    fullDescription,
  };
}

export function hnWhoIsHiringAdapter(
  payload: unknown,
  context: JsonAdapterContext,
  _sourceId: string,
): UnifiedVacancy[] {
  const hits = listOf(payload, (value) => asArray(record(value).hits) ?? asArray(value));
  return hits
    .map((hit) =>
      parseHnCommentToVacancy(hit, {
        observedAt: context.observedAt,
        sourceName: context.sourceName,
      }),
    )
    .filter((v): v is UnifiedVacancy => v !== null && isUsableVacancy(v));
}

export interface HnFetchDeps {
  readonly fetchJson?: (url: string) => Promise<unknown>;
  readonly nowMs?: number;
}

export async function fetchHnWhoIsHiring(
  nowMsOrDeps?: number | HnFetchDeps,
): Promise<UnifiedVacancy[]> {
  const nowMs = typeof nowMsOrDeps === 'number' ? nowMsOrDeps : nowMsOrDeps?.nowMs ?? Date.now();
  const fetchJson =
    typeof nowMsOrDeps === 'object' && nowMsOrDeps?.fetchJson
      ? nowMsOrDeps.fetchJson
      : async (url: string) => {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'OpenQareer/1.0 (HN WhoIsHiring Scraper)' },
          });
          if (!res.ok) {
            throw new Error(`hn_api_error: ${res.status} ${res.statusText}`);
          }
          return res.json();
        };

  const searchPayload = record(await fetchJson(HN_ALGOLIA_SEARCH_URL));
  const storyHits = asArray(searchPayload.hits) ?? [];
  if (storyHits.length === 0) {
    throw new Error('hn_story_not_found');
  }

  const storyId = text(record(storyHits[0]).objectID);
  if (!storyId) {
    throw new Error('hn_story_id_missing');
  }

  const observedAt = new Date(nowMs).toISOString();
  const vacancies: UnifiedVacancy[] = [];
  let page = 0;
  let nbPages = 1;

  while (page < nbPages && page < 10) {
    const commentsUrl = `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=1000&page=${page}`;
    const commentsPayload = record(await fetchJson(commentsUrl));
    nbPages = numeric(commentsPayload.nbPages) ?? 1;
    const hits = asArray(commentsPayload.hits) ?? [];
    for (const hit of hits) {
      const vacancy = parseHnCommentToVacancy(hit, { observedAt, storyId });
      if (vacancy && isUsableVacancy(vacancy)) {
        vacancies.push(vacancy);
      }
    }
    page += 1;
  }

  return vacancies;
}
