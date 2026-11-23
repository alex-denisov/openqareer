import { describe, expect, it, vi } from 'vitest';
import { OWN_VACANCY_USER_AGENT } from '../../../shared/b640OwnVacancy';
import { readVacancyPage } from './pageReader';

const PUBLIC = '93.184.216.34';
const HTML = '<html><title>x</title><body>ok</body></html>';

function res(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
}
interface Call { url: string; init?: RequestInit }
function setup(handler: (url: URL, call: number) => Response | Promise<Response>, resolveTo: Record<string, string> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
    return handler(url, calls.length);
  }) as unknown as typeof fetch;
  const resolve = async (host: string) => [resolveTo[host] ?? PUBLIC];
  const read = (link: string, extra: Partial<Parameters<typeof readVacancyPage>[1]> = {}) =>
    readVacancyPage(link, { fetchImpl, resolve, ...extra });
  const pageCalls = () => calls.filter((call) => !call.url.endsWith('/robots.txt'));
  return { read, calls, pageCalls, fetchImpl };
}

describe('readVacancyPage: адреса, которые не читаются без запроса', () => {
  const refused = [
    'http://127.0.0.1/job', 'http://localhost/job', 'http://169.254.169.254/latest', 'http://[::1]/job',
    'http://10.0.0.5/job', 'http://2130706433/job', 'http://0x7f000001/job', 'http://[::ffff:127.0.0.1]/job',
    'file:///etc/passwd', 'ftp://example.com/job', 'javascript:alert(1)', 'https://user:pass@example.com/job',
    'https://example.com:8443/job', 'not a url',
  ];
  it.each(refused)('%s', async (link) => {
    const { read, calls } = setup(() => res(HTML));
    expect(await read(link)).toEqual({ ok: false, reason: 'failed' });
    expect(calls).toHaveLength(0);
  });
  it('имя, которое разрешается во внутренний адрес', async () => {
    const { read, calls } = setup(() => res(HTML), { 'evil.example': '10.1.2.3' });
    expect(await read('https://evil.example/job')).toEqual({ ok: false, reason: 'failed' });
    expect(calls).toHaveLength(0);
  });
});

describe('readVacancyPage: закрытые площадки и robots.txt', () => {
  it.each(['https://www.linkedin.com/jobs/view/1', 'https://hh.ru/vacancy/12345678', 'https://spb.hh.ru/vacancy/1',
    'https://www.superjob.ru/vakansii/x.html', 'https://uk.indeed.com/viewjob?jk=1'])('%s без запроса', async (link) => {
    const { read, calls } = setup(() => res(HTML));
    expect(await read(link)).toEqual({ ok: false, reason: 'site_closed' });
    expect(calls).toHaveLength(0);
  });
  it('robots.txt закрывает путь', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      return String(input).endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /jobs/', { status: 200 }) : res(HTML);
    }) as unknown as typeof fetch;
    const out = await readVacancyPage('https://example.com/jobs/1', { fetchImpl, resolve: async () => [PUBLIC] });
    expect(out).toEqual({ ok: false, reason: 'site_closed' });
    expect(calls).toEqual(['https://example.com/robots.txt']);
  });
  it('robots.txt с 5xx — не читаем', async () => {
    const fetchImpl = (async (input: string | URL) =>
      String(input).endsWith('/robots.txt') ? new Response('', { status: 503 }) : res(HTML)) as unknown as typeof fetch;
    const out = await readVacancyPage('https://example.com/jobs/1', { fetchImpl, resolve: async () => [PUBLIC] });
    expect(out).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('readVacancyPage: переадресации', () => {
  it('на внутренний адрес — отказ', async () => {
    const { read, pageCalls } = setup(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    expect(await read('https://example.com/a')).toEqual({ ok: false, reason: 'failed' });
    expect(pageCalls()).toHaveLength(1);
  });
  it('на закрытую площадку — site_closed', async () => {
    const { read } = setup(() => new Response(null, { status: 301, headers: { location: 'https://www.linkedin.com/jobs/view/1' } }));
    expect(await read('https://example.com/a')).toEqual({ ok: false, reason: 'site_closed' });
  });
  it('три переадресации проходят, четвёртая — отказ', async () => {
    const hops = (count: number) => setup((url) => {
      const step = Number(url.searchParams.get('n') ?? '0');
      return step < count ? new Response(null, { status: 302, headers: { location: `/a?n=${step + 1}` } }) : res(HTML);
    });
    const three = hops(3);
    expect(await three.read('https://example.com/a')).toMatchObject({ ok: true });
    const four = hops(4);
    expect(await four.read('https://example.com/a')).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('readVacancyPage: ответ', () => {
  it('тело больше предела — failed, чтение остановлено', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(512 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    const { read } = setup(() => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await read('https://example.com/a')).toEqual({ ok: false, reason: 'failed' });
    expect(cancelled).toBe(true);
  });
  it('не HTML — failed', async () => {
    const { read } = setup(() => res('{}', { headers: { 'content-type': 'application/json' } }));
    expect(await read('https://example.com/a')).toEqual({ ok: false, reason: 'failed' });
  });
  it.each([401, 403, 429, 451, 500])('код %i — failed, одна загрузка страницы', async (status) => {
    const { read, pageCalls } = setup(() => res('no', { status }));
    expect(await read('https://example.com/a')).toEqual({ ok: false, reason: 'failed' });
    expect(pageCalls()).toHaveLength(1);
  });
  it('таймаут — failed', async () => {
    const { read } = setup((_url) => new Promise<Response>(() => undefined) as never);
    expect(await read('https://example.com/a', { timeoutMs: 30 })).toEqual({ ok: false, reason: 'failed' });
  });
  it('без cookies, с нужным User-Agent, возвращает html', async () => {
    const { read, calls } = setup(() => res(HTML));
    const out = await read('https://example.com/a');
    expect(out).toEqual({ ok: true, html: HTML });
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get('user-agent')).toBe(OWN_VACANCY_USER_AGENT);
      expect(headers.has('cookie')).toBe(false);
      expect(call.init?.credentials === undefined || call.init.credentials === 'omit').toBe(true);
    }
  });
});

describe('readVacancyPage: строка журнала о чтении (B676)', () => {
  it('отказ сайта — домен и код, без пути и запроса', async () => {
    const { read } = setup(() => res('blocked', { status: 403 }));
    const onTrace = vi.fn();
    await read('https://jobs.example.com/acme/123?lever-source=x', { onTrace });
    expect(onTrace).toHaveBeenCalledWith({ host: 'jobs.example.com', status: 403, bytes: 0, stage: 'page', outcome: 'failed' });
    expect(JSON.stringify(onTrace.mock.calls)).not.toMatch(/acme|lever-source/u);
  });
  it('прочитано — код 200 и байты страницы', async () => {
    const { read } = setup(() => res(HTML));
    const onTrace = vi.fn();
    await read('https://example.com/a', { onTrace });
    expect(onTrace).toHaveBeenCalledWith({ host: 'example.com', status: 200, bytes: HTML.length, stage: 'page', outcome: 'ok' });
  });
  it('таймаут — stage timeout', async () => {
    const { read } = setup(() => new Promise<Response>(() => undefined) as never);
    const onTrace = vi.fn();
    await read('https://example.com/a', { timeoutMs: 30, onTrace });
    expect(onTrace.mock.calls[0]?.[0]).toMatchObject({ host: 'example.com', stage: 'timeout', outcome: 'failed' });
  });
});
