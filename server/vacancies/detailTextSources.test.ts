import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { detailTextSourceFor, isDetailTextSource, readJsonLdJobPosting } from './detailTextSources';
import { WorkdayDescriptionBackfill, type WorkdayDescriptionPool } from './workdayDescriptions';

function vacancy(id: string, sourceId: string, url: string): UnifiedVacancy {
  return {
    id,
    fingerprint: id,
    title: 'Engineer',
    company: 'Acme',
    description: 'Engineer — Platform',
    requiredSkills: [],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: url,
      observedAt: '2026-10-20T00:00:00Z',
    },
    publishedAt: '2026-10-19T00:00:00Z',
    status: 'active',
  };
}

const BODY = '<p>You will build <b>Python</b> and SQL services.</p><ul><li>Own the API</li></ul>';

const ldPage = (description: string) =>
  `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
   <script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Engineer', description })}</script></head></html>`;

describe('detail text sources (B535)', () => {
  it('covers Workday, SmartRecruiters, Eightfold, Habr, YC and LinkedIn, nothing else', () => {
    for (const id of [
      'ats-workday-nvidia',
      'ats-smartrecruiters-BoschGroup',
      'src-netflix',
      'src-microsoft-careers',
      'src-qualcomm-careers',
      'src-habr-career',
      'src-yc-work-at-startup',
      'src-linkedin-guest',
    ]) {
      expect(isDetailTextSource(id), id).toBe(true);
    }
    for (const id of ['src-himalayas', 'src-hh-search', 'ats-greenhouse-x']) {
      expect(isDetailTextSource(id), id).toBe(false);
    }
  });

  it('SmartRecruiters: posting API address and the jobAd sections in order', () => {
    const source = detailTextSourceFor('ats-smartrecruiters-BoschGroup')!;
    const v = vacancy(
      'a',
      'ats-smartrecruiters-BoschGroup',
      'https://jobs.smartrecruiters.com/BoschGroup/744000156221569',
    );
    expect(source.detailUrl('ats-smartrecruiters-BoschGroup', v)).toBe(
      'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000156221569',
    );
    const text = source.readText({
      jobAd: {
        sections: {
          companyDescription: { title: 'Company', text: '<p>We are Bosch.</p>' },
          jobDescription: { title: 'Job Description', text: BODY },
          qualifications: { title: 'Qualifications', text: '<p>Five years of Go.</p>' },
          additionalInformation: { title: 'More', text: '' },
        },
      },
    });
    expect(text.indexOf('We are Bosch')).toBeLessThan(text.indexOf('Python'));
    expect(text).toContain('Five years of Go.');
    expect(text).toContain('Job Description');
  });

  it('SmartRecruiters: a foreign host or another board is refused', () => {
    const source = detailTextSourceFor('ats-smartrecruiters-BoschGroup')!;
    expect(
      source.detailUrl(
        'ats-smartrecruiters-BoschGroup',
        vacancy('a', 'x', 'https://evil.com/BoschGroup/1'),
      ),
    ).toBeUndefined();
    expect(
      source.detailUrl(
        'ats-smartrecruiters-BoschGroup',
        vacancy('a', 'x', 'https://jobs.smartrecruiters.com/Other/1'),
      ),
    ).toBeUndefined();
  });

  it('Eightfold pcsx (Microsoft, Qualcomm): position_details by the id in the public link', () => {
    const ms = detailTextSourceFor('src-microsoft-careers')!;
    expect(
      ms.detailUrl(
        'src-microsoft-careers',
        vacancy(
          'm',
          'src-microsoft-careers',
          'https://apply.careers.microsoft.com/careers/job/1970393557002608',
        ),
      ),
    ).toBe(
      'https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=1970393557002608&domain=microsoft.com&hl=en',
    );
    const qc = detailTextSourceFor('src-qualcomm-careers')!;
    expect(
      qc.detailUrl(
        'src-qualcomm-careers',
        vacancy(
          'q',
          'src-qualcomm-careers',
          'https://careers.qualcomm.com/careers/job/446721635510',
        ),
      ),
    ).toBe(
      'https://careers.qualcomm.com/api/pcsx/position_details?position_id=446721635510&domain=qualcomm.com&hl=en',
    );
    expect(
      qc.detailUrl(
        'src-qualcomm-careers',
        vacancy('q', 'x', 'https://apply.careers.microsoft.com/careers/job/1'),
      ),
    ).toBeUndefined();
    expect(ms.readText({ data: { jobDescription: BODY } })).toContain('Python and SQL');
    expect(ms.readText({ data: {} })).toBe('');
  });

  it('Eightfold Netflix: apply/v2 job by id, job_description', () => {
    const nf = detailTextSourceFor('src-netflix')!;
    expect(
      nf.detailUrl(
        'src-netflix',
        vacancy('n', 'src-netflix', 'https://explore.jobs.netflix.net/careers/job/790318714520'),
      ),
    ).toBe('https://explore.jobs.netflix.net/api/apply/v2/jobs/790318714520?domain=netflix.com');
    expect(nf.readText({ job_description: BODY })).toContain('Own the API');
  });

  it('Habr Career and YC: the public page, JobPosting description from JSON-LD', () => {
    const habr = detailTextSourceFor('src-habr-career')!;
    expect(habr.format).toBe('html');
    expect(
      habr.detailUrl(
        'src-habr-career',
        vacancy('h', 'src-habr-career', 'https://career.habr.com/vacancies/1000169200'),
      ),
    ).toBe('https://career.habr.com/vacancies/1000169200');
    expect(
      habr.detailUrl('src-habr-career', vacancy('h', 'x', 'https://career.habr.com/users/1')),
    ).toBeUndefined();
    expect(habr.readText(ldPage(BODY))).toContain('Python and SQL');

    const yc = detailTextSourceFor('src-yc-work-at-startup')!;
    const link =
      'https://www.ycombinator.com/companies/onechronos/jobs/ItNGMMO-engineering-manager';
    expect(
      yc.detailUrl('src-yc-work-at-startup', vacancy('y', 'src-yc-work-at-startup', link)),
    ).toBe(link);
    expect(
      yc.detailUrl(
        'src-yc-work-at-startup',
        vacancy('y', 'x', 'https://www.ycombinator.com/library/1'),
      ),
    ).toBeUndefined();
  });

  it('readJsonLdJobPosting ignores broken blocks and pages without a JobPosting', () => {
    expect(readJsonLdJobPosting('<script type="application/ld+json">{oops</script>')).toBe('');
    expect(readJsonLdJobPosting('<html></html>')).toBe('');
    expect(
      readJsonLdJobPosting(
        `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'JobPosting', description: '&lt;p&gt;Escaped Rust&lt;/p&gt;' }] })}</script>`,
      ),
    ).toBe('Escaped Rust');
  });
});

describe('detail backfill beyond Workday (B535)', () => {
  it('loads SmartRecruiters text as JSON and Habr text as HTML', async () => {
    const sr = 'ats-smartrecruiters-BoschGroup';
    const habr = 'src-habr-career';
    const rows = new Map<string, UnifiedVacancy[]>([
      [sr, [vacancy('sr:1', sr, 'https://jobs.smartrecruiters.com/BoschGroup/1')]],
      [habr, [vacancy('h:1', habr, 'https://career.habr.com/vacancies/1')]],
    ]);
    const merged: UnifiedVacancy[] = [];
    const pool: WorkdayDescriptionPool = {
      loadVacanciesWithoutFullText: (id, limit) => (rows.get(id) ?? []).slice(0, limit),
      mergeSourceSlice: (id, list) => {
        merged.push(...list);
        rows.set(id, []);
        return {};
      },
      markExpired: () => 0,
    };
    const asked: Array<[string, string]> = [];
    const backfill = new WorkdayDescriptionBackfill({
      pool,
      sourceIds: () => [sr, habr, 'src-linkedin-guest'],
      fetchDetail: async (url, format) => {
        asked.push([url, format]);
        return format === 'html'
          ? { status: 200, payload: ldPage(BODY) }
          : { status: 200, payload: { jobAd: { sections: { jobDescription: { text: BODY } } } } };
      },
      sleep: async () => undefined,
    });
    expect(await backfill.step()).toMatchObject({ requested: 2, loaded: 2 });
    expect(asked).toEqual(
      expect.arrayContaining([
        ['https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/1', 'json'],
        ['https://career.habr.com/vacancies/1', 'html'],
      ]),
    );
    expect(merged.every((v) => v.fullDescription?.includes('Python and SQL'))).toBe(true);
  });
});

describe('MultiSourceVacancyEngine detail step for registry sources (B535)', () => {
  it('loads text for the live registry entries of SmartRecruiters, Eightfold, Habr and YC', async () => {
    const { MultiSourceVacancyEngine } = await import('./multiSourceVacancyEngine');
    const { DEFAULT_VACANCY_SOURCES } = await import('./defaultVacancySources');
    const { ATS_BOARD_SOURCES } = await import('./atsBoardSources');
    const links: Record<string, string> = {
      'ats-smartrecruiters-BoschGroup': 'https://jobs.smartrecruiters.com/BoschGroup/7',
      'src-netflix': 'https://explore.jobs.netflix.net/careers/job/7',
      'src-microsoft-careers': 'https://apply.careers.microsoft.com/careers/job/7',
      'src-qualcomm-careers': 'https://careers.qualcomm.com/careers/job/7',
      'src-habr-career': 'https://career.habr.com/vacancies/7',
      'src-yc-work-at-startup': 'https://www.ycombinator.com/companies/a/jobs/b',
    };
    const sources = [
      ...new Map(
        [...DEFAULT_VACANCY_SOURCES, ...ATS_BOARD_SOURCES]
          .filter((s) => s.id in links)
          .map((s) => [s.id, s]),
      ).values(),
    ];
    expect(sources.map((s) => s.id).sort()).toEqual(Object.keys(links).sort());
    const requested: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources,
      workdayDetailFetch: async (url, format) => {
        requested.push(url);
        return format === 'html'
          ? { status: 200, payload: ldPage(BODY) }
          : {
              status: 200,
              payload: {
                data: { jobDescription: BODY },
                job_description: BODY,
                jobAd: { sections: { jobDescription: { text: BODY } } },
              },
            };
      },
    });
    const pool = (engine as unknown as { pool: WorkdayDescriptionPool }).pool;
    for (const [sourceId, url] of Object.entries(links)) {
      pool.mergeSourceSlice(sourceId, [vacancy(`${sourceId}:7`, sourceId, url)]);
    }
    const report = await engine.runWorkdayDescriptionStep();
    expect(report).toMatchObject({ requested: 6, loaded: 6 });
    for (const sourceId of Object.keys(links)) {
      expect(engine.getVacancy(`${sourceId}:7`)?.fullDescription, sourceId).toContain('Python');
    }
  });
});

const LINKEDIN_PAGE = `<div class="description__text description__text--rich"><section class="show-more-less-html" data-max-lines="5">
  <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5 relative overflow-hidden">
    <p>Lead the <strong>Kubernetes</strong> platform.</p><ul><li>Own SLOs</li></ul>
  </div>
  <button class="show-more-less-html__button show-more-less-button" aria-label="Show more">Show more</button>
</section></div>`;

describe('LinkedIn guest job text (B535)', () => {
  const li = detailTextSourceFor('src-linkedin-guest')!;

  it('asks the guest jobPosting page by the id of the public link, every 10–20 s at random', () => {
    expect(li.format).toBe('html');
    expect([li.intervalMs, li.intervalJitterMs]).toEqual([10_000, 10_000]);
    expect(
      li.detailUrl('src-linkedin-guest', { url: 'https://www.linkedin.com/jobs/view/4466903873' }),
    ).toBe('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4466903873');
    expect(
      li.detailUrl('src-linkedin-guest', { url: 'https://evil.com/jobs/view/1' }),
    ).toBeUndefined();
    expect(
      li.detailUrl('src-linkedin-guest', { url: 'https://www.linkedin.com/in/someone' }),
    ).toBeUndefined();
  });

  it('reads the description markup and nothing of the buttons around it', () => {
    const text = li.readText(LINKEDIN_PAGE);
    expect(text).toContain('Lead the Kubernetes platform.');
    expect(text).toContain('Own SLOs');
    expect(text).not.toContain('Show more');
    expect(li.readText('<html>login wall</html>')).toBe('');
  });
});

describe('detail backfill pacing (B535)', () => {
  function linkedinPool(count: number) {
    const rows = Array.from({ length: count }, (_, i) =>
      vacancy(`li:${i}`, 'src-linkedin-guest', `https://www.linkedin.com/jobs/view/${i + 1}`),
    );
    const pool: WorkdayDescriptionPool = {
      loadVacanciesWithoutFullText: (_id, limit, exclude) =>
        rows.filter((r) => !exclude.includes(r.id)).slice(0, limit),
      mergeSourceSlice: (_id, list) => {
        for (const v of list)
          rows.splice(
            rows.findIndex((r) => r.id === v.id),
            1,
          );
        return {};
      },
      markExpired: () => 0,
    };
    return pool;
  }

  it('sends LinkedIn one request, then waits 10 s plus a random part up to 10 s', async () => {
    let now = 0;
    const asked: string[] = [];
    const backfill = new WorkdayDescriptionBackfill({
      pool: linkedinPool(5),
      sourceIds: () => ['src-linkedin-guest'],
      fetchDetail: async (url) => {
        asked.push(url);
        return { status: 200, payload: LINKEDIN_PAGE };
      },
      sleep: async () => undefined,
      now: () => now,
      random: () => 0.5,
    });
    await backfill.step();
    expect(asked).toHaveLength(1);
    now = 10_000;
    await backfill.step();
    expect(asked).toHaveLength(1);
    now = 15_000;
    await backfill.step();
    expect(asked).toHaveLength(2);
  });

  it('stops LinkedIn for an hour after 429 without counting it as a failure', async () => {
    let now = 0;
    let status = 429;
    const asked: string[] = [];
    const backfill = new WorkdayDescriptionBackfill({
      pool: linkedinPool(2),
      sourceIds: () => ['src-linkedin-guest'],
      fetchDetail: async (url) => {
        asked.push(url);
        return status === 200 ? { status, payload: LINKEDIN_PAGE } : { status };
      },
      sleep: async () => undefined,
      now: () => now,
      maxAttempts: 1,
    });
    expect(await backfill.step()).toMatchObject({
      requested: 1,
      loaded: 0,
      failed: 0,
      throttled: 1,
    });
    now = 30 * 60_000;
    await backfill.step();
    expect(asked).toHaveLength(1);
    status = 200;
    now = 60 * 60_000;
    expect(await backfill.step()).toMatchObject({ loaded: 1 });
    expect(asked[1]).toBe(asked[0]);
  });
});
