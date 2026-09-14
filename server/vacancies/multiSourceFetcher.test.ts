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
 * B215 — постраничная площадка читается в пределах бюджета страниц, и
 * незаконченное чтение называет себя частичным, чтобы движок дополнял срез, а
 * не схлопывал его до последней прочитанной страницы.
 */
describe('multi-source fetcher: paged JSON sources (B215)', () => {
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
