import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMultiSourceFetcher } from './multiSourceFetcher';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

const refuse = () => {
  throw new Error('the fetcher must not reach any platform in this test');
};

/**
 * B199 — площадки за анти-ботом и площадки, запретившие обход словами в
 * robots.txt, остаются в реестре по требованию владельца, но сервер не имеет
 * права их опрашивать. Молчаливый пустой успех здесь опаснее ошибки: он
 * выглядел бы как «площадка сегодня без вакансий».
 */
describe('multi-source fetcher (B199)', () => {
  const browserOnly: VacancySourceConfig = {
    id: 'src-linkedin',
    name: 'LinkedIn Jobs',
    type: 'browser_session',
    enabled: false,
    targetUrl: 'https://www.linkedin.com/jobs/search/',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };

  it('refuses a browser-session source instead of reporting an empty success', async () => {
    const fetcher = buildMultiSourceFetcher(refuse, refuse);

    await expect(fetcher(browserOnly)).rejects.toThrow(
      'vacancy_source_type_unsupported: browser_session',
    );
  });
});

/**
 * B216 — постраничная площадка читается в пределах бюджета страниц, и
 * незаконченное чтение называет себя частичным, чтобы движок дополнял срез, а
 * не схлопывал его до последней прочитанной страницы.
 */
describe('multi-source fetcher: paged JSON sources (B216)', () => {
  const himalayas: VacancySourceConfig = {
    id: 'src-himalayas-api',
    name: 'Himalayas (JSON API)',
    type: 'json_api',
    enabled: true,
    targetUrl: 'https://himalayas.app/jobs/api?limit=20',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };

  const job = (n: number) => ({
    title: `Role ${n}`,
    companyName: 'Acme',
    applicationLink: `https://himalayas.app/companies/acme/jobs/role-${n}`,
    guid: `https://himalayas.app/companies/acme/jobs/role-${n}`,
    pubDate: 1789345008,
    description: '<p>text</p>',
  });

  function stubFetch(pages: Record<string, unknown>): string[] {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      const body = pages[url];
      if (body === undefined) return new Response('nope', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    return seen;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('читает страницы за курсором и завершает чтение, когда курсора нет', async () => {
    const seen = stubFetch({
      'https://himalayas.app/jobs/api?limit=20': { nextCursor: 'c1', jobs: [job(1)] },
      'https://himalayas.app/jobs/api?limit=20&cursor=c1': { nextCursor: '', jobs: [job(2)] },
    });
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
    });

    const reading = await fetcher(himalayas);

    expect(seen).toHaveLength(2);
    expect(reading).toMatchObject({ partial: false });
    expect('vacancies' in reading && reading.vacancies.map((v) => v.title)).toEqual([
      'Role 1',
      'Role 2',
    ]);
  });

  it('останавливается на бюджете страниц и называет чтение частичным', async () => {
    const pages: Record<string, unknown> = {
      'https://himalayas.app/jobs/api?limit=20': { nextCursor: 'c1', jobs: [job(1)] },
    };
    for (let i = 1; i < 40; i += 1) {
      pages[`https://himalayas.app/jobs/api?limit=20&cursor=c${i}`] = {
        nextCursor: `c${i + 1}`,
        jobs: [job(i + 1)],
      };
    }
    const seen = stubFetch(pages);
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
    });

    const reading = await fetcher(himalayas);

    expect(seen).toHaveLength(25);
    expect(reading).toMatchObject({ partial: true });
  });

  it('отказ на первой странице — отказ площадки, а не ноль вакансий', async () => {
    stubFetch({});
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
    });

    await expect(fetcher(himalayas)).rejects.toThrow('vacancy_source_unreachable: 404');
  });

  it('Workday читает списком через POST с телом смещения', async () => {
    const seen = stubFetch({
      'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs': {
        total: 1,
        jobPostings: [
          {
            title: 'Senior Firmware Engineer',
            externalPath: '/job/US-CA-Santa-Clara/Senior-Firmware-Engineer_JR1999599',
            locationsText: 'US, CA, Santa Clara',
            postedOn: 'Posted Today',
            bulletFields: ['JR1999599'],
          },
        ],
      },
    });
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
    });

    const reading = await fetcher({
      id: 'ats-workday-nvidia',
      name: 'NVIDIA',
      type: 'json_api',
      enabled: true,
      targetUrl:
        'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
      refreshIntervalMinutes: 720,
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    });

    expect(seen[0]).toMatch(/^POST /);
    expect(reading).toMatchObject({ partial: false });
    expect('vacancies' in reading && reading.vacancies[0]).toMatchObject({
      title: 'Senior Firmware Engineer',
      company: 'NVIDIA',
      url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Firmware-Engineer_JR1999599',
    });
  });
});

describe('multi-source fetcher: заголовки Indeed (B218)', () => {
  const indeed: VacancySourceConfig = {
    id: 'src-indeed',
    name: 'Indeed',
    type: 'json_api',
    enabled: true,
    targetUrl: 'https://apis.indeed.com/graphql',
    refreshIntervalMinutes: 180,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };

  afterEach(() => vi.unstubAllGlobals());

  it('заголовки площадки заменяют общие без дубля Content-Type (CSRF Indeed)', async () => {
    let captured: Headers | undefined;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      captured = new Headers(init?.headers);
      return new Response(
        JSON.stringify({ data: { jobSearch: { pageInfo: { nextCursor: '' }, results: [] } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
    });

    await fetcher(indeed);

    // Ровно один Content-Type, значение без склейки через запятую.
    expect(captured?.get('content-type')).toBe('application/json');
    // Ключ приложения дошёл, общий UA перекрыт клиентским.
    expect(captured?.get('indeed-api-key')).toBeTruthy();
    expect(captured?.get('user-agent')).toContain('Indeed App');
  });
});

describe('multi-source fetcher: Bayt career site and Obscura stealth (B218)', () => {
  const bayt: VacancySourceConfig = {
    id: 'src-bayt',
    name: 'Bayt',
    type: 'career_site',
    enabled: true,
    targetUrl: 'https://www.bayt.com/en/international/jobs/',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };

  const baytCard = (id: string, title: string) => `
    <li data-js-job="${id}">
      <h2><a href="/en/jobs/${id}/">${title}</a></h2>
      <b class="jb-company">Gulf Tech</b>
      <span class="jb-loc">Dubai</span>
      <span class="jb-date">1 day ago</span>
      <p class="jb-desc">Job description for ${title}</p>
    </li>
  `;

  afterEach(() => vi.unstubAllGlobals());

  it('читает страницы Bayt через HTML-скрейпер с поддержкой stealth', async () => {
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
      fetchWithStealth: async (url) => {
        if (url.includes('page=1')) {
          return {
            status: 200,
            body: `<ul>${baytCard('101', 'Frontend Developer')}</ul>`,
            usedStealth: false,
          };
        }
        return {
          status: 200,
          body: `<div id="search_results"><title>Bayt</title>No jobs</div>`,
          usedStealth: false,
        };
      },
    });

    const reading = await fetcher(bayt);
    expect(reading).toMatchObject({ partial: false });
    expect('vacancies' in reading && reading.vacancies).toHaveLength(1);
    expect('vacancies' in reading && reading.vacancies[0]!.title).toBe('Frontend Developer');
  });

  it('передает параметры запроса и падает на 429 на первой странице', async () => {
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
      fetchWithStealth: async () => ({
        status: 429,
        body: 'Too many requests',
        usedStealth: false,
      }),
    });

    await expect(fetcher(bayt)).rejects.toThrow('vacancy_source_unreachable: 429');
  });
});

describe('multi-source fetcher: Glassdoor Cloudflare 403 challenge fallback (B218)', () => {
  const glassdoor: VacancySourceConfig = {
    id: 'src-glassdoor',
    name: 'Glassdoor',
    type: 'json_api',
    enabled: true,
    targetUrl: 'https://www.glassdoor.com/graph',
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };

  afterEach(() => vi.unstubAllGlobals());

  it('при 403 Cloudflare challenge отдает запрос в stealth-раннер с сохранением POST и тела', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response('<html><title>Just a moment...</title>cf-chl</html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    });

    let capturedOptions: unknown;
    const fetcher = buildMultiSourceFetcher(refuse, refuse, undefined, {
      sleep: async () => {},
      now: () => 0,
      fetchWithStealth: async (_url, options) => {
        capturedOptions = options;
        const bodyObj =
          typeof options?.body === 'string' ? JSON.parse(options.body) : options?.body;
        const page = bodyObj?.variables?.pageNumber ?? 1;
        return {
          status: 200,
          body: JSON.stringify({
            data: {
              jobListings:
                page === 1
                  ? [
                      {
                        jobview: {
                          header: {
                            jobTitleText: 'Senior Backend Engineer',
                            employerNameFromSearch: 'Fintech',
                            locationName: 'Remote',
                          },
                          job: {
                            listingId: 'gd-stealth-1',
                            description: 'Distributed Go services',
                          },
                        },
                      },
                    ]
                  : [],
            },
          }),
          usedStealth: true,
        };
      },
    });

    const reading = await fetcher(glassdoor);
    expect('vacancies' in reading && reading.vacancies).toHaveLength(1);
    expect('vacancies' in reading && reading.vacancies[0]!.title).toBe('Senior Backend Engineer');
    expect(capturedOptions).toMatchObject({
      method: 'POST',
      body: expect.objectContaining({ operationName: 'JobSearchResultsQuery' }),
    });
  });
});
