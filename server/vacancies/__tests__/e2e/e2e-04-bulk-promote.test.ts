import { afterEach, describe, expect, it } from 'vitest';
import { dynamicLoadPromoteFn } from './helpers/engineHarness';
import {
  cleanupAllSqliteHarnesses,
  createMemoryDb,
  seedDirectoryCompany,
  seedFreehireCandidate,
} from './helpers/sqliteHarness';

afterEach(() => {
  cleanupAllSqliteHarnesses();
});

describe('E2E-4: Bulk Promote freehire_company_source_candidates (F7)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 keyset-paged bulk promote transfers verified website_url into empty company_directory row', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote, 'F7 promoteFreehireCandidates module must be implemented').not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'empty-web-co',
      companyName: 'EmptyWeb Co',
      sourceType: 'linkedin_guest',
    });
    seedFreehireCandidate(db, 'empty-web-co', {
      slug: 'empty-web-co',
      name: 'EmptyWeb Co',
      website: 'https://emptyweb.example/',
      jobs: [],
    });

    const summary = await promote!(db, { chunkSize: 100 });
    expect(summary.promoted).toBeGreaterThanOrEqual(1);
    expect(summary.websitesFilled).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT website_url FROM company_directory WHERE company_key = ?')
      .get('empty-web-co') as { website_url: string | null };
    expect(row.website_url).toBe('https://emptyweb.example/');
  });

  it('T1.2 promotes verified linkedin_url and linkedin_org_id into company_directory', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'li-cand-co',
      companyName: 'LiCand Co',
      sourceType: 'linkedin_guest',
    });
    seedFreehireCandidate(db, 'li-cand-co', {
      slug: 'li-cand-co',
      name: 'LiCand Co',
      linkedinUrl: 'https://www.linkedin.com/company/licand-co/jobs/',
      linkedinOrgId: '98765432',
    });

    const summary = await promote!(db, { chunkSize: 100 });
    expect(summary.linkedinsFilled).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT linkedin_url, linkedin_org_id FROM company_directory WHERE company_key = ?')
      .get('li-cand-co') as { linkedin_url: string | null; linkedin_org_id: string | null };
    expect(row.linkedin_url).toContain('linkedin.com/company/licand-co');
    expect(row.linkedin_org_id).toBe('98765432');
  });

  it('T1.3 promotes verified careers_url and records careersUrlSetAt evidence', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'careers-cand-co',
      companyName: 'CareersCand Co',
      websiteUrl: 'https://careerscand.example/',
      sourceType: 'corporate_portal',
    });
    seedFreehireCandidate(db, 'careers-cand-co', {
      slug: 'careers-cand-co',
      name: 'CareersCand Co',
      website: 'https://careerscand.example/',
      careers: 'https://careerscand.example/careers',
    });

    const summary = await promote!(db, { chunkSize: 100 });
    expect(summary.careersFilled).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT careers_url, evidence FROM company_directory WHERE company_key = ?')
      .get('careers-cand-co') as { careers_url: string | null; evidence: string | null };
    expect(row.careers_url).toBe('https://careerscand.example/careers');
    expect(JSON.parse(row.evidence ?? '{}').careersUrlSetAt).toBeDefined();
  });

  it('T1.4 promotes verified ATS board into company_directory and company_placement', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'ats-cand-co',
      companyName: 'AtsCand Co',
      websiteUrl: 'https://atscand.example/',
      sourceType: 'linkedin_guest',
    });
    seedFreehireCandidate(db, 'ats-cand-co', {
      slug: 'ats-cand-co',
      name: 'AtsCand Co',
      website: 'https://atscand.example/',
      boards: [{ provider: 'greenhouse', slug: 'atscandco' }],
    });

    const summary = await promote!(db, { chunkSize: 100 });
    expect(summary.boardsPromoted).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT ats_provider, ats_slug, source_type FROM company_directory WHERE company_key = ?')
      .get('ats-cand-co') as { ats_provider: string | null; ats_slug: string | null; source_type: string };
    expect(row.ats_provider).toBe('greenhouse');
    expect(row.ats_slug).toBe('atscandco');
    expect(row.source_type).toBe('ats_direct');
  });

  it('T1.5 idempotent re-run produces 0 duplicate placements or redundant overwrites', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'idem-co',
      companyName: 'Idem Co',
      sourceType: 'linkedin_guest',
    });
    seedFreehireCandidate(db, 'idem-co', {
      slug: 'idem-co',
      name: 'Idem Co',
      website: 'https://idem.example/',
      boards: [{ provider: 'lever', slug: 'idemco' }],
    });

    const first = await promote!(db, { chunkSize: 100 });
    expect(first.promoted).toBeGreaterThanOrEqual(1);
    const second = await promote!(db, { chunkSize: 100 });
    expect(second.promoted).toBe(0);
    const placements = db
      .prepare('SELECT count(*) AS cnt FROM company_placement WHERE company_key = ?')
      .get('idem-co') as { cnt: number };
    expect(placements.cnt).toBeLessThanOrEqual(2);
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 never overwrites existing non-null ats_provider, website_url, or careers_url', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'preserve-co',
      companyName: 'Preserve Co',
      websiteUrl: 'https://official.example/',
      careersUrl: 'https://official.example/jobs',
      atsProvider: 'ashby',
      atsSlug: 'official-ashby',
      sourceType: 'ats_direct',
    });
    seedFreehireCandidate(db, 'preserve-co', {
      slug: 'preserve-co',
      name: 'Preserve Co',
      website: 'https://other.example/',
      careers: 'https://other.example/careers',
      boards: [{ provider: 'greenhouse', slug: 'other-gh' }],
    });

    await promote!(db, { chunkSize: 100 });
    const row = db
      .prepare('SELECT website_url, careers_url, ats_provider, ats_slug FROM company_directory WHERE company_key = ?')
      .get('preserve-co') as {
      website_url: string;
      careers_url: string;
      ats_provider: string;
      ats_slug: string;
    };
    expect(row.website_url).toBe('https://official.example/');
    expect(row.careers_url).toBe('https://official.example/jobs');
    expect(row.ats_provider).toBe('ashby');
    expect(row.ats_slug).toBe('official-ashby');
  });

  it('T2.2 rejects aggregator domains and non-public/SSRF hosts (127.0.0.1, http://, indeed.com)', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'ssrf-co',
      companyName: 'SSRF Co',
      sourceType: 'linkedin_guest',
    });
    seedFreehireCandidate(db, 'ssrf-co', {
      slug: 'ssrf-co',
      name: 'SSRF Co',
      website: 'http://127.0.0.1:8080/internal',
      careers: 'https://www.indeed.com/cmp/ssrf-co',
    });

    await promote!(db, { chunkSize: 100 });
    const row = db
      .prepare('SELECT website_url, careers_url FROM company_directory WHERE company_key = ?')
      .get('ssrf-co') as { website_url: string | null; careers_url: string | null };
    expect(row.website_url).toBeNull();
    expect(row.careers_url).toBeNull();
  });

  it('T2.3 skips malformed JSON in candidate evidence column without aborting batch', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, { companyKey: 'valid-after-bad', companyName: 'Valid After Bad' });
    seedFreehireCandidate(db, 'aaa-malformed', '{invalid json');
    seedFreehireCandidate(db, 'valid-after-bad', {
      slug: 'valid-after-bad',
      name: 'Valid After Bad',
      website: 'https://validafterbad.example/',
    });

    const summary = await promote!(db, { chunkSize: 10 });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT website_url FROM company_directory WHERE company_key = ?')
      .get('valid-after-bad') as { website_url: string | null };
    expect(row.website_url).toBe('https://validafterbad.example/');
  });

  it('T2.4 respects careersUrlDropped evidence and never re-promotes a pruned careers_url', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'dropped-co',
      companyName: 'Dropped Co',
      websiteUrl: 'https://dropped.example/',
      evidence: {
        careersUrlDropped: { value: 'https://dropped.example/careers', how: 'B643 404' },
      },
    });
    seedFreehireCandidate(db, 'dropped-co', {
      slug: 'dropped-co',
      name: 'Dropped Co',
      careers: 'https://dropped.example/careers',
    });

    await promote!(db, { chunkSize: 100 });
    const row = db
      .prepare('SELECT careers_url FROM company_directory WHERE company_key = ?')
      .get('dropped-co') as { careers_url: string | null };
    expect(row.careers_url).toBeNull();
  });

  it('T2.5 keyset cursor handles empty table and partial final chunk (< chunkSize) cleanly', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const emptyDb = createMemoryDb();
    const emptyRes = await promote!(emptyDb, { chunkSize: 5 });
    expect(emptyRes.scanned).toBe(0);
    expect(emptyRes.promoted).toBe(0);

    const db = createMemoryDb();
    for (let i = 0; i < 7; i += 1) {
      const key = `chunk-co-${i}`;
      seedDirectoryCompany(db, { companyKey: key, companyName: `Chunk Co ${i}` });
      seedFreehireCandidate(db, key, {
        slug: key,
        name: `Chunk Co ${i}`,
        website: `https://${key}.example/`,
      });
    }
    const res = await promote!(db, { chunkSize: 3 });
    expect(res.scanned).toBe(7);
    expect(res.websitesFilled).toBe(7);
  });

  it('T2.6 promotes paycom ATS boards without provider exclusion', async () => {
    const promote = await dynamicLoadPromoteFn();
    expect(promote).not.toBeNull();

    const db = createMemoryDb();
    seedDirectoryCompany(db, { companyKey: 'paycom-cand', companyName: 'Paycom Cand' });
    seedFreehireCandidate(db, 'paycom-cand', {
      slug: 'paycom-cand',
      name: 'Paycom Cand',
      boards: [{ provider: 'paycom', slug: '0012604c8f3328ef1785c7189f1333b7' }],
    });

    const summary = await promote!(db, { chunkSize: 10 });
    expect(summary.boardsPromoted).toBe(1);
    const row = db
      .prepare('SELECT ats_provider, ats_slug FROM company_directory WHERE company_key = ?')
      .get('paycom-cand') as { ats_provider: string | null; ats_slug: string | null };
    expect(row.ats_provider).toBe('paycom');
    expect(row.ats_slug).toBe('0012604c8f3328ef1785c7189f1333b7');
  });
});
