import type { DatabaseSync } from 'node:sqlite';
import { searchExaPeople } from '../osint/adapters/exaAdapter';
import type { FootprintRequestGate } from '../osint/adapters/requestScheduler';
import { RECRUITER_TITLE } from './companyPageParser';
import {
  ensureCompanyRecruitersSchema,
  savePoolCompanyRecruiter,
} from './companyRecruiterDiscovery';
import type { LinkedinPeopleSearchCard } from './peopleSearchParser';
import type { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';

export type RecruiterSource = 'linkedin' | 'exa' | 'exa+linkedin';

export type ExaEnrichmentStatus = 'done' | 'cached' | 'exa_not_configured' | 'failed';

export interface ExaEnrichmentOutcome {
  readonly status: ExaEnrichmentStatus;
  readonly saved: number;
}

export interface ExaEnrichmentInput {
  readonly repository: SqliteLinkedinPoolRepository;
  readonly companyName: string;
  /** Карточки поиска людей LinkedIn — для подтверждения найденных в Exa. */
  readonly cards: readonly LinkedinPeopleSearchCard[];
  readonly apiKey: string | undefined;
  readonly fetch?: typeof fetch;
  readonly requestGate?: FootprintRequestGate;
  readonly now: () => Date;
  readonly signal: AbortSignal;
}

export interface ExaProfileSummary {
  readonly headline: string;
  readonly location: string | null;
}

/** Не чаще одного запроса Exa на компанию за это окно. */
export const EXA_COMPANY_CACHE_DAYS = 30;
const EXA_RESULTS = 10;
const MIN_CONTAINMENT_LENGTH = 12;
const MAX_FIELD = 300;

/** `https://es.linkedin.com/in/<slug>/en` → `https://www.linkedin.com/in/<slug>`. */
export function normalizeExaLinkedinUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)linkedin\.com$/iu.test(url.hostname)) return null;
    const slug = /^\/in\/([A-Za-z0-9._%-]+)(?:\/.*)?$/u.exec(url.pathname)?.[1];
    return slug ? `https://www.linkedin.com/in/${slug}` : null;
  } catch {
    return null;
  }
}

/** Текст Exa: `# Имя`, затем заголовок профиля, затем «Город, Регион, Страна (CC)». */
export function parseExaProfileText(text: string): ExaProfileSummary | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const body = lines[0]?.startsWith('#') ? lines.slice(1) : lines;
  const headline = body[0];
  if (!headline || headline.length > MAX_FIELD) return null;
  const place = body[1];
  const location = place && !/connections?|followers?/iu.test(place)
    ? place.replace(/\s*\([A-Z]{2}\)\s*$/u, '').trim()
    : null;
  return { headline, location: location || null };
}

function fold(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

function firstSegment(location: string | null): string {
  return fold((location ?? '').split(',')[0] ?? '');
}

function headlinesOverlap(left: string, right: string): boolean {
  const a = fold(left);
  const b = fold(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_CONTAINMENT_LENGTH && long.includes(short);
}

/** Карточка LinkedIn совпала: заголовок равен или вложен, и город тот же. */
export function matchesLinkedinCard(
  profile: ExaProfileSummary,
  cards: readonly LinkedinPeopleSearchCard[],
): boolean {
  const city = firstSegment(profile.location);
  if (!city) return false;
  return cards.some(
    (card) => firstSegment(card.location) === city && headlinesOverlap(profile.headline, card.headline),
  );
}

function acceptsProfile(profile: ExaProfileSummary, companyName: string): boolean {
  const company = fold(companyName);
  return company.length > 0 && fold(profile.headline).includes(company) && RECRUITER_TITLE.test(profile.headline);
}

function ensureExaSchema(database: DatabaseSync): void {
  ensureCompanyRecruitersSchema(database);
}

function isCached(database: DatabaseSync, companyName: string, now: Date): boolean {
  const row = database
    .prepare('SELECT queried_at FROM linkedin_pool_exa_company_cache WHERE company_name = ? COLLATE NOCASE')
    .get(companyName) as { queried_at: string } | undefined;
  if (!row) return false;
  return Date.parse(row.queried_at) > now.getTime() - EXA_COMPANY_CACHE_DAYS * 86_400_000;
}

function markQueried(database: DatabaseSync, companyName: string, now: Date): void {
  database
    .prepare(
      `INSERT INTO linkedin_pool_exa_company_cache (company_name, queried_at) VALUES (?, ?)
       ON CONFLICT(company_name) DO UPDATE SET queried_at = excluded.queried_at`,
    )
    .run(companyName.toLowerCase(), now.toISOString());
}

function saveSource(database: DatabaseSync, recruiterId: string, source: RecruiterSource): void {
  database
    .prepare(
      `INSERT INTO linkedin_pool_company_recruiter_sources (recruiter_id, source) VALUES (?, ?)
       ON CONFLICT(recruiter_id) DO UPDATE SET source = excluded.source`,
    )
    .run(recruiterId, source);
}

/**
 * Имена и профили рекрутёров из Exa; поиск людей LinkedIn лишь подтверждает их.
 * Сохраняются только URL, имя и заголовок профиля.
 */
export async function enrichRecruitersFromExa(input: ExaEnrichmentInput): Promise<ExaEnrichmentOutcome> {
  if (!input.apiKey) return { status: 'exa_not_configured', saved: 0 };
  const database = input.repository.getDatabase();
  ensureExaSchema(database);
  const now = input.now();
  if (isCached(database, input.companyName, now)) return { status: 'cached', saved: 0 };
  let hits;
  try {
    hits = await searchExaPeople(`recruiter at ${input.companyName}`, input.apiKey, input.signal, {
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(input.requestGate ? { requestGate: input.requestGate } : {}),
      numResults: EXA_RESULTS,
      includeDomains: ['linkedin.com'],
      contents: { text: { maxCharacters: 300 } },
    });
  } catch {
    return { status: 'failed', saved: 0 };
  }
  // Запрос оплачен: повтор в окне запрещён, даже если принять некого.
  markQueried(database, input.companyName, now);
  let saved = 0;
  for (const hit of hits) {
    const linkedinUrl = normalizeExaLinkedinUrl(hit.url);
    const profile = parseExaProfileText(hit.text);
    const fullName = hit.title.trim();
    if (!linkedinUrl || !profile || !fullName || fullName.length > 200) continue;
    if (!acceptsProfile(profile, input.companyName)) continue;
    const stored = savePoolCompanyRecruiter(input.repository, {
      companyName: input.companyName,
      fullName,
      roleTitle: profile.headline,
      linkedinUrl,
      observedAt: now.toISOString(),
    });
    saveSource(database, stored.id, matchesLinkedinCard(profile, input.cards) ? 'exa+linkedin' : 'exa');
    saved += 1;
  }
  return { status: 'done', saved };
}
