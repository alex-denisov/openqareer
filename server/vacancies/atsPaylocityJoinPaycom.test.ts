import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import { buildMultiSourceFetcher } from './multiSourceFetcher';
import {
  ATS_PROVIDERS,
  atsBoardContract,
  atsBoardEndpoint,
  normalizeAtsBoard,
  parseAtsBoardSourceId,
} from './atsBoardAdapters';
import { extractPaylocityJobs } from './atsListingReaders';
import { fetchPaycomBoard } from './paycomBoardFetch';
import { pagingPlanFor } from './pagedJsonSources';
import { sourceKind } from './poolLiveness';

/**
 * B646-5 — Paylocity, Join и Paycom. Записи сняты с живых досок 2026-11-11
 * (Cabot Properties на Paylocity, Just Hiring на Join, CHOC на Paycom) и
 * обрезаны до полей, которые читает адаптер.
 */
const OBSERVED_AT = '2026-11-11T12:00:00.000Z';
const PAYLOCITY_GUID = '7186761b-1318-47f2-b709-d7e7995cd3f3';
const PAYCOM_KEY = '0012604c8f3328ef1785c7189f1333b7';

const paylocityBrief = (over: Record<string, unknown> = {}) => ({
  JobId: 4553411,
  JobTitle: 'Assistant Property Manager',
  LocationName: 'Irvine, CA',
  PublishedDate: '2026-10-02T10:51:13-05:00',
  Description: 'Company OverviewCabot Properties is a leading international [private] equity',
  HiringDepartment: 'Property Management',
  JobLocation: { City: 'Irvine', State: 'CA', Country: 'USA' },
  IsRemote: false,
  IndeedRemoteType: 2,
  ...over,
});

function paylocityPage(jobs: unknown[]): string {
  const data = {
    Departments: ['All Departments', 'Property Management'],
    IsLeadJoinEnabled: false,
    Jobs: jobs,
    LeadJoinUrl: `/Recruiting/PublicLeads/New/${PAYLOCITY_GUID}`,
  };
  return `<html><head><script>window.pageData = ${JSON.stringify(data)};</script></head><body></body></html>`;
}

describe('B646-5 контракты Paylocity, Join, Paycom', () => {
  it('строит адреса досок по замеренному образцу', () => {
    expect(atsBoardEndpoint('paylocity', PAYLOCITY_GUID)).toBe(
      `https://recruiting.paylocity.com/Recruiting/Jobs/All/${PAYLOCITY_GUID}`,
    );
    expect(atsBoardEndpoint('join', '167291')).toBe(
      'https://join.com/api/public/companies/167291/jobs?page=1&pageSize=5',
    );
    expect(atsBoardContract('join').boardUrl('167291')).toBe('https://join.com/companies/167291');
    expect(atsBoardEndpoint('paycom', PAYCOM_KEY)).toBe(
      `https://www.paycomonline.net/v4/ats/web.php/portal/${PAYCOM_KEY}/jobs/1`,
    );
    expect(parseAtsBoardSourceId(`ats-paycom-${PAYCOM_KEY}`)).toEqual({
      provider: 'paycom',
      board: PAYCOM_KEY,
    });
  });

  it('Paycom запрещает в robots.txt поиск вакансий — контракт честно запрещён', () => {
    const paycom = ATS_PROVIDERS.find((p) => p.provider === 'paycom');
    expect(paycom?.crawlPermission).toBe('robots_forbidden');
    expect(paycom?.robotsNote).toContain('job-posting-previews');
    expect(atsBoardContract('paylocity').crawlPermission).toBe('allowed');
    expect(atsBoardContract('join').crawlPermission).toBe('allowed');
  });

  it('доски трёх провайдеров подтверждают живость как доски ATS', () => {
    for (const provider of ['paylocity', 'join', 'paycom']) {
      expect(sourceKind(`ats-${provider}-x1`)).toEqual({ kind: 'ats', provider });
    }
  });
});

describe('B646-5 Paylocity: window.pageData.Jobs со страницы доски', () => {
  it('вырезает массив Jobs, не путаясь в скобках внутри строк', () => {
    const jobs = extractPaylocityJobs(paylocityPage([paylocityBrief()]));
    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]).toMatchObject({ JobId: 4553411 });
  });

  it('читает вакансию: ссылка на карточку, страна, дата, текст из списка', () => {
    const [vacancy] = normalizeAtsBoard(
      `ats-paylocity-${PAYLOCITY_GUID}`,
      paylocityPage([paylocityBrief()]),
      { observedAt: OBSERVED_AT, sourceName: 'Cabot Properties' },
    );
    expect(vacancy).toMatchObject({
      title: 'Assistant Property Manager',
      company: 'Cabot Properties',
      location: 'Irvine, CA, USA',
      isRemote: false,
      url: 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/4553411',
      publishedAt: '2026-10-02T15:51:13.000Z',
    });
    expect(vacancy?.description).toContain('Property Management');
    expect(vacancy?.description).toContain('Cabot Properties is a leading');
  });

  it('IsRemote с типом 1 — гибрид, а не удалёнка; «Remote Worker» без флага — удалёнка', () => {
    const [hybrid, remote, labelled] = normalizeAtsBoard(
      `ats-paylocity-${PAYLOCITY_GUID}`,
      paylocityPage([
        paylocityBrief({ JobId: 1, IsRemote: true, IndeedRemoteType: 1 }),
        paylocityBrief({ JobId: 2, IsRemote: true, IndeedRemoteType: 2 }),
        paylocityBrief({ JobId: 3, LocationName: 'Remote Worker' }),
      ]),
      { observedAt: OBSERVED_AT, sourceName: 'Cabot Properties' },
    );
    expect([hybrid?.isRemote, remote?.isRemote, labelled?.isRemote]).toEqual([false, true, true]);
  });

  it('страница без Jobs — нечитаемый ответ, а не пустая доска; пустой Jobs — пустая доска', () => {
    expect(() =>
      normalizeAtsBoard('ats-paylocity-x', '<html>Maintenance</html>', { observedAt: OBSERVED_AT }),
    ).toThrow('vacancy_source_payload_unreadable');
    expect(
      normalizeAtsBoard('ats-paylocity-x', paylocityPage([]), { observedAt: OBSERVED_AT }),
    ).toEqual([]);
  });
});

const joinItem = {
  id: 16859149,
  idParam: '16909372-copywriter-m-w-d-direct-response-100-remote',
  title: 'Copywriter (m/w/d) Direct Response, 100 % Remote',
  createdAt: '2026-10-21T17:51:23.236Z',
  workplaceType: 'REMOTE',
  remoteType: 'ANYWHERE',
  category: { id: 262, name: 'CRM, Direct Marketing' },
  employmentType: { id: 6, name: 'Employee' },
  city: { cityName: 'Berlin', countryName: 'Germany' },
};

describe('B646-5 Join: публичный список компании', () => {
  it('читает запись списка; ссылка по id компании ведёт на доску (301 на домен)', () => {
    const [vacancy] = normalizeAtsBoard(
      'ats-join-167291',
      { items: [joinItem], pagination: { rowCount: 1, pageCount: 1, page: 1, pageSize: 5 } },
      { observedAt: OBSERVED_AT, sourceName: 'Just Hiring' },
    );
    expect(vacancy).toMatchObject({
      title: 'Copywriter (m/w/d) Direct Response, 100 % Remote',
      company: 'Just Hiring',
      location: 'Berlin, Germany',
      isRemote: true,
      employmentType: 'Employee',
      url: 'https://join.com/companies/167291/16909372-copywriter-m-w-d-direct-response-100-remote',
      publishedAt: '2026-10-21T17:51:23.236Z',
    });
    expect(vacancy?.description).toContain('CRM, Direct Marketing');
  });

  it('листает по 5 до pageCount; потолок страниц оставляет запрос — чтение частичное', () => {
    const plan = pagingPlanFor('ats-join-167291')!;
    const base = atsBoardEndpoint('join', '167291');
    const first = plan.first(base, 0);
    expect(first.url).toBe(base);
    const page = (pageCount: number) => ({
      items: Array.from({ length: 5 }, () => joinItem),
      pagination: { pageCount },
    });
    const second = plan.next(first, page(3))!;
    expect(new URL(second.url).searchParams.get('page')).toBe('2');
    expect(new URL(second.url).searchParams.get('pageSize')).toBe('5');
    const third = plan.next(second, page(3))!;
    expect(plan.next(third, page(3))).toBeNull();
    expect(plan.next(first, { items: [], pagination: { pageCount: 0 } })).toBeNull();
    // Без pageCount полная страница не считается последней.
    expect(plan.next(first, { items: page(1).items })).not.toBeNull();
    expect(plan.next(first, { items: [joinItem] })).toBeNull();
    // Join считает частоту: не больше 1,5 запроса в секунду даже с джиттером −25 %.
    expect(plan.delayMs * 0.75).toBeGreaterThanOrEqual(1000 / 1.5);
  });
});

const preview = (jobId: number, over: Record<string, unknown> = {}) => ({
  jobId,
  jobTitle: 'Call Center Representative',
  positionType: 'Full Time',
  remoteType: '',
  locations: 'Vacaville, CA 95688',
  description: 'Job Title: Call Center Representative (Energy) Department: CHOC Energy ...',
  postedOn: '',
  isHotJob: true,
  ...over,
});

describe('B646-5 Paycom: превью поиска', () => {
  it('читает превью с именем работодателя из company-name', () => {
    const [vacancy, remote] = normalizeAtsBoard(
      `ats-paycom-${PAYCOM_KEY}`,
      {
        companyName: 'CHOC',
        jobPostingPreviews: [preview(140820), preview(2, { remoteType: 'Remote' })],
      },
      { observedAt: OBSERVED_AT, sourceName: 'Community Housing' },
    );
    expect(vacancy).toMatchObject({
      title: 'Call Center Representative',
      company: 'CHOC',
      location: 'Vacaville, CA 95688',
      isRemote: false,
      employmentType: 'Full Time',
      url: `https://www.paycomonline.net/v4/ats/web.php/portal/${PAYCOM_KEY}/jobs/140820`,
    });
    expect(vacancy?.description).toContain('CHOC Energy');
    expect(remote?.isRemote).toBe(true);
  });
});

type Answer = { status?: number; body: unknown };

function fakePaycom(pages: Answer[], portal = PORTAL) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let page = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/web.php/portal/')) return new Response(portal, { status: 200 });
    if (url.endsWith('/api/ats/company-name')) return Response.json({ companyName: 'CHOC' });
    const answer = pages[page++] ?? { status: 500, body: {} };
    return Response.json(answer.body, { status: answer.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const PORTAL =
  '<script>var configsFromHost = {"sessionJWT":"eyJ.test.jwt","mantle":"https://portal-applicant-tracking.us-cent.paycomonline.net"};</script>';
const noSleep = async () => undefined;
const previews = (from: number, n: number, total: number | undefined) => ({
  body: {
    ...(total === undefined ? {} : { jobPostingPreviewsCount: total }),
    jobPostingPreviews: Array.from({ length: n }, (_, i) => preview(from + i)),
  },
});

describe('B646-5 Paycom: полная выдача только до заявленного итога', () => {
  it('дочитывает до jobPostingPreviewsCount — чтение полное; JWT идёт заголовком', async () => {
    const { impl, calls } = fakePaycom([previews(0, 50, 60), previews(50, 10, 60)]);
    const reading = await fetchPaycomBoard(PAYCOM_KEY, impl, noSleep);
    expect(reading.partial).toBe(false);
    expect(reading.payload.jobPostingPreviews).toHaveLength(60);
    expect(reading.payload.companyName).toBe('CHOC');
    const search = calls.filter((c) => c.url.endsWith('/job-posting-previews/search'));
    expect(search).toHaveLength(2);
    expect(JSON.parse(String(search[1]?.init?.body))).toMatchObject({ skip: 50, take: 50 });
    expect(new Headers(search[0]?.init?.headers).get('Authorization')).toBe('eyJ.test.jwt');
  });

  it('сбой страницы после первой, пустая страница до итога и ответ без итога — частичное чтение', async () => {
    const failed = await fetchPaycomBoard(
      PAYCOM_KEY,
      fakePaycom([previews(0, 50, 120), { status: 503, body: {} }]).impl,
      noSleep,
    );
    expect(failed).toMatchObject({ partial: true });
    expect(failed.payload.jobPostingPreviews).toHaveLength(50);

    const empty = await fetchPaycomBoard(
      PAYCOM_KEY,
      fakePaycom([previews(0, 50, 120), previews(0, 0, 120)]).impl,
      noSleep,
    );
    expect(empty.partial).toBe(true);

    const noTotal = await fetchPaycomBoard(
      PAYCOM_KEY,
      fakePaycom([previews(0, 50, undefined)]).impl,
      noSleep,
    );
    expect(noTotal.partial).toBe(true);
  });

  it('потолок страниц до итога — частичное чтение', async () => {
    const pages = Array.from({ length: 100 }, (_, i) => previews(i * 50, 50, 100_000));
    const reading = await fetchPaycomBoard(PAYCOM_KEY, fakePaycom(pages).impl, noSleep);
    expect(reading.partial).toBe(true);
    expect(reading.payload.jobPostingPreviews.length).toBeGreaterThanOrEqual(2705);
  });

  it('сбой первой страницы и снятая доска — отказ источника, а не ноль вакансий', async () => {
    await expect(
      fetchPaycomBoard(PAYCOM_KEY, fakePaycom([{ status: 503, body: {} }]).impl, noSleep),
    ).rejects.toThrow('vacancy_source_unreachable: 503');
    await expect(
      fetchPaycomBoard(
        PAYCOM_KEY,
        fakePaycom([], '<p>Job board does not exist or is unavailable at this time.</p>').impl,
        noSleep,
      ),
    ).rejects.toThrow('vacancy_source_board_gone');
    await expect(
      fetchPaycomBoard(PAYCOM_KEY, fakePaycom([], '<html>shell</html>').impl, noSleep),
    ).rejects.toThrow('vacancy_source_payload_unreadable');
  });
});

describe('B646-5 сборщик: доски через multiSourceFetcher', () => {
  const refuse = () => {
    throw new Error('hh/remotive не участвуют');
  };
  const source = (id: string, targetUrl: string): VacancySourceConfig => ({
    id,
    name: 'Just Hiring',
    type: 'json_api',
    enabled: true,
    targetUrl,
    refreshIntervalMinutes: 180,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  });
  const fetcher = () =>
    buildMultiSourceFetcher(refuse, refuse, undefined, { sleep: async () => {}, now: () => 0 });
  const joinPage = (n: number, pageCount: number) => ({
    items: Array.from({ length: n }, (_, i) => ({
      ...joinItem,
      id: n * 1000 + i,
      idParam: `j-${i}`,
    })),
    pagination: { pageCount },
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Join: дочитанная до pageCount доска — полное чтение', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json(joinPage(page === 1 ? 5 : 2, 2));
    });
    const reading = await fetcher()(source('ats-join-167291', atsBoardEndpoint('join', '167291')));
    expect(seen).toHaveLength(2);
    expect(reading).toMatchObject({ partial: false });
    expect('vacancies' in reading && reading.vacancies).toHaveLength(7);
  });

  it('Join: потолок страниц и сбой страницы после первой — частичное чтение', async () => {
    vi.stubGlobal('fetch', async () => Response.json(joinPage(5, 1000)));
    const capped = await fetcher()(source('ats-join-1', atsBoardEndpoint('join', '1')));
    expect(capped).toMatchObject({ partial: true });

    let calls = 0;
    vi.stubGlobal('fetch', async () =>
      calls++ === 0 ? Response.json(joinPage(5, 3)) : new Response('', { status: 429 }),
    );
    const failed = await fetcher()(source('ats-join-1', atsBoardEndpoint('join', '1')));
    expect(failed).toMatchObject({ partial: true });
  });

  it('Paylocity: HTML доски разбирается одним запросом', async () => {
    vi.stubGlobal('fetch', async () => new Response(paylocityPage([paylocityBrief()])));
    const vacancies = await fetcher()(
      source(`ats-paylocity-${PAYLOCITY_GUID}`, atsBoardEndpoint('paylocity', PAYLOCITY_GUID)),
    );
    const list = Array.isArray(vacancies) ? vacancies : vacancies.vacancies;
    expect(list.map((v) => v.title)).toEqual(['Assistant Property Manager']);
  });

  it('Paycom: сборщик отдаёт частичность из fetchPaycomBoard', async () => {
    vi.stubGlobal('fetch', fakePaycom([previews(0, 50, 120), { status: 503, body: {} }]).impl);
    const reading = await fetcher()(
      source(`ats-paycom-${PAYCOM_KEY}`, atsBoardEndpoint('paycom', PAYCOM_KEY)),
    );
    expect(reading).toMatchObject({ partial: true });
    expect('vacancies' in reading && reading.vacancies).toHaveLength(50);
  });
});
