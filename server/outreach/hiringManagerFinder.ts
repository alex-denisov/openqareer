import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { personNameFromTitle } from '../../shared/personName';
import type { RecruiterContact } from '../../shared/recruiterContact';
import { RECRUITER_TITLE } from '../linkedinPool/companyPageParser';
import { EXA_COMPANY_CACHE_DAYS, normalizeExaLinkedinUrl, parseExaProfileText } from '../linkedinPool/exaRecruiterEnrichment';
import { searchExaPeople } from '../osint/adapters/exaAdapter';
import type { FootprintRequestGate } from '../osint/adapters/requestScheduler';
import { generateEmailHypotheses, transliterateToLatin } from './recruiterIntelligenceService';
import type { UnifiedVacancyInput } from './recruiterIntelligenceService';

/**
 * Нанимающий менеджер (B258): руководитель направления вакансии в той же
 * компании, найденный поиском людей Exa по компании и функции. Дальше по нему
 * собираются те же каналы, что по рекрутёру.
 */
const MANAGER_TITLE = /(?<!\p{L})(?:head|director|lead|vp|vice president|chief|cto|cfo|coo|cio|cpo|cmo|manager|founder|owner)(?!\p{L})|руковод|директор|начальник|глава|основател/iu;
const SENIORITY_WORDS = /(?<!\p{L})(?:senior|junior|middle|lead|principal|staff|chief|head|vice|president|vp|manager|specialist|engineer|developer|analyst|associate|intern|ведущий|старший|младший|главный|руководитель|менеджер|специалист|инженер|разработчик|аналитик)(?!\p{L})/giu;
const EXA_TIMEOUT_MS = 15_000;
const EXA_RESULTS = 8;

const CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS hiring_manager_cache (
  query_key TEXT PRIMARY KEY,
  result TEXT,
  queried_at TEXT NOT NULL
) STRICT;`;

export interface HiringManagerProfile {
  readonly fullName: string;
  readonly roleTitle: string;
  readonly linkedinUrl: string;
}

export interface HiringManagerFinderOptions {
  readonly database: DatabaseSync;
  readonly apiKey: string | undefined;
  readonly fetch?: typeof fetch;
  readonly requestGate?: FootprintRequestGate;
  readonly now?: () => Date;
}

function fold(value: string): string {
  return transliterateToLatin(value.normalize('NFKC')).replace(/[^a-z0-9]+/gu, ' ').trim();
}

/** Направление вакансии без уровня и должности: «Senior Data Engineer, Payments» → «data payments». */
export function vacancyFunction(title: string): string {
  return title
    .replace(/\([^)]*\)/gu, ' ')
    .replace(SENIORITY_WORDS, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ');
}

function overlap(headline: string, fn: string): number {
  const words = new Set(fold(headline).split(' '));
  return fold(fn).split(' ').filter((word) => word.length > 2 && words.has(word)).length;
}

/** Профиль руководителя этой компании, не рекрутёра; ближе всех по направлению вакансии. */
export function pickHiringManager(
  hits: ReadonlyArray<{ url: string; title: string; text: string }>,
  companyName: string,
  vacancyTitle: string,
): HiringManagerProfile | null {
  const company = fold(companyName).replace(/\s+/gu, '');
  const fn = vacancyFunction(vacancyTitle);
  let best: (HiringManagerProfile & { score: number }) | null = null;
  for (const hit of hits) {
    const linkedinUrl = normalizeExaLinkedinUrl(hit.url);
    const profile = parseExaProfileText(hit.text);
    const fullName = personNameFromTitle(hit.title);
    if (!linkedinUrl || !profile || fullName.split(' ').length < 2) continue;
    const headline = profile.headline;
    if (!company || !fold(headline).replace(/\s+/gu, '').includes(company)) continue;
    if (!MANAGER_TITLE.test(headline) || RECRUITER_TITLE.test(headline)) continue;
    const score = overlap(headline, fn);
    if (!best || score > best.score) best = { fullName, roleTitle: headline, linkedinUrl, score };
  }
  return best ? { fullName: best.fullName, roleTitle: best.roleTitle, linkedinUrl: best.linkedinUrl } : null;
}

/** Поиск по компании и направлению; результат и промах кэшируются на 30 дней. */
export async function findHiringManager(
  vacancy: UnifiedVacancyInput,
  options: HiringManagerFinderOptions,
): Promise<HiringManagerProfile | null> {
  if (!options.apiKey || !vacancy.company || !vacancy.title) return null;
  const fn = vacancyFunction(vacancy.title);
  const key = `${vacancy.company.trim().toLowerCase()}|${fn.toLowerCase()}`;
  const now = options.now?.() ?? new Date();
  options.database.exec(CACHE_SCHEMA);
  const cached = options.database
    .prepare('SELECT result, queried_at FROM hiring_manager_cache WHERE query_key = ?')
    .get(key) as { result: string | null; queried_at: string } | undefined;
  if (cached && Date.parse(cached.queried_at) > now.getTime() - EXA_COMPANY_CACHE_DAYS * 86_400_000) {
    return cached.result ? (JSON.parse(cached.result) as HiringManagerProfile) : null;
  }
  let hits;
  try {
    hits = await searchExaPeople(`head of ${fn || vacancy.title} at ${vacancy.company}`, options.apiKey, AbortSignal.timeout(EXA_TIMEOUT_MS), {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.requestGate ? { requestGate: options.requestGate } : {}),
      numResults: EXA_RESULTS,
      includeDomains: ['linkedin.com'],
      contents: { text: { maxCharacters: 300 } },
    });
  } catch {
    // Ошибка поиска — не промах: без кэша, повтор при следующем поиске.
    return null;
  }
  const manager = pickHiringManager(hits, vacancy.company, vacancy.title);
  options.database
    .prepare(
      `INSERT INTO hiring_manager_cache (query_key, result, queried_at) VALUES (?, ?, ?)
       ON CONFLICT(query_key) DO UPDATE SET result = excluded.result, queried_at = excluded.queried_at`,
    )
    .run(key, manager ? JSON.stringify(manager) : null, now.toISOString());
  return manager;
}

export function hiringManagerContact(
  vacancy: UnifiedVacancyInput,
  manager: HiringManagerProfile,
  domain: string | undefined,
  now: Date,
): RecruiterContact {
  const email = domain ? (generateEmailHypotheses(manager.fullName, domain)[0] ?? null) : null;
  return {
    id: randomUUID(),
    vacancyId: vacancy.id,
    companyName: vacancy.company ?? '',
    fullName: manager.fullName,
    roleTitle: manager.roleTitle,
    email,
    emailStatus: email ? 'hypothesis' : 'unverified',
    phone: null,
    telegram: null,
    whatsapp: null,
    linkedinUrl: manager.linkedinUrl,
    githubUrl: null,
    twitterUrl: null,
    sourceType: 'company_osint',
    confidence: 0.55,
    sourceReceipt: { receiptId: randomUUID(), source: 'company_osint', method: 'hiring_manager_lookup', observedAt: now.toISOString(), confidence: 0.55, sourceUrl: manager.linkedinUrl },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
