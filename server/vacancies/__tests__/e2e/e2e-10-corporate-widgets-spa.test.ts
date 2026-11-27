import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../../../domain/unifiedVacancy';
import { gateCorporateVacancies } from '../../corporateSourceQuality';
import { detectEmbeddedAts } from '../../embeddedAtsDetector';
import { fetchGenericCorporateVacancies } from '../../genericCorporateSiteAdapter';
import { hasScriptPageSigns } from '../../scriptPageSigns';
import { CORPORATE_SAMPLES } from './helpers/atsWaveFixtures';
import { makeSource, makeVacancy } from './helpers/engineHarness';
import { createMockFetchRouter, restoreMockFetch } from './helpers/mockFetch';
import wave1Payloads from './fixtures/wave1AtsPayloads.json';
import wave3Payloads from './fixtures/wave3AtsPayloads.json';

afterEach(() => {
  restoreMockFetch();
});

describe('E2E-10: genericCorporateSiteAdapter Widgets & SPA Extraction (F14)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 extracts embedded Wave 1-3 ATS widgets (comeet, phenom, successfactors, workstream, greenhouse, lever)', () => {
    expect(detectEmbeddedAts(CORPORATE_SAMPLES.embeddedGreenhouse.html)?.provider).toBe('greenhouse');
    expect(detectEmbeddedAts(CORPORATE_SAMPLES.embeddedLever.html)?.provider).toBe('lever');
    expect((detectEmbeddedAts(CORPORATE_SAMPLES.embeddedComeet.html)?.provider as string)).toBe('comeet');
    expect((detectEmbeddedAts(CORPORATE_SAMPLES.embeddedPhenom.html)?.provider as string)).toBe('phenom');
    expect((detectEmbeddedAts(CORPORATE_SAMPLES.embeddedSuccessFactors.html)?.provider as string)).toBe('successfactors');
    expect((detectEmbeddedAts(CORPORATE_SAMPLES.embeddedWorkstream.html)?.provider as string)).toBe('workstream');
  });

  it('T1.2 extracts jobs from SPA script-rendered page via renderScriptPage', async () => {
    const spa = CORPORATE_SAMPLES.spaShell;
    expect(hasScriptPageSigns(spa.shellHtml)).toBe(true);
    createMockFetchRouter([{ match: spa.url, respond: { status: 200, body: spa.shellHtml } }]).install();

    const src = makeSource({
      id: 'src-company-site-spacorp',
      name: spa.company,
      type: 'career_site',
      targetUrl: spa.url,
    });
    const jobs = await fetchGenericCorporateVacancies(src, undefined, async () => spa.renderedHtml);
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs.some((j) => j.title.includes('Backend Platform Engineer'))).toBe(true);
  });

  it('T1.3 extracts jobs from JSON-LD @graph payload', async () => {
    const sample = CORPORATE_SAMPLES.jsonLdGraph;
    createMockFetchRouter([{ match: sample.url, respond: { status: 200, body: sample.html } }]).install();
    const src = makeSource({
      id: 'src-company-site-jsonld',
      name: sample.company,
      type: 'career_site',
      targetUrl: sample.url,
    });
    const jobs = await fetchGenericCorporateVacancies(src);
    expect(jobs).toHaveLength(2);
    expect(jobs.some((j) => j.isRemote === true)).toBe(true);
  });

  it('T1.4 extracts jobs from __NEXT_DATA__ payload', async () => {
    const sample = CORPORATE_SAMPLES.nextDataSample;
    createMockFetchRouter([{ match: sample.url, respond: { status: 200, body: sample.html } }]).install();
    const src = makeSource({
      id: 'src-company-site-next',
      name: sample.company,
      type: 'career_site',
      targetUrl: sample.url,
    });
    const jobs = await fetchGenericCorporateVacancies(src);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toContain('Staff Frontend Engineer');
  });

  it('T1.5 extracts jobs from semantic JOB_ANCHOR_SELECTOR links and sitemap fallback', async () => {
    const semantic = CORPORATE_SAMPLES.semanticAnchors;
    createMockFetchRouter([{ match: semantic.url, respond: { status: 200, body: semantic.html } }]).install();
    const semanticJobs = await fetchGenericCorporateVacancies(
      makeSource({
        id: 'src-company-site-semantic',
        name: semantic.company,
        type: 'career_site',
        targetUrl: semantic.url,
      }),
    );
    expect(semanticJobs.length).toBeGreaterThanOrEqual(2);

    const sm = CORPORATE_SAMPLES.sitemapFallback;
    createMockFetchRouter([
      { match: sm.url, respond: { status: 200, body: sm.landingHtml } },
      { match: 'sitemap', respond: { status: 200, body: sm.sitemapXml } },
    ]).install();
    const sitemapJobs = await fetchGenericCorporateVacancies(
      makeSource({
        id: 'src-company-site-sitemap',
        name: sm.company,
        type: 'career_site',
        targetUrl: sm.url,
      }),
    );
    expect(sitemapJobs.length).toBeGreaterThanOrEqual(2);
  });

  it('T1.6 gateCorporateVacancies passes >=50% valid company-domain and matching-ATS vacancies', () => {
    const vacancies: UnifiedVacancy[] = [
      makeVacancy({
        id: 'c1',
        title: 'Senior Go Engineer',
        company: 'Overwolf',
        url: 'https://careers.overwolf.com/jobs/senior-go',
      }),
      makeVacancy({
        id: 'c2',
        title: 'Gameplay Platform Engineer',
        company: 'Overwolf',
        url: 'https://www.comeet.com/jobs/overwolf/B1.001/gameplay/CM-1',
      }),
    ];
    const verdict = gateCorporateVacancies(vacancies, ['https://careers.overwolf.com/jobs'], 'Overwolf');
    expect(verdict.passed).toBe(true);
    expect(verdict.kept).toHaveLength(2);
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 rejects navigation titles and listing URLs (?department=)', () => {
    const verdict = gateCorporateVacancies(
      [
        makeVacancy({ id: 'n1', title: 'All jobs', url: 'https://acme.example/jobs' }),
        makeVacancy({ id: 'n2', title: 'View Openings', url: 'https://acme.example/jobs?department=eng' }),
        makeVacancy({ id: 'n3', title: '[object Object]', url: 'https://acme.example/jobs/123' }),
      ],
      ['https://acme.example/careers'],
      'Acme',
    );
    expect(verdict.kept).toHaveLength(0);
    expect(verdict.rejected.bad_title).toBe(3);
    expect(verdict.passed).toBe(false);
  });

  it('T2.2 rejects foreign ATS boards and aggregator links (dou.ua, linkedin.com)', () => {
    const verdict = gateCorporateVacancies(
      [
        makeVacancy({
          id: 'f1',
          title: 'Backend Engineer',
          url: 'https://www.comeet.com/jobs/tripleten/A1.001/backend',
        }),
        makeVacancy({
          id: 'f2',
          title: 'QA Engineer',
          url: 'https://jobs.dou.ua/companies/acme/vacancies/123/',
        }),
        makeVacancy({
          id: 'f3',
          title: 'Product Manager',
          url: 'https://www.linkedin.com/jobs/view/999',
        }),
      ],
      ['https://nebius.com/careers'],
      'Nebius',
    );
    expect(verdict.kept).toHaveLength(0);
    expect(verdict.rejected.foreign_board).toBe(1);
    expect(verdict.rejected.foreign_link).toBe(2);
  });

  it('T2.3 throws corporate_source_quality_failed when <50% of extracted items pass quality gate', async () => {
    const trap = CORPORATE_SAMPLES.navNoiseTrap;
    createMockFetchRouter([
      { match: trap.url, respond: { status: 200, body: trap.html } },
      { match: 'comeet', respond: { status: 200, body: wave1Payloads.comeet.payload } },
      { match: 'workstream', respond: { status: 200, body: wave3Payloads.workstream.payload } },
    ]).install();

    await expect(
      fetchGenericCorporateVacancies(
        makeSource({
          id: 'src-company-site-noisy',
          name: trap.company,
          type: 'career_site',
          targetUrl: trap.url,
        }),
      ),
    ).rejects.toThrow(/corporate_source_quality_failed/);
  });

  it('T2.4 propagates HTTP 404/500/timeout error instead of returning []', async () => {
    createMockFetchRouter([{ match: 'fail-site.example', respond: { status: 404, body: 'Not Found' } }]).install();
    await expect(
      fetchGenericCorporateVacancies(
        makeSource({
          id: 'src-company-site-fail',
          name: 'FailSite',
          type: 'career_site',
          targetUrl: 'https://fail-site.example/careers',
        }),
      ),
    ).rejects.toThrow(/404|unreachable/);
  });

  it('T2.5 SSRF guard rejects private IP / localhost / file:// URLs', async () => {
    createMockFetchRouter([{ match: () => true, respond: { status: 200, body: '<html></html>' } }]).install();
    await expect(
      fetchGenericCorporateVacancies(
        makeSource({
          id: 'src-company-site-ssrf',
          name: 'SSRF',
          type: 'career_site',
          targetUrl: 'http://127.0.0.1:8080/careers',
        }),
      ),
    ).rejects.toThrow();
  });

  it('T2.6 renderScriptPage failure falls back cleanly without crashing', async () => {
    const spa = CORPORATE_SAMPLES.spaShell;
    createMockFetchRouter([{ match: spa.url, respond: { status: 200, body: spa.shellHtml } }]).install();
    const res = await fetchGenericCorporateVacancies(
      makeSource({
        id: 'src-company-site-spafail',
        name: spa.company,
        type: 'career_site',
        targetUrl: spa.url,
      }),
      undefined,
      async () => undefined,
    );
    expect(res).toEqual([]);
  });
});
