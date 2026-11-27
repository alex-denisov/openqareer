import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import directorySeed from '../../../data/companyDirectorySeed.json';
import { CompanyRegistry } from '../../../domain/companyRegistry';
import {
  BUILDIN_RU_ABROAD_SEEDS,
  DRIVE_COMPANIES_SEEDS,
  NOTION_RELOCATION_SEEDS,
  TELEGRAPH_CURRENCY_REMOTE_SEEDS,
} from '../../../domain/companySeeds';
import { normalizeCompanyName } from '../../../domain/company';
import { registerCompanyRoutes } from '../../../routes/companiesRoute';
import {
  buildMatchedVacancyPage,
  MATCHED_PAGE_BYTE_BUDGET,
  MATCHED_PAGE_ITEM_LIMIT,
  trim,
} from '../../matchedVacancyPage';
import type { MatchedVacancyItem } from '../../multiSourceVacancyEngine';

interface SeedRow {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly linkedinUrl: string | null;
  readonly linkedinOrgId: string | null;
  readonly atsProvider: string | null;
  readonly atsSlug: string | null;
  readonly geo: string | null;
  readonly industry: string | null;
  readonly domainGroup: string | null;
}

const seeds = directorySeed as readonly SeedRow[];
const appsToClose: FastifyInstance[] = [];

afterEach(async () => {
  while (appsToClose.length > 0) {
    const app = appsToClose.pop();
    if (app) await app.close();
  }
});

function makeMatchedItem(index: number, companyName: string, primaryUrl: string): MatchedVacancyItem {
  const iso = '2026-11-23T12:00:00Z';
  return {
    cluster: {
      id: `cl-${index}`,
      canonicalTitle: `Senior Engineer ${index}`,
      canonicalCompany: companyName,
      canonicalLocation: 'Abu Dhabi, UAE',
      isRemote: false,
      descriptionSummary: 'Long description summary that must be trimmed on page output.',
      skills: ['TypeScript', 'Node.js', 'SQLite', 'Kubernetes'],
      primaryUrl,
      sources: [
        {
          sourceType: 'json_api',
          sourceId: 'ats-phenom-careers.g42.ai',
          sourceUrl: primaryUrl,
          observedAt: iso,
        },
      ],
      firstObservedAt: iso,
      lastSeenAt: iso,
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: `cl-${index}`,
      roleMatch: 'target',
      levelMatch: 'match',
      matchingPoints: ['TypeScript', 'Node.js', 'Kubernetes', 'SQLite'],
      missingPoints: ['Rust', 'Go', 'Kafka', 'Terraform'],
      summary: 'Strong match',
      calculatedAt: iso,
    },
  };
}

describe('E2E-5: Seed Migration, Unified /api/v1/companies & matchedVacancyPage SSOT (F8, F9)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 companyDirectorySeed.json includes migrated companies from companySeeds.json', () => {
    const dirNames = new Set(seeds.map((s) => normalizeCompanyName(s.companyName)));
    const seedNames = new Set<string>();
    for (const r of NOTION_RELOCATION_SEEDS) seedNames.add(normalizeCompanyName(r.company));
    for (const r of TELEGRAPH_CURRENCY_REMOTE_SEEDS) seedNames.add(normalizeCompanyName(r.company));
    for (const r of BUILDIN_RU_ABROAD_SEEDS) seedNames.add(normalizeCompanyName(r.company));
    for (const r of DRIVE_COMPANIES_SEEDS) seedNames.add(normalizeCompanyName(r.company));

    const missing = [...seedNames].filter((name) => name && !dirNames.has(name));
    expect(missing.length).toBeLessThanOrEqual(5);
  });

  it('T1.2 Core42 & G42 exist in companyDirectorySeed.json with verified orgIds and g42.ai portals', () => {
    const core42 = seeds.find((s) => s.companyKey === 'core42');
    const g42 = seeds.find((s) => s.companyKey === 'g42');
    expect(core42).toBeDefined();
    expect(g42).toBeDefined();
    expect(core42?.linkedinOrgId).toBe('20800');
    expect(g42?.linkedinOrgId).toBe('14598162');
    expect(core42?.careersUrl ?? '').toContain('careers.g42.ai');
    expect(g42?.careersUrl ?? '').toContain('g42.ai');
  });

  it('T1.3 CompanyRegistry loads unified SSOT including companyDirectorySeed companies', () => {
    const registry = new CompanyRegistry();
    registry.loadOwnerLists();
    const core42 = registry.findByName('Core42');
    const g42 = registry.findByName('G42');
    expect(core42).toBeDefined();
    expect(g42).toBeDefined();
    expect(registry.getAll().length).toBeGreaterThanOrEqual(seeds.length);
  });

  it('T1.4 GET /api/v1/companies filters by search and has_ats over unified SSOT', async () => {
    const app = Fastify();
    appsToClose.push(app);
    await app.register(registerCompanyRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/v1/companies?search=Core42' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; items: Array<{ name: string }> };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.some((c) => /core42/i.test(c.name))).toBe(true);
  });

  it('T1.5 GET /api/v1/companies/:id returns enriched Core42 details', async () => {
    const app = Fastify();
    appsToClose.push(app);
    await app.register(registerCompanyRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/v1/companies/core42' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { company: { name: string; websiteUrl?: string } };
    expect(body.company.name).toMatch(/Core42/i);
  });

  it('T1.6 buildMatchedVacancyPage resolves companyFeatures from unified SSOT', () => {
    const trimmed = trim(
      makeMatchedItem(1, 'Core42', 'https://careers.g42.ai/core42/global/en/job/C42-1001'),
    );
    expect(trimmed.cluster.companyFeatures).toBeDefined();
    expect(trimmed.cluster.companyFeatures?.industry).toBeTruthy();
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 companyDirectorySeed.json contains no duplicate companyKey entries', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const row of seeds) {
      if (seen.has(row.companyKey)) dupes.push(row.companyKey);
      seen.add(row.companyKey);
    }
    expect(dupes).toEqual([]);
  });

  it('T2.2 GET /api/v1/companies returns 400 invalid_query_parameters on limit=9999 or has_ats=invalid', async () => {
    const app = Fastify();
    appsToClose.push(app);
    await app.register(registerCompanyRoutes);

    const badLimit = await app.inject({ method: 'GET', url: '/api/v1/companies?limit=9999' });
    expect(badLimit.statusCode).toBe(400);
    expect((badLimit.json() as { error: string }).error).toBe('invalid_query_parameters');

    const badBool = await app.inject({ method: 'GET', url: '/api/v1/companies?has_ats=invalid' });
    expect(badBool.statusCode).toBe(400);
  });

  it('T2.3 GET /api/v1/companies/:id returns 404 company_not_found for unknown id', async () => {
    const app = Fastify();
    appsToClose.push(app);
    await app.register(registerCompanyRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/v1/companies/nonexistent-company-xyz' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('company_not_found');
  });

  it('T2.4 buildMatchedVacancyPage enforces MATCHED_PAGE_BYTE_BUDGET and MATCHED_PAGE_ITEM_LIMIT', () => {
    const items = Array.from({ length: 45 }, (_, i) =>
      makeMatchedItem(i, 'Stripe', `https://boards.greenhouse.io/stripe/jobs/${i}`),
    );
    const page = buildMatchedVacancyPage(items, 0);
    expect(page.items.length).toBeLessThanOrEqual(MATCHED_PAGE_ITEM_LIMIT);
    expect(Buffer.byteLength(JSON.stringify(page.items), 'utf8')).toBeLessThanOrEqual(MATCHED_PAGE_BYTE_BUDGET);
    expect(page.nextOffset).toBe(page.items.length);
  });

  it('T2.5 companyDirectorySeed entries obey company source contract (zero linkedin ?keywords= search URLs)', () => {
    const badLinkedinUrls = seeds.filter((s) => s.linkedinUrl && /keywords=/i.test(s.linkedinUrl));
    expect(badLinkedinUrls).toEqual([]);
  });
});
