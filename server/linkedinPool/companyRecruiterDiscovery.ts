import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';

export interface CompanyRecruiterProfile {
  readonly fullName: string;
  readonly roleTitle: string;
  readonly linkedinUrl?: string;
  readonly telegram?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly sourcePlatform: 'linkedin_pool' | 'company_osint' | 'vacancy_text';
  readonly sourceUrl?: string;
  readonly confidence: number;
  readonly observedAt?: string;
}

export interface StoredCompanyRecruiter {
  readonly id: string;
  readonly companyName: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly linkedinUrl: string;
  readonly observedAt: string;
}

export const LINKEDIN_COMPANY_RECRUITERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS linkedin_pool_company_recruiters (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  linkedin_url TEXT NOT NULL,
  observed_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_linkedin_pool_company_recruiters_company
  ON linkedin_pool_company_recruiters(company_name);
`;

export function ensureCompanyRecruitersSchema(database: DatabaseSync): void {
  database.exec(LINKEDIN_COMPANY_RECRUITERS_SCHEMA);
}

export function savePoolCompanyRecruiter(
  pool: SqliteLinkedinPoolRepository,
  recruiter: {
    companyName: string;
    fullName: string;
    roleTitle: string;
    linkedinUrl: string;
    observedAt?: string;
  },
): StoredCompanyRecruiter {
  const db = pool.getDatabase();
  ensureCompanyRecruitersSchema(db);
  const id = randomUUID();
  const observedAt = recruiter.observedAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO linkedin_pool_company_recruiters
      (id, company_name, full_name, role_title, linkedin_url, observed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, recruiter.companyName, recruiter.fullName, recruiter.roleTitle, recruiter.linkedinUrl, observedAt);
  return {
    id,
    companyName: recruiter.companyName,
    fullName: recruiter.fullName,
    roleTitle: recruiter.roleTitle,
    linkedinUrl: recruiter.linkedinUrl,
    observedAt,
  };
}

export async function findCompanyRecruitersFromPool(
  companyName: string,
  _domain?: string,
  pool?: SqliteLinkedinPoolRepository,
): Promise<CompanyRecruiterProfile | null> {
  if (!pool) return null;
  // Anti-ban: only accounts in 'ready' state are usable.
  const readyAccounts = pool.list({ state: 'ready', limit: 1, offset: 0 }).accounts;
  if (readyAccounts.length === 0) {
    return null;
  }

  const db = pool.getDatabase();
  ensureCompanyRecruitersSchema(db);

  const cleanCompany = companyName.trim();
  const row = db.prepare(`
    SELECT id, company_name, full_name, role_title, linkedin_url, observed_at
    FROM linkedin_pool_company_recruiters
    WHERE company_name = ? COLLATE NOCASE
    ORDER BY observed_at DESC
    LIMIT 1
  `).get(cleanCompany) as {
    id: string;
    company_name: string;
    full_name: string;
    role_title: string;
    linkedin_url: string;
    observed_at: string;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    fullName: row.full_name,
    roleTitle: row.role_title,
    linkedinUrl: row.linkedin_url,
    sourcePlatform: 'linkedin_pool',
    sourceUrl: row.linkedin_url,
    confidence: 0.9,
    observedAt: row.observed_at,
  };
}
