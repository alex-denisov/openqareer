import { DatabaseSync } from 'node:sqlite';
import { ATS_PROVIDERS, atsBoardSourceId } from './atsBoardAdapters';
import { atsBoardSource } from './atsBoardSources';
import type { RegisteredVacancySource } from './defaultVacancySources';

const SEGMENT = /^(?:[A-Za-z0-9_-]|[.]|%20){1,100}$/;

interface VerifiedBoard {
  readonly company_key: string;
  readonly company_name: string;
  readonly ats_provider: string;
  readonly ats_slug: string;
}

/** An indexed lookup for an operator-imported ATS already queued in the native sync table. */
export function readVerifiedRequestedAts(path: string, sourceId: string): RegisteredVacancySource | undefined {
  if (!sourceId.startsWith('ats-')) return undefined;
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare(`SELECT d.company_key, d.company_name, d.ats_provider, d.ats_slug
      FROM company_placement p JOIN company_directory d ON d.company_key = p.company_key
      WHERE p.source_id = ? AND p.type = 'ats' AND d.status = 'active'
        AND p.provider = d.ats_provider AND p.slug = d.ats_slug COLLATE NOCASE
        AND CASE WHEN json_valid(p.evidence) THEN json_type(p.evidence,'$.verifiedImport') END = 'object'
        AND length(trim(d.website_url)) > 0 AND length(trim(d.careers_url)) > 0
        AND length(trim(d.linkedin_url)) > 0 AND length(trim(d.linkedin_org_id)) > 0
        AND trim(d.linkedin_org_id) NOT GLOB '*[^0-9]*'
        AND length(trim(d.geo)) > 0 AND length(trim(d.industry)) > 0 AND length(trim(d.domain_group)) > 0`)
      .get(sourceId) as VerifiedBoard | undefined;
    const provider = row && ATS_PROVIDERS.find((entry) => entry.provider === row.ats_provider)?.provider;
    if (!row || !provider || !SEGMENT.test(row.ats_slug) || /^[.]+$/.test(row.ats_slug) ||
        (provider !== 'ashby' && row.ats_slug.includes('%')) ||
        atsBoardSourceId(provider, row.ats_slug) !== sourceId) return undefined;
    const source = atsBoardSource({
      provider, board: row.ats_slug, company: row.company_name, jobs: 0,
      observedAt: '', lists: ['verified-company-directory'],
    });
    return source.enabled ? { ...source, channelTier: 2, companyKey: row.company_key } : undefined;
  } finally {
    database.close();
  }
}
