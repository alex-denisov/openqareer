import { describe, expect, it } from 'vitest';
import { fromWorkdayPostedOn, normalizeJsonSource, workdayPublicUrl } from './jsonSourceAdapters';
import { UNKNOWN_PUBLISHED_AT } from './jsonVacancyRecord';

/**
 * B164 — each board publishes its own record shape. The payloads below keep the
 * field names the live endpoints actually returned on 2026-08-30, trimmed to
 * what the adapter reads.
 */
const OBSERVED_AT = '2026-08-30T12:00:00.000Z';

describe('json source adapters', () => {
  it('normalises an arbeitnow record', () => {
    const [vacancy] = normalizeJsonSource(
      'src-arbeitnow',
      {
        data: [
          {
            slug: 'senior-engineer-berlin-1',
            company_name: 'Beispiel GmbH',
            title: 'Senior Engineer',
            description: '<p>Wir suchen</p>',
            remote: true,
            url: 'https://www.arbeitnow.com/jobs/companies/beispiel/senior-engineer-berlin-1',
            tags: ['typescript'],
            location: 'Berlin',
            created_at: 1787000000,
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );

    expect(vacancy).toMatchObject({
      title: 'Senior Engineer',
      company: 'Beispiel GmbH',
      location: 'Berlin',
      isRemote: true,
      url: 'https://www.arbeitnow.com/jobs/companies/beispiel/senior-engineer-berlin-1',
      status: 'active',
    });
    expect(vacancy?.provenance).toMatchObject({
      sourceId: 'src-arbeitnow',
      sourceType: 'json_api',
      observedAt: OBSERVED_AT,
    });
    expect(vacancy?.publishedAt).toBe(new Date(1787000000 * 1000).toISOString());
  });

  it('skips the licence record RemoteOK puts first in its array', () => {
    const vacancies = normalizeJsonSource(
      'src-remoteok',
      [
        { legal: 'API Terms of Service: please link back', last_updated: 1788060773 },
        {
          id: '1091234',
          slug: 'remoteok-backend',
          position: 'Backend Engineer',
          company: 'Remote Co',
          location: 'Worldwide',
          url: 'https://remoteok.com/remote-jobs/1091234',
          tags: ['golang'],
          date: '2026-08-28T10:00:00+00:00',
        },
      ],
      { observedAt: OBSERVED_AT },
    );

    expect(vacancies).toHaveLength(1);
    expect(vacancies[0]).toMatchObject({
      title: 'Backend Engineer',
      company: 'Remote Co',
      isRemote: true,
    });
  });

  it('normalises a jobicy record', () => {
    const [vacancy] = normalizeJsonSource(
      'src-jobicy',
      {
        jobs: [
          {
            id: 152061,
            url: 'https://jobicy.com/jobs/152061-director',
            jobTitle: 'Director of Product Management',
            companyName: 'PerfectServe',
            jobGeo: 'USA',
            jobLevel: 'Director',
            jobType: ['Full-Time'],
            jobExcerpt: 'What is PerfectServe?',
            pubDate: '2026-08-27 09:00:00',
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );

    expect(vacancy).toMatchObject({
      title: 'Director of Product Management',
      company: 'PerfectServe',
      location: 'USA',
      experienceLevel: 'Director',
      employmentType: 'Full-Time',
    });
  });

  it('normalises a working nomads record', () => {
    const [vacancy] = normalizeJsonSource(
      'src-workingnomads',
      [
        {
          url: 'https://www.workingnomads.com/job/go/1822420/',
          title: 'Contract Attorney - Remote',
          company_name: 'Sneed & Mitchell LLP',
          description: '<p>At Sneed</p>',
          category_name: 'Legal',
          location: 'USA',
          pub_date: '2026-08-29T08:00:00Z',
        },
      ],
      { observedAt: OBSERVED_AT },
    );

    expect(vacancy).toMatchObject({
      title: 'Contract Attorney - Remote',
      company: 'Sneed & Mitchell LLP',
      isRemote: true,
    });
  });

  it('normalises a get on board record from its attributes envelope', () => {
    const [vacancy] = normalizeJsonSource(
      'src-getonbrd',
      {
        data: [
          {
            id: 'senior-ios-developer-bci-santiago',
            type: 'job',
            attributes: {
              title: 'Senior iOS Developer',
              description: '<p>Swift 6</p>',
              remote: false,
              company_name: 'BCI',
              country: 'Chile',
              published_at: 1787500000,
              public_url: 'https://www.getonbrd.com/jobs/senior-ios-developer-bci-santiago',
            },
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );

    expect(vacancy).toMatchObject({
      title: 'Senior iOS Developer',
      company: 'BCI',
      location: 'Chile',
      isRemote: false,
      url: 'https://www.getonbrd.com/jobs/senior-ios-developer-bci-santiago',
    });
  });

  it('normalises a trudvsem record from its nested vacancy envelope', () => {
    const [vacancy] = normalizeJsonSource(
      'src-trudvsem',
      {
        status: '200',
        results: {
          vacancies: [
            {
              vacancy: {
                id: 'd3d38900-97d5-11f1-a7e8-cbebfa677ab1',
                region: { region_code: '2600000000000', name: 'Ставропольский край' },
                company: { name: 'БМГ' },
                'creation-date': '2026-08-14',
                salary_min: 100000,
                salary_max: 120000,
                'job-name': 'Врач-офтальмолог',
                vac_url: 'https://trudvsem.ru/vacancy/card/1027700404797/d3d38900',
                requirement: { education: 'Высшее', experience: 3 },
                duty: 'Приём пациентов',
              },
            },
          ],
        },
      },
      { observedAt: OBSERVED_AT },
    );

    expect(vacancy).toMatchObject({
      title: 'Врач-офтальмолог',
      company: 'БМГ',
      location: 'Ставропольский край',
      url: 'https://trudvsem.ru/vacancy/card/1027700404797/d3d38900',
    });
    expect(vacancy?.salary).toMatchObject({ from: 100000, to: 120000, currency: 'RUR' });
  });

  it('refuses a payload it cannot read instead of reporting an empty success', () => {
    expect(() =>
      normalizeJsonSource('src-arbeitnow', { unexpected: true }, { observedAt: OBSERVED_AT }),
    ).toThrow(/vacancy_source_payload_unreadable/);
  });

  it('refuses a source it has no adapter for', () => {
    expect(() => normalizeJsonSource('src-unknown', [], { observedAt: OBSERVED_AT })).toThrow(
      /vacancy_source_adapter_missing/,
    );
  });

  it('drops a record with no title, company or link rather than inventing one', () => {
    const vacancies = normalizeJsonSource(
      'src-remoteok',
      [{ id: '1', position: '', company: '', url: '' }],
      { observedAt: OBSERVED_AT },
    );

    expect(vacancies).toEqual([]);
  });

  it('reads the alternative field names each board also uses', () => {
    const [remoteok] = normalizeJsonSource(
      'src-remoteok',
      [
        {
          slug: 'alt',
          title: 'Platform Engineer',
          company: 'Alt Co',
          url: 'https://remoteok.com/1',
        },
      ],
      { observedAt: OBSERVED_AT },
    );
    expect(remoteok).toMatchObject({ title: 'Platform Engineer', id: 'src-remoteok:alt' });

    const [getonbrd] = normalizeJsonSource(
      'src-getonbrd',
      {
        data: [
          {
            id: 'job-1',
            attributes: {
              title: 'QA Engineer',
              company: { name: 'Nested Co' },
              city: 'Bogotá',
              url: 'https://www.getonbrd.com/jobs/job-1',
            },
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );
    expect(getonbrd).toMatchObject({ company: 'Nested Co', location: 'Bogotá' });

    const [jobicy] = normalizeJsonSource(
      'src-jobicy',
      {
        jobs: [
          {
            id: 7,
            url: 'https://jobicy.com/jobs/7',
            jobTitle: 'Writer',
            companyName: 'Words Inc',
            jobDescription: 'Long form',
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );
    expect(jobicy?.description).toBe('Long form');
    expect(jobicy?.employmentType).toBeUndefined();
  });

  it('keeps an unreadable date out of the fresh window instead of calling it today', () => {
    const [remoteok] = normalizeJsonSource(
      'src-remoteok',
      [
        {
          id: '9',
          position: 'Engineer',
          company: 'Co',
          url: 'https://remoteok.com/9',
          date: 'вчера',
        },
      ],
      { observedAt: OBSERVED_AT },
    );
    const [arbeitnow] = normalizeJsonSource(
      'src-arbeitnow',
      {
        data: [
          {
            slug: 'x',
            title: 'Engineer',
            company_name: 'Co',
            url: 'https://www.arbeitnow.com/x',
            created_at: 'not-a-number',
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );
    const [trudvsem] = normalizeJsonSource(
      'src-trudvsem',
      {
        results: {
          vacancies: [
            {
              vacancy: {
                id: '1',
                'job-name': 'Инженер',
                company: { name: 'Компания' },
                vac_url: 'https://trudvsem.ru/1',
              },
            },
          ],
        },
      },
      { observedAt: OBSERVED_AT },
    );

    expect(remoteok?.publishedAt).toBe(new Date(0).toISOString());
    expect(arbeitnow?.publishedAt).toBe(new Date(0).toISOString());
    expect(trudvsem?.publishedAt).toBe(new Date(0).toISOString());
    expect(trudvsem?.salary).toBeUndefined();
  });

  it('refuses every adapter payload it cannot read', () => {
    for (const sourceId of [
      'src-remoteok',
      'src-jobicy',
      'src-workingnomads',
      'src-getonbrd',
      'src-trudvsem',
    ]) {
      expect(() =>
        normalizeJsonSource(sourceId, { nothing: 'here' }, { observedAt: OBSERVED_AT }),
      ).toThrow(/vacancy_source_payload_unreadable/);
    }
  });
});

describe('what the candidate reads from a JSON board (B164)', () => {
  it('reads a description a board publishes as escaped HTML', () => {
    const [vacancy] = normalizeJsonSource(
      'src-arbeitnow',
      {
        data: [
          {
            slug: 'role-1',
            company_name: 'Beispiel GmbH',
            title: 'Senior Engineer',
            description:
              '&lt;p&gt;&lt;strong&gt;THE ROLE&amp;nbsp;&lt;/strong&gt;Build things.&lt;/p&gt;',
            remote: true,
            url: 'https://www.arbeitnow.com/jobs/role-1',
            tags: [],
            location: 'Berlin',
            created_at: 1787000000,
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );
    expect(vacancy?.description).toBe('THE ROLE Build things.');
  });

  it('reads a title the board escaped instead of printing the escape', () => {
    const [vacancy] = normalizeJsonSource(
      'src-remoteok',
      [
        { legal: 'licence record' },
        {
          id: '1',
          company: 'Smoke Mart &amp; Giftbox',
          position: 'Smokemart &amp; GiftBox Sales Assistant',
          description: 'Sell things.',
          url: 'https://remoteok.com/l/1',
          tags: [],
          date: '2026-08-30T09:00:00+00:00',
        },
      ],
      { observedAt: OBSERVED_AT },
    );
    expect(vacancy?.title).toBe('Smokemart & GiftBox Sales Assistant');
    expect(vacancy?.company).toBe('Smoke Mart & Giftbox');
  });

  it('reads a description a board publishes as plain HTML', () => {
    const [vacancy] = normalizeJsonSource(
      'src-arbeitnow',
      {
        data: [
          {
            slug: 'role-2',
            company_name: 'Beispiel GmbH',
            title: 'Datenerfasser',
            description: '<p>Lust auf einen Neustart?</p>\n<p>Keine Vorkenntnisse&nbsp;nötig.</p>',
            remote: false,
            url: 'https://www.arbeitnow.com/jobs/role-2',
            tags: [],
            location: 'Berlin',
            created_at: 1787000000,
          },
        ],
      },
      { observedAt: OBSERVED_AT },
    );
    expect(vacancy?.description).toBe('Lust auf einen Neustart? Keine Vorkenntnisse nötig.');
  });
});

/**
 * B216 — формы записей сняты с живых ответов площадок 2026-09-14 с прод-VM и
 * урезаны до того, что читает адаптер.
 */
describe('json source adapters: paged platforms and career sites (B216)', () => {
  const observedAt = '2026-09-14T01:30:00.000Z';

  it('normalises a TheMuse record', () => {
    const [vacancy] = normalizeJsonSource(
      'src-themuse',
      {
        page: 1,
        page_count: 10761,
        results: [
          {
            contents: '<p><b>Infosys is hiring</b></p>',
            name: 'Principal SAP ATTP Consultant',
            publication_date: '2026-09-13T20:11:49Z',
            id: 22160581,
            locations: [{ name: 'Calgary, Canada' }, { name: 'Flexible / Remote' }],
            categories: [{ name: 'Software Engineering' }],
            levels: [{ name: 'Senior Level', short_name: 'senior' }],
            refs: {
              landing_page: 'https://www.themuse.com/jobs/infosys/principal-sap-attp-consultant',
            },
            company: { id: 15000261, short_name: 'infosys', name: 'Infosys' },
          },
        ],
      },
      { observedAt },
    );

    expect(vacancy).toMatchObject({
      title: 'Principal SAP ATTP Consultant',
      company: 'Infosys',
      location: 'Calgary, Canada; Flexible / Remote',
      isRemote: true,
      experienceLevel: 'Senior Level',
      requiredSkills: ['Software Engineering'],
      url: 'https://www.themuse.com/jobs/infosys/principal-sap-attp-consultant',
      publishedAt: '2026-09-13T20:11:49.000Z',
    });
  });

  it('normalises an Amazon.jobs record with an absolute link', () => {
    const [vacancy] = normalizeJsonSource(
      'src-amazon-jobs',
      {
        hits: 10000,
        jobs: [
          {
            id: '45f954d9',
            id_icims: '10538311',
            title: 'Senior Manager, Supply Chain Management',
            company_name: 'Amazon Japan G.K.',
            normalized_location: 'Tokyo, JPN',
            description: 'AMXL JP is looking for a Senior Manager',
            basic_qualifications: '- 7+ years',
            job_category: 'Fulfillment & Operations Management',
            job_family: 'Supply Chain Management',
            job_schedule_type: 'full-time',
            job_path: '/en/jobs/10538311/senior-manager-supply-chain-management',
            posted_date: 'September 13, 2026',
          },
        ],
      },
      { observedAt, sourceName: 'Amazon' },
    );

    expect(vacancy).toMatchObject({
      company: 'Amazon Japan G.K.',
      location: 'Tokyo, JPN',
      isRemote: false,
      employmentType: 'full-time',
      url: 'https://www.amazon.jobs/en/jobs/10538311/senior-manager-supply-chain-management',
      publishedAt: '2026-09-13T00:00:00.000Z',
    });
    expect(vacancy?.description).toContain('7+ years');
    expect(vacancy?.provenance.externalId).toBe('10538311');
  });

  it('normalises a Netflix (Eightfold) position and names the employer from the registry', () => {
    const [vacancy] = normalizeJsonSource(
      'src-netflix',
      {
        count: 488,
        positions: [
          {
            id: 790318395912,
            name: 'Sr. Account Manager (Germany)',
            location: 'Germany - Remote',
            department: 'Advertising',
            business_unit: 'Streaming',
            t_create: 1788825600,
            display_job_id: 'JR42469',
            job_description: '',
            work_location_option: 'onsite',
            canonicalPositionUrl: 'https://explore.jobs.netflix.net/careers/job/790318395912',
          },
        ],
      },
      { observedAt, sourceName: 'Netflix' },
    );

    expect(vacancy).toMatchObject({
      company: 'Netflix',
      location: 'Germany - Remote',
      isRemote: true,
      url: 'https://explore.jobs.netflix.net/careers/job/790318395912',
      publishedAt: new Date(1788825600 * 1000).toISOString(),
    });
    expect(vacancy?.description).toContain('Advertising');
    expect(vacancy?.provenance.externalId).toBe('JR42469');
  });

  it('reads Workday "Posted N Days Ago" against the observation time', () => {
    expect(fromWorkdayPostedOn('Posted Today', observedAt)).toBe(observedAt);
    expect(fromWorkdayPostedOn('Posted Yesterday', observedAt)).toBe('2026-09-13T01:30:00.000Z');
    expect(fromWorkdayPostedOn('Posted 3 Days Ago', observedAt)).toBe('2026-09-11T01:30:00.000Z');
    expect(fromWorkdayPostedOn('Posted 30+ Days Ago', observedAt)).toBe('2026-08-15T01:30:00.000Z');
    expect(fromWorkdayPostedOn('', observedAt)).toBe(UNKNOWN_PUBLISHED_AT);
  });

  it('builds the public Workday link from the tenant site, not from the API path', () => {
    expect(
      workdayPublicUrl(
        'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
        '/job/US-CA-Santa-Clara/Senior-Firmware-Engineer_JR1999599',
      ),
    ).toBe(
      'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Firmware-Engineer_JR1999599',
    );
    expect(workdayPublicUrl('https://example.com/other/path', '/job/x')).toBe('');
    expect(workdayPublicUrl(undefined, '/job/x')).toBe('');
  });

  it('drops a Workday posting whose public link cannot be built', () => {
    const vacancies = normalizeJsonSource(
      'ats-workday-nvidia',
      { total: 1, jobPostings: [{ title: 'X', externalPath: '/job/x', postedOn: 'Posted Today' }] },
      { observedAt, sourceName: 'NVIDIA' },
    );
    expect(vacancies).toEqual([]);
  });
});
