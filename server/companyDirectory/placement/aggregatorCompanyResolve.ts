import type { DatabaseSync } from 'node:sqlite';
import { cleanWebsite, isAggregator, nameKey } from '../freehire/freehireImport';
import { isGenericEmployerName, type LinkHow } from './aggregatorLinkage';
import { PLACEMENT_TABLES } from './placementSchema';
import { recordCompanyPlacements } from './placementWriter';
import { PRIVATE_EMPLOYER, publicEmployerName } from '../../../shared/privateEmployer';
import { transliterateToLatin } from '../../outreach/recruiterIntelligenceService';

export interface AggregatorCompanyCandidate {
  readonly company: string;
  readonly site?: string | null;
  readonly employerId?: string | number | null;
  readonly sourceId: string;
  readonly sampleVacancyId?: string | null;
  readonly employerIsPerson?: boolean;
}

export interface AutoResolvedCompany {
  readonly companyKey: string;
  readonly how: LinkHow;
}

interface FreehireCardEvidence {
  slug?: string;
  website?: string | null;
  careers?: string | null;
  employerSite?: { origin?: string | null } | null;
  boards?: readonly { provider: string; slug: string }[];
}

const LEGAL_FORM = /(?:^|[^a-z0-9а-яё])(inc|llc|ltd|limited|gmbh|ag|sa|sas|bv|corp|corporation|co|plc|oy|ab|as|srl|spa|pty|ооо|оао|зао|пао|ао)(?:\.|\b|$|[^a-z0-9а-яё])/gi;

export function companyKeyFromName(name: string): string {
  const withoutLegal = name.replace(LEGAL_FORM, ' ').trim();
  const latin = transliterateToLatin(withoutLegal);
  const slug = nameKey(latin);
  return slug || nameKey(name);
}

function findFreehireSiteAndBoards(
  database: DatabaseSync,
  keys: readonly string[],
): { site: string | null; boards: readonly { provider: string; slug: string }[] } | null {
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='freehire_company_source_candidates'").get();
  if (!table) return null;

  const select = database.prepare('SELECT evidence FROM freehire_company_source_candidates WHERE slug = ?');
  for (const k of keys) {
    if (!k || k.length < 2) continue;
    const row = (select.get(k) ?? select.get(k.split('-')[0] ?? '')) as { evidence: string } | undefined;
    if (!row) continue;
    try {
      const card = JSON.parse(row.evidence) as FreehireCardEvidence;
      const site = cleanWebsite(card.website ?? null) ??
        cleanWebsite(card.employerSite?.origin ?? null) ??
        cleanWebsite(card.careers ?? null);
      const boards = (card.boards ?? []).filter((b) => b && typeof b.provider === 'string' && typeof b.slug === 'string');
      if (site || boards.length > 0) return { site, boards };
    } catch {
      continue;
    }
  }
  return null;
}

function resolveSiteAndBoards(
  database: DatabaseSync,
  companyKey: string,
  rawKey: string,
  candidateSite: string | null | undefined,
): { cleanSite: string | null; extraBoards: readonly { provider: string; slug: string }[] } {
  const site = cleanWebsite(candidateSite ?? null);
  if (site) return { cleanSite: site, extraBoards: [] };
  const freehire = findFreehireSiteAndBoards(database, [companyKey, rawKey]);
  return { cleanSite: freehire?.site ?? null, extraBoards: freehire?.boards ?? [] };
}

function upsertCompanyDirectory(
  database: DatabaseSync,
  key: string,
  name: string,
  cleanSite: string | null,
  sourceType: string,
  stamp: string,
  evidenceObj: object,
): void {
  const hasFullSchema = database.prepare("SELECT 1 FROM pragma_table_info('company_directory') WHERE name='source_type'").get();
  if (hasFullSchema) {
    database.prepare(`
      INSERT INTO company_directory (company_key, company_name, website_url, source_type, status, created_at, updated_at, evidence)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(company_key) DO UPDATE SET
        website_url = COALESCE(company_directory.website_url, excluded.website_url),
        updated_at = excluded.updated_at
    `).run(key, name, cleanSite, sourceType, stamp, stamp, JSON.stringify(evidenceObj));
  } else {
    database.prepare(`
      INSERT INTO company_directory (company_key, company_name, website_url)
      VALUES (?, ?, ?)
      ON CONFLICT(company_key) DO UPDATE SET
        website_url = COALESCE(company_directory.website_url, excluded.website_url)
    `).run(key, name, cleanSite);
  }
}

/**
 * Auto-resolves an unlinked company from an aggregator vacancy:
 * 1. Checks if company has a valid website (from vacancy employerSite or freehire candidate cache) or employer ID.
 * 2. If valid, registers the company in `company_directory` and `company_placement`.
 * 3. Enqueues into `company_discovery_queue` (pending if no site yet, resolved if site is recorded).
 */
export function resolveCompanyFromAggregator(
  database: DatabaseSync,
  candidate: AggregatorCompanyCandidate,
  nowMs: number,
): AutoResolvedCompany | null {
  const name = candidate.company?.trim() ?? '';
  if (!name || publicEmployerName(name, candidate.employerIsPerson) === PRIVATE_EMPLOYER) return null;
  if (isGenericEmployerName(name) || isAggregator(name)) return null;

  const companyKey = companyKeyFromName(name);
  if (companyKey.length < 2) return null;

  database.exec(PLACEMENT_TABLES);
  const { cleanSite, extraBoards } = resolveSiteAndBoards(database, companyKey, nameKey(name), candidate.site);
  const employerIdStr = candidate.employerId === null || candidate.employerId === undefined ? undefined : String(candidate.employerId).trim();
  if (!cleanSite && (!employerIdStr || employerIdStr.length === 0)) {
    recordUnlinkedInQueue(database, companyKey, name, candidate.sampleVacancyId ?? null, nowMs);
    return null;
  }

  const stamp = new Date(nowMs).toISOString();
  const existing = database.prepare('SELECT company_key, website_url FROM company_directory WHERE company_key = ?').get(companyKey) as
    { company_key: string; website_url: string | null } | undefined;
  const resolvedKey = existing ? existing.company_key : companyKey;
  const sourceType = cleanSite ? 'corporate_portal' : 'aggregator';
  const evidenceObj = {
    placement: { value: candidate.sourceId, how: 'B643 aggregator vacancy auto-resolve' },
    ...(cleanSite ? { websiteUrl: { value: cleanSite, how: candidate.site ? 'aggregator employerSite' : 'freehire candidate' } } : {}),
  };

  upsertCompanyDirectory(database, resolvedKey, name, cleanSite, sourceType, stamp, evidenceObj);
  recordCompanyPlacements(database, resolvedKey, {
    boards: extraBoards,
    siteUrl: cleanSite ?? null,
    hhEmployerIds: employerIdStr ? [employerIdStr] : [],
    discoveredBy: 'aggregator_site',
  }, nowMs);
  recordResolvedQueue(database, companyKey, name, candidate.sampleVacancyId ?? null, nowMs);

  return { companyKey: resolvedKey, how: 'exact_name' };
}

function recordResolvedQueue(
  database: DatabaseSync,
  key: string,
  name: string,
  sampleVacancyId: string | null,
  nowMs: number,
): void {
  database.prepare(`
    INSERT INTO company_discovery_queue (name_key, company_name, vacancies_count, sample_vacancy_id, status, updated_at)
    VALUES (?, ?, 1, ?, 'resolved', ?)
    ON CONFLICT(name_key) DO UPDATE SET
      status = 'resolved',
      sample_vacancy_id = COALESCE(excluded.sample_vacancy_id, company_discovery_queue.sample_vacancy_id),
      updated_at = excluded.updated_at
  `).run(key, name, sampleVacancyId, nowMs);
}

export function updateCompanySiteFromAggregator(
  database: DatabaseSync,
  companyKey: string,
  rawSiteUrl: string,
  nowMs: number,
): void {
  const cleanSite = cleanWebsite(rawSiteUrl);
  if (!cleanSite) return;

  const hasUpdatedAt = database.prepare("SELECT 1 FROM pragma_table_info('company_directory') WHERE name='updated_at'").get();
  if (hasUpdatedAt) {
    const stamp = new Date(nowMs).toISOString();
    database.prepare(`
      UPDATE company_directory
         SET website_url = COALESCE(website_url, ?),
             updated_at = ?
       WHERE company_key = ? AND (website_url IS NULL OR website_url LIKE '%linkedin.com%')
    `).run(cleanSite, stamp, companyKey);
  } else {
    database.prepare(`
      UPDATE company_directory
         SET website_url = COALESCE(website_url, ?)
       WHERE company_key = ? AND (website_url IS NULL OR website_url LIKE '%linkedin.com%')
    `).run(cleanSite, companyKey);
  }

  recordCompanyPlacements(database, companyKey, {
    boards: [],
    siteUrl: cleanSite,
    discoveredBy: 'aggregator_site',
  }, nowMs);
}

function recordUnlinkedInQueue(
  database: DatabaseSync,
  nameKeyVal: string,
  companyName: string,
  sampleVacancyId: string | null,
  nowMs: number,
): void {
  database.prepare(`
    INSERT INTO company_discovery_queue (name_key, company_name, vacancies_count, sample_vacancy_id, status, updated_at)
    VALUES (?, ?, 1, ?, 'pending', ?)
    ON CONFLICT(name_key) DO UPDATE SET
      vacancies_count = company_discovery_queue.vacancies_count + 1,
      sample_vacancy_id = COALESCE(excluded.sample_vacancy_id, company_discovery_queue.sample_vacancy_id),
      updated_at = excluded.updated_at
  `).run(nameKeyVal, companyName, sampleVacancyId, nowMs);
}
