import { afterEach, describe, expect, it } from 'vitest';
import { LinkedinOrgRunner } from '../../../companyDirectory/linkedinOrg/linkedinOrgRunner';
import { LinkedinOrgStore } from '../../../companyDirectory/linkedinOrg/linkedinOrgStore';
import { resolveCompany } from '../../../companyDirectory/siteDiscovery/deterministicResolver';
import { DirectAtsDiscovery } from '../../../companyDirectory/siteDiscovery/directAtsDiscovery';
import {
  isPublicHost,
  readPendingPage,
  writeDiscovery,
} from '../../../companyDirectory/siteDiscovery/siteDiscovery';
import { PendingQueue, runSiteDiscoveryTick } from '../../../companyDirectory/siteDiscovery/siteDiscoverySchedule';
import { createLinkedinGuestBudget } from '../../linkedinGuestBudget';
import { SqliteVacancyDemandStore } from '../../vacancyDemandStore';
import { createMockFetchRouter, restoreMockFetch } from './helpers/mockFetch';
import {
  cleanupAllSqliteHarnesses,
  createMemoryDb,
  seedDirectoryCompany,
  seedFreehireCandidate,
  seedVacancyCompany,
} from './helpers/sqliteHarness';

afterEach(() => {
  restoreMockFetch();
  cleanupAllSqliteHarnesses();
});

describe('E2E-11: Demand-Prioritized Empty-Row Enrichment & Proxy Quota (F15)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 demand ordering prioritizes empty rows matching vacancy_demand_terms and vacancy_company count', async () => {
    const db = createMemoryDb();
    const demand = new SqliteVacancyDemandStore(db);
    demand.record(['Platform Engineer', 'AI Architect'], Date.UTC(2026, 10, 24));

    seedDirectoryCompany(db, {
      companyKey: 'low-demand-co',
      companyName: 'LowDemand Co',
      websiteUrl: 'https://lowdemand.example/',
      sourceType: 'corporate_portal',
    });
    seedDirectoryCompany(db, {
      companyKey: 'high-demand-co',
      companyName: 'HighDemand Platform Engineer Co',
      websiteUrl: null,
      sourceType: 'linkedin_guest',
    });
    for (let i = 0; i < 5; i += 1) seedVacancyCompany(db, `vac-hd-${i}`, 'high-demand-co');

    const queue = new PendingQueue(db);
    const batch = await queue.next(10);
    expect(batch.length).toBeGreaterThanOrEqual(2);
    expect(batch[0]?.companyKey).toBe('high-demand-co');
  });

  it('T1.2 site discovery enriches website_url and careers_url for empty company row', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'empty-row-co',
      companyName: 'EmptyRow',
      sourceType: 'linkedin_guest',
    });
    const router = createMockFetchRouter([
      {
        match: 'emptyrow.com',
        respond: {
          status: 200,
          body: '<html><body><a href="/careers">Careers</a></body></html>',
        },
      },
      {
        match: 'emptyrow.com/careers',
        respond: {
          status: 200,
          body: '<html><body><h1>Careers</h1><a href="/jobs/1">Backend Engineer</a></body></html>',
        },
      },
    ]);

    const res = await runSiteDiscoveryTick(
      db,
      router.fetch,
      new Date('2026-11-24T12:00:00Z'),
      new PendingQueue(db),
      async () => true,
    );
    expect(res.checked).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT website_url, careers_url FROM company_directory WHERE company_key = ?')
      .get('empty-row-co') as { website_url: string | null; careers_url: string | null };
    expect(row.website_url || row.careers_url).toBeTruthy();
  });

  it('T1.3 DirectAtsDiscovery probes freehire_company_source_candidates boards and records jobs > 0', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'direct-probe-co',
      companyName: 'DirectProbe',
      websiteUrl: 'https://directprobe.example/',
      evidence: { freehire: { value: 'direct-probe-co', how: 'freehire' } },
    });
    seedFreehireCandidate(db, 'direct-probe-co', {
      slug: 'direct-probe-co',
      name: 'DirectProbe',
      boards: [{ provider: 'greenhouse', slug: 'directprobe' }],
      jobs: [{ url: 'https://boards.greenhouse.io/directprobe/jobs/101' }],
    });

    const direct = new DirectAtsDiscovery(
      db,
      async (provider, slug) => (provider === 'greenhouse' && slug === 'directprobe' ? 7 : 0),
      new Map(),
    );
    const probeRes = await direct.probe(
      {
        companyKey: 'direct-probe-co',
        companyName: 'DirectProbe',
        websiteUrl: 'https://directprobe.example/',
        linkedinUrl: null,
        freehireSlug: 'direct-probe-co',
        hasFreehireBoards: true,
      },
      new Date('2026-11-24T12:00:00Z'),
    );
    expect(probeRes.checked).toBe(1);
    expect(probeRes.live).toBe(1);
  });

  it('T1.4 LinkedinOrgRunner resolves linkedin_org_id within shared budget quota', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'org-resolve-co',
      companyName: 'OrgResolve',
      websiteUrl: 'https://orgresolve.example/',
      linkedinUrl: 'https://www.linkedin.com/company/orgresolve/jobs/',
      sourceType: 'corporate_portal',
    });
    const store = new LinkedinOrgStore(db);
    const budget = createLinkedinGuestBudget({ baseGapMs: 1, sleep: async () => undefined });
    const runner = new LinkedinOrgRunner({
      store,
      budget,
      minGapMs: 1,
      sleep: async () => undefined,
      log: { info: () => undefined, warn: () => undefined },
      fetchPage: async (url) => {
        if (url.includes('orgresolve.example')) {
          return {
            status: 200,
            finalUrl: url,
            body: '<a href="https://www.linkedin.com/company/orgresolve/">LI</a>',
          };
        }
        if (url.includes('seeMoreJobPostings')) {
          return {
            status: 200,
            finalUrl: url,
            body: '<ul><li><span>urn:li:jobPosting:990011</span><a href="https://www.linkedin.com/company/orgresolve/">OrgResolve</a></li></ul>',
          };
        }
        return {
          status: 200,
          finalUrl: url,
          body: '<meta name="companyId" content="55443322" /><a class="topcard__org-name-link" href="https://www.linkedin.com/company/orgresolve/">OrgResolve</a>',
        };
      },
    });
    const step = await runner.step();
    expect(step.kind).toBe('done');
    const row = db
      .prepare('SELECT linkedin_org_id FROM company_directory WHERE company_key = ?')
      .get('org-resolve-co') as { linkedin_org_id: string | null };
    expect(row.linkedin_org_id).toBe('55443322');
  });

  it('T1.5 readPendingPage keyset pagination processes 500+ rows without skipping or repeating', () => {
    const db = createMemoryDb();
    for (let i = 0; i < 520; i += 1) {
      const key = `empty-${String(i).padStart(4, '0')}`;
      seedDirectoryCompany(db, {
        companyKey: key,
        companyName: `Empty ${i}`,
        websiteUrl: `https://${key}.example/`,
      });
    }
    const seen: string[] = [];
    let after = '';
    for (;;) {
      const page = readPendingPage(db, after, 100);
      for (const row of page) seen.push(row.companyKey);
      if (page.length < 100) break;
      after = page.at(-1)!.companyKey;
    }
    expect(seen).toHaveLength(520);
    expect(new Set(seen).size).toBe(520);
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 proxy quota exhaustion pauses LinkedinOrgRunner cleanly without spinning', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'quota-co',
      companyName: 'QuotaCo',
      websiteUrl: 'https://quota.example/',
      linkedinUrl: 'https://www.linkedin.com/company/quota/jobs/',
    });
    const store = new LinkedinOrgStore(db);
    const budget = createLinkedinGuestBudget({ baseGapMs: 1, sleep: async () => undefined });
    budget.markRateLimited();

    let calls = 0;
    const runner = new LinkedinOrgRunner({
      store,
      budget,
      log: { info: () => undefined, warn: () => undefined },
      fetchPage: async () => {
        calls += 1;
        return { status: 200, finalUrl: '', body: '' };
      },
    });
    const step = await runner.step();
    expect(step.kind).toBe('cooldown');
    expect(calls).toBe(0);
  });

  it('T2.2 droppedCareersUrl is preserved in pending row and never re-added by resolver', async () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'pruned-co',
      companyName: 'PrunedCo',
      websiteUrl: 'https://pruned.example/',
      evidence: { careersUrlDropped: { value: 'https://pruned.example/careers', how: 'B643 404' } },
    });
    const rows = readPendingPage(db, '', 10);
    expect(rows[0]?.droppedCareersUrl).toBe('https://pruned.example/careers');

    const router = createMockFetchRouter([
      { match: 'https://pruned.example/', respond: { status: 200, body: '<a href="/careers">Careers</a>' } },
      { match: 'https://pruned.example/careers', respond: { status: 200, body: '<a href="/jobs/1">Engineer</a>' } },
      { match: 'https://pruned.example/jobs', respond: { status: 404, body: '' } },
    ]);
    const found = await resolveCompany(rows[0]!, router.fetch, '2026-11-24', async () => true);
    expect(found.careersUrl).toBeUndefined();
    writeDiscovery(db, found, '2026-11-24T12:00:00Z');
    const updated = db
      .prepare('SELECT careers_url FROM company_directory WHERE company_key = ?')
      .get('pruned-co') as { careers_url: string | null };
    expect(updated.careers_url).toBeNull();
  });

  it('T2.3 SSRF / non-public host check rejects metadata IP 169.254.169.254 and RFC1918 10.0.0.1', () => {
    expect(isPublicHost(new URL('http://169.254.169.254/latest/meta-data/'))).toBe(false);
    expect(isPublicHost(new URL('http://10.0.0.1/admin'))).toBe(false);
    expect(isPublicHost(new URL('https://127.0.0.1/careers'))).toBe(false);
    expect(isPublicHost(new URL('https://careers.g42.ai/careers-home/'))).toBe(true);
  });

  it('T2.4 ambiguous ATS match stays in evidence without promoting ats_provider', () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'ambig-co',
      companyName: 'AmbigCo',
      websiteUrl: 'https://ambig.example/',
    });
    writeDiscovery(
      db,
      {
        companyKey: 'ambig-co',
        evidence: { atsAmbiguous: { value: ['greenhouse:a', 'lever:b'], how: 'multiple boards' } },
      },
      '2026-11-24T12:00:00Z',
    );
    const row = db
      .prepare('SELECT ats_provider, evidence FROM company_directory WHERE company_key = ?')
      .get('ambig-co') as { ats_provider: string | null; evidence: string };
    expect(row.ats_provider).toBeNull();
    expect(JSON.parse(row.evidence).atsAmbiguous).toBeDefined();
  });

  it('T2.5 dormant companies are excluded from readPendingPage enrichment queue', () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, {
      companyKey: 'dormant-co',
      companyName: 'DormantCo',
      websiteUrl: 'https://dormant.example/',
      status: 'dormant',
    });
    expect(readPendingPage(db, '', 20)).toEqual([]);
  });
});
