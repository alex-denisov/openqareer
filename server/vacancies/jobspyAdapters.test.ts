import { describe, expect, it } from 'vitest';
import {
  NAUKRI_SEARCH_URL,
  naukriHeaders,
  naukriQueryParams,
  BDJOBS_SEARCH_URL,
  bdjobsHeaders,
  bdjobsPayload,
  ZIPRECRUITER_JOBS_URL,
  ZIPRECRUITER_AUTH_TOKEN,
  ziprecruiterHeaders,
  ziprecruiterQueryParams,
  GLASSDOOR_GRAPHQL_URL,
  glassdoorHeaders,
  glassdoorPayload,
  extractGlassdoorCsrfToken,
  BAYT_SEARCH_URL,
  baytHeaders,
  baytQueryParams,
} from './jobspyEndpoints';
import {
  normalizeNaukriJobs,
  normalizeBdjobsJobs,
  normalizeZipRecruiterJobs,
  normalizeGlassdoorJobs,
  normalizeBaytHtml,
  isCloudflareChallenge,
  fetchWithStealthFallback,
  glassdoorAdapter,
  baytAdapter,
  NAUKRI_SOURCE_ID,
  BDJOBS_SOURCE_ID,
  ZIPRECRUITER_SOURCE_ID,
  GLASSDOOR_SOURCE_ID,
  BAYT_SOURCE_ID,
} from './jobspyAdapters';
import { hasJsonAdapter, normalizeJsonSource } from './jsonSourceAdapters';
import { pagingPlanFor } from './pagedJsonSources';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';

const OBSERVED_AT = '2026-09-14T12:00:00.000Z';
const CONTEXT = { observedAt: OBSERVED_AT };

describe('JobSpy endpoints & request builders (B218)', () => {
  describe('Naukri', () => {
    it('provides correct endpoint URL', () => {
      expect(NAUKRI_SEARCH_URL).toBe('https://www.naukri.com/jobapi/v3/search');
    });

    it('generates required Naukri headers including appid, systemid, Nkparam, and HTML accept', () => {
      const headers = naukriHeaders();
      expect(headers.appid).toBe('109');
      expect(headers.systemid).toBe('Naukri');
      expect(headers.clientid).toBe('109');
      expect(headers.Nkparam).toBeTruthy();
      expect(headers.accept).toContain('text/html');
      expect(headers['User-Agent']).toContain('Mozilla');
    });

    it('builds query parameters with keyword, pageNo, and sort date', () => {
      const params = naukriQueryParams('frontend developer', 2);
      expect(params.keyword).toBe('frontend developer');
      expect(params.pageNo).toBe('2');
      expect(params.sort).toBe('date');
    });
  });

  describe('BDJobs', () => {
    it('provides correct endpoint URL', () => {
      expect(BDJOBS_SEARCH_URL).toBe('https://gateway.bdjobs.com/v1/api/jobsearch');
    });

    it('generates headers for BDJobs request', () => {
      const headers = bdjobsHeaders();
      expect(headers['User-Agent']).toContain('Mozilla');
      expect(headers.Accept).toBeDefined();
    });

    it('builds search payload with hidJobSearch, txtKeyword, and pg', () => {
      const payload = bdjobsPayload('software engineer', 3);
      expect(payload).toEqual({
        hidJobSearch: 'jobsearch',
        txtKeyword: 'software engineer',
        pg: '3',
      });
    });
  });

  describe('ZipRecruiter', () => {
    it('provides correct mobile iOS endpoint URL', () => {
      expect(ZIPRECRUITER_JOBS_URL).toBe('https://api.ziprecruiter.com/jobs-app/jobs');
    });

    it('generates mobile authorization and headers', () => {
      const headers = ziprecruiterHeaders();
      expect(headers.authorization).toBe(ZIPRECRUITER_AUTH_TOKEN);
      expect(headers.authorization).toContain('Basic ');
      expect(headers['x-zr-zapi-version']).toBe('8');
      expect(headers['User-Agent']).toContain('Job Search');
      expect(headers.accept).toContain('application/json');
    });

    it('builds query parameters with search, location, page, and per_page', () => {
      const params = ziprecruiterQueryParams('qa engineer', 'Austin, TX', 2, 50);
      expect(params).toEqual({
        search: 'qa engineer',
        location: 'Austin, TX',
        page: '2',
        per_page: '50',
      });
    });
  });
});

describe('JobSpy adapters (pure parsers)', () => {
  describe('Naukri parser', () => {
    it('normalizes Naukri job details payload to UnifiedVacancy[]', () => {
      const payload = {
        jobDetails: [
          {
            jobId: '140926001',
            title: 'Senior Fullstack Engineer',
            companyName: 'Infosys Limited',
            jdURL: '/job-listings-senior-fullstack-engineer-infosys-140926001',
            jobDescription: '<p>Looking for 5+ years experience in React and Node.js</p>',
            tagsAndSkills: 'React, Node.js, TypeScript, PostgreSQL',
            placeholders: [
              { type: 'location', label: 'Bangalore, Karnataka' },
              { type: 'experience', label: '5-8 Yrs' },
              { type: 'salary', label: '15-25 Lacs P.A.' },
            ],
            createdDate: 1789000000000,
          },
        ],
      };

      const vacancies = normalizeNaukriJobs(payload, CONTEXT, NAUKRI_SOURCE_ID);
      expect(vacancies).toHaveLength(1);
      const v = vacancies[0]!;
      expect(v.id).toBe('src-naukri:140926001');
      expect(v.title).toBe('Senior Fullstack Engineer');
      expect(v.company).toBe('Infosys Limited');
      expect(v.location).toBe('Bangalore, Karnataka');
      expect(v.url).toBe('https://www.naukri.com/job-listings-senior-fullstack-engineer-infosys-140926001');
      expect(v.requiredSkills).toEqual(['React', 'Node.js', 'TypeScript', 'PostgreSQL']);
      expect(v.salary).toEqual({
        from: 1500000,
        to: 2500000,
        currency: 'INR',
      });
      expect(v.publishedAt).toBe(new Date(1789000000000).toISOString());
      expect(v.isRemote).toBe(false);
      expect(v.description).toContain('Looking for 5+ years');
    });

    it('detects remote and parses Crore salaries in Naukri', () => {
      const payload = {
        jobDetails: [
          {
            jobId: '140926002',
            title: 'Staff Architect - Remote',
            companyName: 'Tata Consultancy Services',
            jdURL: '/job-listings-staff-architect-140926002',
            jobDescription: 'Architecting distributed systems remotely.',
            tagsAndSkills: 'Architecture, Cloud',
            placeholders: [
              { type: 'location', label: 'Remote, India' },
              { type: 'salary', label: '1-1.5 Cr P.A.' },
            ],
            createdDate: 1789050000000,
          },
        ],
      };

      const [v] = normalizeNaukriJobs(payload, CONTEXT, NAUKRI_SOURCE_ID);
      expect(v?.isRemote).toBe(true);
      expect(v?.salary).toEqual({
        from: 10000000,
        to: 15000000,
        currency: 'INR',
      });
    });

    it('throws vacancy_source_payload_unreadable when payload structure is unexpected', () => {
      expect(() => normalizeNaukriJobs({ unexpected: true }, CONTEXT, NAUKRI_SOURCE_ID)).toThrow(
        /vacancy_source_payload_unreadable/,
      );
    });

    it('filters out records missing essential fields', () => {
      const payload = {
        jobDetails: [
          { jobId: '', title: '', companyName: '', jdURL: '' },
          { jobId: '123', title: 'Valid Job', companyName: 'Valid Co', jdURL: '/job/123' },
        ],
      };
      const vacancies = normalizeNaukriJobs(payload, CONTEXT, NAUKRI_SOURCE_ID);
      expect(vacancies).toHaveLength(1);
      expect(vacancies[0]?.title).toBe('Valid Job');
    });
  });

  describe('BDJobs parser', () => {
    it('normalizes BDJobs payload with object/array data structure', () => {
      const payload = {
        data: [
          {
            JobId: '1098765',
            JobTitle: 'Senior Software Engineer',
            CompnayName: 'Brain Station 23',
            JobLocation: 'Dhaka',
            JobDescription: '<p>Develop enterprise scalable applications.</p>',
            SkillsRequired: 'Go, Docker, Kubernetes',
            JobSalaryMinSalary: 80000,
            JobSalaryMaxSalary: 120000,
            JobNature: 'Full Time',
            JobWorkPlace: 'Work at office',
            PostedOn: '2026-09-10',
          },
        ],
      };

      const vacancies = normalizeBdjobsJobs(payload, CONTEXT, BDJOBS_SOURCE_ID);
      expect(vacancies).toHaveLength(1);
      const v = vacancies[0]!;
      expect(v.id).toBe('src-bdjobs:1098765');
      expect(v.title).toBe('Senior Software Engineer');
      expect(v.company).toBe('Brain Station 23');
      expect(v.location).toBe('Dhaka');
      expect(v.url).toBe('https://jobs.bdjobs.com/jobdetails.asp?id=1098765');
      expect(v.requiredSkills).toEqual(['Go', 'Docker', 'Kubernetes']);
      expect(v.salary).toEqual({
        from: 80000,
        to: 120000,
        currency: 'BDT',
      });
      expect(v.employmentType).toBe('Full Time');
      expect(v.isRemote).toBe(false);
    });

    it('detects remote work from JobWorkPlace or title and parses lowercased fields', () => {
      const payload = {
        data: [
          {
            job_id: '1098766',
            job_title: 'Remote Lead Python Developer',
            company_name: 'BJIT Limited',
            location: 'Remote, Bangladesh',
            job_description: 'Remote development role',
            skills_required: 'Python, FastAPI',
            job_workplace: 'Work from home',
            salary_min: 100000,
            salary_max: 150000,
            posted_on: '2026-09-12',
          },
        ],
      };

      const [v] = normalizeBdjobsJobs(payload, CONTEXT, BDJOBS_SOURCE_ID);
      expect(v?.isRemote).toBe(true);
      expect(v?.salary).toEqual({
        from: 100000,
        to: 150000,
        currency: 'BDT',
      });
      expect(v?.company).toBe('BJIT Limited');
    });

    it('throws vacancy_source_payload_unreadable when payload structure is unexpected', () => {
      expect(() => normalizeBdjobsJobs({ unexpected: true }, CONTEXT, BDJOBS_SOURCE_ID)).toThrow(
        /vacancy_source_payload_unreadable/,
      );
    });
  });

  describe('ZipRecruiter parser', () => {
    it('normalizes ZipRecruiter mobile jobs payload to UnifiedVacancy[]', () => {
      const payload = {
        jobs: [
          {
            listing_key: 'zr_987654321',
            name: 'Senior Site Reliability Engineer',
            hiring_company: { name: 'Datadog' },
            job_city: 'New York',
            job_state: 'NY',
            job_country: 'US',
            job_description: '<div>Manage multi-cloud infrastructure and reliability.</div>',
            employment_type: 'full_time',
            posted_time: '2026-09-13T15:30:00Z',
            compensation_min: 170000,
            compensation_max: 220000,
            compensation_currency: 'USD',
            url: 'https://www.ziprecruiter.com/jobs//j?lvk=zr_987654321',
          },
        ],
      };

      const vacancies = normalizeZipRecruiterJobs(payload, CONTEXT, ZIPRECRUITER_SOURCE_ID);
      expect(vacancies).toHaveLength(1);
      const v = vacancies[0]!;
      expect(v.id).toBe('src-ziprecruiter:zr_987654321');
      expect(v.title).toBe('Senior Site Reliability Engineer');
      expect(v.company).toBe('Datadog');
      expect(v.location).toBe('New York, NY, US');
      expect(v.url).toBe('https://www.ziprecruiter.com/jobs//j?lvk=zr_987654321');
      expect(v.salary).toEqual({
        from: 170000,
        to: 220000,
        currency: 'USD',
      });
      expect(v.employmentType).toBe('full_time');
      expect(v.publishedAt).toBe('2026-09-13T15:30:00.000Z');
      expect(v.isRemote).toBe(false);
    });

    it('detects remote from location or description and builds fallback url', () => {
      const payload = {
        jobs: [
          {
            listing_key: 'zr_111',
            name: 'Remote React Developer',
            hiring_company: { name: 'Remote First Inc' },
            job_city: 'Remote',
            job_state: 'CA',
            job_country: 'US',
            job_description: 'Work anywhere in the US',
            posted_time: '2026-09-14T08:00:00Z',
          },
        ],
      };

      const [v] = normalizeZipRecruiterJobs(payload, CONTEXT, ZIPRECRUITER_SOURCE_ID);
      expect(v?.isRemote).toBe(true);
      expect(v?.url).toBe('https://www.ziprecruiter.com/jobs//j?lvk=zr_111');
    });

    it('throws vacancy_source_payload_unreadable when payload structure is unexpected', () => {
      expect(() => normalizeZipRecruiterJobs({ unexpected: true }, CONTEXT, ZIPRECRUITER_SOURCE_ID)).toThrow(
        /vacancy_source_payload_unreadable/,
      );
    });
  });
});

describe('Registry & adapter wiring integration', () => {
  it('registers all 3 sources in DEFAULT_VACANCY_SOURCES with active/live status', () => {
    const naukri = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-naukri');
    const bdjobs = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-bdjobs');
    const ziprecruiter = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-ziprecruiter');

    expect(naukri).toBeDefined();
    expect(naukri?.type).toBe('json_api');
    expect(naukri?.accessClass).toBe('api');
    expect(naukri?.addressStatus).toBe('live');
    expect(naukri?.enabled).toBe(true);

    expect(bdjobs).toBeDefined();
    expect(bdjobs?.type).toBe('json_api');
    expect(bdjobs?.accessClass).toBe('api');
    expect(bdjobs?.addressStatus).toBe('live');
    expect(bdjobs?.enabled).toBe(true);

    expect(ziprecruiter).toBeDefined();
    expect(ziprecruiter?.type).toBe('json_api');
    expect(ziprecruiter?.accessClass).toBe('api');
    expect(ziprecruiter?.addressStatus).toBe('live');
    expect(ziprecruiter?.enabled).toBe(true);
  });

  it('wires adapters into hasJsonAdapter and normalizeJsonSource', () => {
    expect(hasJsonAdapter('src-naukri')).toBe(true);
    expect(hasJsonAdapter('src-bdjobs')).toBe(true);
    expect(hasJsonAdapter('src-ziprecruiter')).toBe(true);

    const naukriVacancies = normalizeJsonSource(
      'src-naukri',
      {
        jobDetails: [
          {
            jobId: 'nk-1',
            title: 'Engineer',
            companyName: 'Co',
            jdURL: '/job/1',
          },
        ],
      },
      CONTEXT,
    );
    expect(naukriVacancies).toHaveLength(1);

    const bdjobsVacancies = normalizeJsonSource(
      'src-bdjobs',
      {
        data: [
          {
            JobId: 'bd-1',
            JobTitle: 'Engineer',
            CompnayName: 'Co',
          },
        ],
      },
      CONTEXT,
    );
    expect(bdjobsVacancies).toHaveLength(1);

    const zipVacancies = normalizeJsonSource(
      'src-ziprecruiter',
      {
        jobs: [
          {
            listing_key: 'zr-1',
            name: 'Engineer',
            hiring_company: { name: 'Co' },
          },
        ],
      },
      CONTEXT,
    );
    expect(zipVacancies).toHaveLength(1);
  });

  it('provides paging plans for Naukri, BDJobs, and ZipRecruiter', () => {
    const naukriPlan = pagingPlanFor('src-naukri');
    const bdjobsPlan = pagingPlanFor('src-bdjobs');
    const zipPlan = pagingPlanFor('src-ziprecruiter');

    expect(naukriPlan).toBeDefined();
    expect(bdjobsPlan).toBeDefined();
    expect(zipPlan).toBeDefined();

    const naukriFirst = naukriPlan!.first('https://www.naukri.com/jobapi/v3/search', 0);
    expect(naukriFirst.url).toContain('naukri.com');
    expect(naukriFirst.headers?.appid).toBe('109');

    const naukriNext = naukriPlan!.next(naukriFirst, { jobDetails: [{ jobId: '1' }] });
    expect(naukriNext).not.toBeNull();
    expect(naukriPlan!.next(naukriFirst, { jobDetails: [] })).toBeNull();

    const bdjobsFirst = bdjobsPlan!.first('https://gateway.bdjobs.com/v1/api/jobsearch', 0);
    expect(bdjobsFirst.url).toContain('bdjobs.com');

    const bdjobsNext = bdjobsPlan!.next(bdjobsFirst, { data: [{ JobId: '1' }] });
    expect(bdjobsNext).not.toBeNull();
    expect(bdjobsPlan!.next(bdjobsFirst, { data: [] })).toBeNull();

    const zipFirst = zipPlan!.first('https://api.ziprecruiter.com/jobs-app/jobs', 0);
    expect(zipFirst.url).toContain('ziprecruiter.com');
    expect(zipFirst.headers?.authorization).toContain('Basic ');

    const zipNext = zipPlan!.next(zipFirst, { jobs: [{ listing_key: '1' }] });
    expect(zipNext).not.toBeNull();
    expect(zipPlan!.next(zipFirst, { jobs: [] })).toBeNull();
  });
});

describe('Glassdoor & Bayt endpoints & request builders', () => {
  describe('Glassdoor', () => {
    it('provides correct GraphQL endpoint URL', () => {
      expect(GLASSDOOR_GRAPHQL_URL).toBe('https://www.glassdoor.com/graph');
    });

    it('generates headers with browser stealth signatures and optional CSRF token', () => {
      const headers = glassdoorHeaders('test-csrf-token-123');
      expect(headers['User-Agent']).toContain('Mozilla');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['gd-csrf-token']).toBe('test-csrf-token-123');
      expect(headers['sec-ch-ua']).toBeDefined();
    });

    it('builds GraphQL payload with JobSearchResultsQuery, variables, and query', () => {
      const payload = glassdoorPayload('react developer', 'New York', 2, 30);
      expect(payload.operationName).toBe('JobSearchResultsQuery');
      expect(payload.variables).toMatchObject({
        keyword: 'react developer',
        pageNumber: 2,
        numJobsToShow: 30,
      });
      expect(typeof payload.query).toBe('string');
      expect(payload.query).toContain('jobListings');
    });

    it('extracts CSRF token from HTML meta tags or response headers', () => {
      const html = '<html><head><meta name="csrf-token" content="csrf_xyz_789" /></head></html>';
      expect(extractGlassdoorCsrfToken(html)).toBe('csrf_xyz_789');

      const headers = { 'gd-csrf-token': 'csrf_header_456' };
      expect(extractGlassdoorCsrfToken(headers)).toBe('csrf_header_456');

      const cookieHeaders = { 'set-cookie': 'gdId=abc; gd-csrf-token=csrf_cookie_123; path=/' };
      expect(extractGlassdoorCsrfToken(cookieHeaders)).toBe('csrf_cookie_123');
    });
  });

  describe('Bayt', () => {
    it('provides correct search URL', () => {
      expect(BAYT_SEARCH_URL).toBe('https://www.bayt.com/en/international/jobs/');
    });

    it('generates headers with browser stealth signature', () => {
      const headers = baytHeaders();
      expect(headers['User-Agent']).toContain('Mozilla');
      expect(headers.Accept).toContain('text/html');
      expect(headers['Sec-Fetch-Dest']).toBe('document');
    });

    it('builds query parameters with keyword and page', () => {
      const params = baytQueryParams('frontend engineer', 3);
      expect(params).toEqual({
        q: 'frontend engineer',
        page: '3',
      });
    });
  });
});

describe('Glassdoor parser (JobSearchResultsQuery GraphQL)', () => {
  it('normalizes Glassdoor GraphQL payload into UnifiedVacancy[]', () => {
    const payload = {
      data: {
        jobListings: [
          {
            jobview: {
              header: {
                jobTitleText: 'Staff Frontend Engineer',
                employerNameFromSearch: 'Stripe, Inc.',
                locationName: 'San Francisco, CA',
                salary: {
                  min: 180000,
                  max: 240000,
                  currency: 'USD',
                },
              },
              job: {
                listingId: 1009876543,
                description: '<p>Build next generation payment infrastructure using React.</p>',
                datePosted: '2026-09-13T10:00:00Z',
              },
              overview: {
                name: 'Stripe, Inc.',
              },
            },
          },
        ],
      },
    };

    const vacancies = normalizeGlassdoorJobs(payload, CONTEXT, GLASSDOOR_SOURCE_ID);
    expect(vacancies).toHaveLength(1);
    const v = vacancies[0]!;
    expect(v.id).toBe('src-glassdoor:1009876543');
    expect(v.title).toBe('Staff Frontend Engineer');
    expect(v.company).toBe('Stripe, Inc.');
    expect(v.location).toBe('San Francisco, CA');
    expect(v.url).toBe('https://www.glassdoor.com/job-listing/job-details.htm?jl=1009876543');
    expect(v.salary).toEqual({
      from: 180000,
      to: 240000,
      currency: 'USD',
    });
    expect(v.publishedAt).toBe('2026-09-13T10:00:00.000Z');
    expect(v.isRemote).toBe(false);
    expect(v.description).toContain('Build next generation');
  });

  it('detects remote work from title or location and parses alternative schema paths', () => {
    const payload = {
      data: {
        jobSearchResults: {
          jobListings: [
            {
              jobView: {
                header: {
                  jobTitleText: 'Remote Senior Fullstack Developer',
                  employerNameFromSearch: 'RemoteWorks',
                  locationName: 'Remote, US',
                  salary: {
                    min: 150000,
                    max: 190000,
                    currency: 'USD',
                  },
                },
                job: {
                  listingId: 'gd_777888',
                  description: 'Fully remote position',
                  datePosted: '2026-09-14T04:00:00Z',
                },
              },
            },
          ],
        },
      },
    };

    const [v] = normalizeGlassdoorJobs(payload, CONTEXT, GLASSDOOR_SOURCE_ID);
    expect(v?.id).toBe('src-glassdoor:gd_777888');
    expect(v?.isRemote).toBe(true);
    expect(v?.company).toBe('RemoteWorks');
  });

  it('throws vacancy_source_payload_unreadable when payload structure is unexpected', () => {
    expect(() => normalizeGlassdoorJobs({ invalid: true }, CONTEXT, GLASSDOOR_SOURCE_ID)).toThrow(
      /vacancy_source_payload_unreadable/,
    );
  });
});

describe('Bayt parser (HTML scraper)', () => {
  const sampleBaytHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="job-results">
          <ul>
            <li class="has-pointer-d" data-js-job="1029384" data-job-id="1029384">
              <h2 class="jb-title">
                <a href="/en/international/jobs/lead-devops-engineer-1029384/">Lead DevOps Engineer - Remote</a>
              </h2>
              <b class="jb-company">Emirates Tech Solutions</b>
              <span class="jb-loc">Dubai, United Arab Emirates</span>
              <span class="jb-date">2 days ago</span>
              <p class="jb-desc">Lead cloud infrastructure migration on AWS and Kubernetes.</p>
              <span class="jb-salary">AED 25,000 - 35,000</span>
            </li>
          </ul>
        </div>
      </body>
    </html>
  `;

  it('normalizes Bayt HTML listing cards (li[data-js-job]) into UnifiedVacancy[]', () => {
    const vacancies = normalizeBaytHtml(sampleBaytHtml, CONTEXT, BAYT_SOURCE_ID);
    expect(vacancies).toHaveLength(1);
    const v = vacancies[0]!;
    expect(v.id).toBe('src-bayt:1029384');
    expect(v.title).toBe('Lead DevOps Engineer - Remote');
    expect(v.company).toBe('Emirates Tech Solutions');
    expect(v.location).toBe('Dubai, United Arab Emirates');
    expect(v.url).toBe('https://www.bayt.com/en/international/jobs/lead-devops-engineer-1029384/');
    expect(v.isRemote).toBe(true);
    expect(v.description).toContain('Lead cloud infrastructure migration');
    expect(v.salary).toEqual({
      from: 25000,
      to: 35000,
      currency: 'AED',
    });
  });

  it('throws vacancy_source_payload_unreadable when HTML contains no job cards', () => {
    expect(() => normalizeBaytHtml('<html><body><div>No jobs here</div></body></html>', CONTEXT, BAYT_SOURCE_ID)).toThrow(
      /vacancy_source_payload_unreadable/,
    );
  });
});

describe('Obscura stealth integration & challenge fallback', () => {
  it('detects Cloudflare 403 challenges and challenge signatures', () => {
    expect(isCloudflareChallenge(403)).toBe(true);
    expect(isCloudflareChallenge(503, '<html>Just a moment... cf-chl</html>')).toBe(true);
    expect(isCloudflareChallenge(200, '<div>Normal page</div>')).toBe(false);
    expect(isCloudflareChallenge(200, '<div>challenge-platform script</div>')).toBe(true);
  });

  it('returns direct HTTP response when direct fetch succeeds (200 OK)', async () => {
    const result = await fetchWithStealthFallback('https://example.com/api', {}, {
      httpFetch: async () => ({
        status: 200,
        text: async () => JSON.stringify({ data: { jobListings: [] } }),
      }),
      stealthFetch: async () => {
        throw new Error('Stealth should not be called');
      },
    });

    expect(result.status).toBe(200);
    expect(result.usedStealth).toBe(false);
    expect(result.body).toContain('jobListings');
  });

  it('falls back to Obscura stealth runner when direct HTTP receives 403 challenge', async () => {
    const result = await fetchWithStealthFallback('https://www.glassdoor.com/graph', {}, {
      httpFetch: async () => ({
        status: 403,
        text: async () => '<html><title>Just a moment...</title>Cloudflare challenge</html>',
      }),
      stealthFetch: async () => ({
        status: 200,
        content: JSON.stringify({ data: { jobListings: [{ jobview: {} }] } }),
      }),
    });

    expect(result.status).toBe(200);
    expect(result.usedStealth).toBe(true);
    expect(result.body).toContain('jobListings');
  });

  it('exports glassdoorAdapter and baytAdapter wrapper functions', () => {
    expect(typeof glassdoorAdapter).toBe('function');
    expect(typeof baytAdapter).toBe('function');
  });
});

describe('Glassdoor & Bayt registry & wiring integration', () => {
  it('registers src-glassdoor and src-bayt in DEFAULT_VACANCY_SOURCES with active/live status', () => {
    const gd = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-glassdoor');
    const bayt = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-bayt');

    expect(gd).toBeDefined();
    expect(gd?.type).toBe('json_api');
    expect(gd?.accessClass).toBe('api');
    expect(gd?.addressStatus).toBe('live');
    expect(gd?.enabled).toBe(true);

    expect(bayt).toBeDefined();
    expect(bayt?.type).toBe('json_api');
    expect(bayt?.accessClass).toBe('api');
    expect(bayt?.addressStatus).toBe('live');
    expect(bayt?.enabled).toBe(true);
  });

  it('wires adapters into hasJsonAdapter and normalizeJsonSource', () => {
    expect(hasJsonAdapter('src-glassdoor')).toBe(true);
    expect(hasJsonAdapter('src-bayt')).toBe(true);

    const gdVacancies = normalizeJsonSource(
      'src-glassdoor',
      {
        data: {
          jobListings: [
            {
              jobview: {
                header: { jobTitleText: 'Architect', employerNameFromSearch: 'Corp', locationName: 'NY' },
                job: { listingId: 'gd-1', description: 'Desc' },
              },
            },
          ],
        },
      },
      CONTEXT,
    );
    expect(gdVacancies).toHaveLength(1);

    const baytVacancies = normalizeJsonSource(
      'src-bayt',
      `<li data-js-job="bayt-1"><h2 class="jb-title"><a href="/job/1">Engineer</a></h2><b class="jb-company">Co</b></li>`,
      CONTEXT,
    );
    expect(baytVacancies).toHaveLength(1);
  });

  it('provides paging plans for Glassdoor and Bayt', () => {
    const gdPlan = pagingPlanFor('src-glassdoor');
    const baytPlan = pagingPlanFor('src-bayt');

    expect(gdPlan).toBeDefined();
    expect(baytPlan).toBeDefined();

    const gdFirst = gdPlan!.first('https://www.glassdoor.com/graph', 0);
    expect(gdFirst.url).toContain('glassdoor.com');
    expect(gdFirst.method).toBe('POST');

    const gdNext = gdPlan!.next(gdFirst, { data: { jobListings: [{ jobview: {} }] } });
    expect(gdNext).not.toBeNull();
    expect(gdPlan!.next(gdFirst, { data: { jobListings: [] } })).toBeNull();

    const baytFirst = baytPlan!.first('https://www.bayt.com/en/international/jobs/', 0);
    expect(baytFirst.url).toContain('bayt.com');

    const baytNext = baytPlan!.next(baytFirst, '<li data-js-job="1">...</li>');
    expect(baytNext).not.toBeNull();
    expect(baytPlan!.next(baytFirst, '')).toBeNull();
  });
});

