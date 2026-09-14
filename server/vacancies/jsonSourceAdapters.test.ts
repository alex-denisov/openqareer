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
      'src-hn-whoishiring',
      'src-naukri',
      'src-bdjobs',
      'src-ziprecruiter',
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

/**
 * B217 — площадки, названные владельцем. Форма записи взята с прод-VM
 * 2026-09-14, а не угадана.
 */
describe('json source adapters (B217)', () => {
  const observedAt = '2026-09-14T09:00:00.000Z';

  it('Apple: карточка из res.searchResults с адресом /en-us/details/<id>/<slug>', () => {
    const [vacancy] = normalizeJsonSource(
      'src-apple-jobs',
      {
        res: {
          totalRecords: 6081,
          searchResults: [
            {
              id: 'PIPE-200313970',
              positionId: '200313970',
              postingTitle: 'IN-Business Expert',
              jobSummary: 'Apple Retail is where the best of Apple comes together.',
              locations: [{ name: 'India', countryName: 'India' }],
              postDateInGMT: '2026-09-14T06:29:22.144Z',
              transformedPostingTitle: 'in-business-expert',
              team: { teamName: 'Apple Retail' },
              homeOffice: false,
            },
          ],
        },
      },
      { observedAt, sourceName: 'Apple' },
    );
    expect(vacancy).toMatchObject({
      company: 'Apple',
      title: 'IN-Business Expert',
      location: 'India',
      isRemote: false,
      url: 'https://jobs.apple.com/en-us/details/200313970/in-business-expert',
      publishedAt: '2026-09-14T06:29:22.144Z',
    });
    expect(vacancy?.provenance.externalId).toBe('200313970');
    expect(vacancy?.requiredSkills).toContain('Apple Retail');
  });

  it('Microsoft: Eightfold-запись под data.positions с относительным positionUrl', () => {
    const [vacancy] = normalizeJsonSource(
      'src-microsoft-careers',
      {
        data: {
          count: 2215,
          positions: [
            {
              id: 1970393556960444,
              displayJobId: '200048065',
              name: 'Metro Construction EHS Manager - Spain',
              locations: ['Spain, Zaragoza, Zaragoza'],
              postedTs: 1789365721,
              department: 'Environmental Health & Safety',
              workLocationOption: 'onsite',
              positionUrl: '/careers/job/1970393556960444',
            },
          ],
        },
      },
      { observedAt, sourceName: 'Microsoft' },
    );
    expect(vacancy).toMatchObject({
      company: 'Microsoft',
      location: 'Spain, Zaragoza, Zaragoza',
      isRemote: false,
      url: 'https://apply.careers.microsoft.com/careers/job/1970393556960444',
      publishedAt: new Date(1789365721 * 1000).toISOString(),
    });
    expect(vacancy?.provenance.externalId).toBe('200048065');
    expect(vacancy?.description).toContain('Environmental Health');
  });

  it('Eightfold: относительный адрес пришивается к хосту площадки, чужой хост — отсев', () => {
    const position = (positionUrl: string) => ({
      data: { count: 1, positions: [{ id: 1, displayJobId: 'X1', name: 'Role', locations: ['Spain'], postedTs: 1789365721, positionUrl }] },
    });
    const context = { observedAt, sourceName: 'Microsoft' };
    expect(normalizeJsonSource('src-microsoft-careers', position('/careers/job/1'), context)[0]?.url).toBe(
      'https://apply.careers.microsoft.com/careers/job/1',
    );
    // Без ведущей косой черты адрес всё равно остаётся на хосте площадки.
    expect(normalizeJsonSource('src-microsoft-careers', position('evil.example/x'), context)[0]?.url).toBe(
      'https://apply.careers.microsoft.com/evil.example/x',
    );
    expect(normalizeJsonSource('src-microsoft-careers', position('https://evil.example/x'), context)).toHaveLength(0);
  });

  it('Apple: идентификатор с чужими символами не становится адресом', () => {
    const payload = (positionId: string) => ({
      res: { totalRecords: 1, searchResults: [{ positionId, postingTitle: 'T', jobSummary: 'S', transformedPostingTitle: 'a b?', postDateInGMT: observedAt, locations: [] }] },
    });
    const context = { observedAt, sourceName: 'Apple' };
    expect(normalizeJsonSource('src-apple-jobs', payload('200313970'), context)[0]?.url).toBe(
      'https://jobs.apple.com/en-us/details/200313970/a%20b%3F',
    );
    expect(normalizeJsonSource('src-apple-jobs', payload('1/../x'), context)).toHaveLength(0);
  });

  it('Remotive: запись из jobs[] с работодателем, ссылкой на площадку и датой', () => {
    const [vacancy] = normalizeJsonSource(
      'remotive',
      {
        'job-count': 16,
        jobs: [
          {
            id: 1680495,
            url: 'https://remotive.com/remote-jobs/marketing/remote-office-assistant-1680495',
            title: 'Remote Office Assistant',
            company_name: 'Coalition Technologies ',
            category: 'Marketing',
            job_type: 'full_time',
            publication_date: '2026-09-11T20:16:48',
            candidate_required_location: 'USA',
            salary: '$40k - $50k',
            description: '<p>Help the team.</p>',
          },
        ],
      },
      { observedAt, sourceName: 'Remotive' },
    );
    expect(vacancy).toMatchObject({
      company: 'Coalition Technologies',
      title: 'Remote Office Assistant',
      location: 'USA',
      isRemote: true,
      employmentType: 'full_time',
      url: 'https://remotive.com/remote-jobs/marketing/remote-office-assistant-1680495',
    });
    expect(vacancy?.publishedAt.startsWith('2026-09-11')).toBe(true);
    expect(vacancy?.provenance.externalId).toBe('1680495');
  });

  it('Get on Board: работодатель из expand=["company"], ссылка из links.public_url', () => {
    const [vacancy] = normalizeJsonSource(
      'src-getonbrd',
      {
        data: [
          {
            id: 'frontend-engineer-angular-improving-south-america-remote',
            attributes: {
              title: 'Front-end Engineer (Angular)',
              description: '<p>Angular work</p>',
              functions: '<ul><li>Build</li></ul>',
              remote: true,
              remote_modality: 'fully_remote',
              countries: ['Colombia'],
              published_at: 1788556837,
              seniority: { data: { id: 3, attributes: { name: 'Senior' } } },
              modality: { data: { id: 1, attributes: { name: 'Full time' } } },
              company: { data: { id: 'improving', attributes: { name: 'Improving' } } },
            },
            links: { public_url: 'https://www.getonbrd.com/jobs/frontend-engineer-angular-improving-south-america-remote' },
          },
        ],
      },
      { observedAt, sourceName: 'Get on Board' },
    );
    expect(vacancy).toMatchObject({
      company: 'Improving',
      location: 'Colombia',
      isRemote: true,
      url: 'https://www.getonbrd.com/jobs/frontend-engineer-angular-improving-south-america-remote',
      publishedAt: new Date(1788556837 * 1000).toISOString(),
    });
    expect(vacancy?.description).toContain('Build');
  });
});

/**
 * B218 — Indeed через мобильный GraphQL. Форма записи снята с прод-VM
 * 2026-09-14.
 */
describe('Indeed adapter (B218)', () => {
  it('разбирает запись jobSearch.results[].job с адресом viewjob', () => {
    const [vacancy] = normalizeJsonSource(
      'src-indeed',
      {
        data: {
          jobSearch: {
            pageInfo: { nextCursor: 'abc' },
            results: [
              {
                job: {
                  key: 'a1b2c3',
                  title: 'Communication Systems Engineer',
                  datePublished: 1788963204000,
                  description: { html: '<p>Build systems.</p>' },
                  location: { city: 'Merritt Island', countryName: 'US', formatted: { long: 'Merritt Island, FL' } },
                  employer: { name: 'Aetos Systems' },
                  recruit: { viewJobUrl: 'https://www.indeed.com/rc/clk?jk=a1b2c3' },
                },
              },
            ],
          },
        },
      },
      { observedAt: '2026-09-14T09:00:00.000Z', sourceName: 'Indeed' },
    );
    expect(vacancy).toMatchObject({
      title: 'Communication Systems Engineer',
      company: 'Aetos Systems',
      location: 'Merritt Island, FL',
      url: 'https://www.indeed.com/rc/clk?jk=a1b2c3',
      publishedAt: new Date(1788963204000).toISOString(),
    });
    expect(vacancy?.provenance.externalId).toBe('a1b2c3');
    expect(vacancy?.description).toContain('Build systems');
  });

  it('без recruit.viewJobUrl адрес собирается из ключа', () => {
    const [vacancy] = normalizeJsonSource(
      'src-indeed',
      { data: { jobSearch: { results: [{ job: { key: 'zz9', title: 'T', employer: { name: 'E' }, location: {}, datePublished: 1788963204000 } }] } } },
      { observedAt: 'now', sourceName: 'Indeed' },
    );
    expect(vacancy?.url).toBe('https://www.indeed.com/viewjob?jk=zz9');
  });
});
