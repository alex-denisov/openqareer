/**
 * Company Directory Schema.
 *
 * Stores the canonical company directory for OpenQareer:
 * - company_key: unique normalized key (e.g. 'uzum', 'plata-card', 'databricks')
 * - company_name: official company name
 * - website_url: corporate homepage (e.g. 'https://uzum.com', 'https://platacard.mx')
 * - careers_url: official careers section/portal (e.g. 'https://people.uzum.com/career', 'https://plata.careers/')
 * - linkedin_url: direct link to company jobs on LinkedIn (e.g. 'https://www.linkedin.com/company/uzum-uz/jobs/')
 * - linkedin_org_id: exact organization ID (f_C) if known
 * - source_type: 'corporate_portal' | 'ats_direct' | 'linkedin_guest'
 * - ats_provider: 'greenhouse' | 'lever' | 'ashby' | 'bamboohr' | 'smartrecruiters' | 'recruitee' | null
 * - ats_slug: ATS board slug if applicable
 * - status: 'active' | 'dormant'
 * - geo: target geographies (countries, remote)
 * - industry: industry taxonomy
 * - domain_group: domain group
 * - notes: company description and context
 *
 * Used for referral routing, company intelligence, and vacancy ingestion.
 */

export const COMPANY_DIRECTORY_TABLE = 'company_directory';

export const COMPANY_DIRECTORY_MIGRATION = `
CREATE TABLE IF NOT EXISTS ${COMPANY_DIRECTORY_TABLE} (
  company_key TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  website_url TEXT,
  careers_url TEXT,
  linkedin_url TEXT,
  linkedin_org_id TEXT,
  source_type TEXT NOT NULL,
  ats_provider TEXT,
  ats_slug TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  geo TEXT,
  industry TEXT,
  domain_group TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_company_directory_name ON ${COMPANY_DIRECTORY_TABLE}(company_name);
CREATE INDEX IF NOT EXISTS idx_company_directory_source_type ON ${COMPANY_DIRECTORY_TABLE}(source_type);
CREATE INDEX IF NOT EXISTS idx_company_directory_status ON ${COMPANY_DIRECTORY_TABLE}(status);
`;
