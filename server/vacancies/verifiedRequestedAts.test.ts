import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { readVerifiedRequestedAts } from './verifiedRequestedAts';

it('registers the exact verified board only after its profile and ownership agree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oq-verified-ats-'));
  const path = join(dir, 'test.db');
  const db = new DatabaseSync(path);
  const sourceId = 'ats-ashby-Abode%20Money';
  try {
    db.exec(`
      CREATE TABLE company_directory (
        company_key, company_name, ats_provider, ats_slug, status, website_url,
        careers_url, linkedin_url, linkedin_org_id, geo, industry, domain_group
      );
      CREATE TABLE company_placement (company_key, source_id UNIQUE, type, provider, slug, evidence);
      INSERT INTO company_directory VALUES (
        'abode', 'Abode Money', 'ashby', 'Abode%20Money', 'active', 'https://abodemoney.com/',
        'https://jobs.ashbyhq.com/Abode%20Money', 'https://www.linkedin.com/company/abode-money/jobs/',
        '101801760', 'United States', 'Financial Services', NULL
      );
      INSERT INTO company_placement VALUES (
        'abode', 'ats-ashby-Abode%20Money', 'ats', 'ashby', 'abode%20money', '{"verifiedImport":{}}'
      );
    `);
    expect(readVerifiedRequestedAts(path, sourceId)).toBeUndefined();
    db.exec("UPDATE company_directory SET domain_group = 'Fintech'");
    expect(readVerifiedRequestedAts(path, sourceId)).toMatchObject({
      id: sourceId,
      companyKey: 'abode',
      targetUrl: 'https://api.ashbyhq.com/posting-api/job-board/Abode%20Money',
      channelTier: 2,
    });
    expect(readVerifiedRequestedAts(path, 'ats-ashby-abode%20money')).toBeUndefined();
    db.exec("UPDATE company_placement SET evidence = '{}'");
    expect(readVerifiedRequestedAts(path, sourceId)).toBeUndefined();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
