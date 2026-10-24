import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerReportedSeoBotObservability, reportedBot, seoSurface } from './reportedSeoBots';

const names = ['YandexBot', 'YandexAdditional', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'Google-Extended', 'Googlebot', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot'];
afterEach(() => vi.useRealTimers());

async function fixture() {
  const app = Fastify();
  const log = vi.spyOn(app.log, 'info');
  registerReportedSeoBotObservability(app);
  app.get('/*', async (request, reply) => reply.code(request.headers['x-test-status'] ? Number(request.headers['x-test-status']) : 200).send('ok'));
  await app.ready();
  return { app, log };
}
function reports(log: { mock: { calls: unknown[][] } }) {
  return log.mock.calls.map(([value]) => value as { event?: string; buckets: { bot: string; count: number; status: string }[]; overflowResponses: number; complete: boolean; partial: boolean }).filter((value) => value?.event === 'seo_reported_bot_responses');
}

describe('reported crawler classification', () => {
  it('matches only bounded allowlisted tokens, with ambiguous identities separate', () => {
    for (const name of names) expect(reportedBot(`Mozilla/5.0 (compatible; ${name}/1.0)`)).toBe(name);
    expect(reportedBot('GPTBot Googlebot')).toBe('ambiguous');
    for (const ua of [undefined, '', 'Mozilla/5.0', 'FakeGPTBot', 'Googlebot-News', `GPTBot ${'a'.repeat(2048)}`]) expect(reportedBot(ua)).toBeNull();
  });
  it('accepts public surface shapes without retaining inputs', () => {
    expect(seoSurface('/vacancies/job/example?email=private')).toBe('vacancy_job');
    expect(seoSurface('/sitemaps/jobs-1.xml')).toBe('sitemap_shard');
    for (const path of ['/api/v1/admin/seo', '/app', '/admin', '/login', '/signup', '/unknown', '//host/faq', '/faq/extra', `/faq?${'x'.repeat(8192)}`]) expect(seoSurface(path)).toBeNull();
  });
});

describe('response aggregation lifecycle', () => {
  it('counts actual response statuses and excludes private, unknown and normal browser traffic', async () => {
    const { app, log } = await fixture();
    for (const status of [200, 200, 502, 503]) await app.inject({ url: '/faq?secret=hidden', headers: { 'user-agent': 'spoofed GPTBot/1.0', 'x-test-status': String(status), referer: 'private', 'x-forwarded-for': '127.1.2.3' } });
    for (const url of ['/api/private', '/app', '/admin', '/login', '/unknown']) await app.inject({ url, headers: { 'user-agent': 'GPTBot' } });
    await app.inject({ url: '/faq' });
    await app.inject({ url: '/faq', headers: { 'user-agent': 'GPTBot Googlebot' } });
    await app.close();
    const [report] = reports(log);
    expect(report).toMatchObject({ partial: true, complete: true, overflowResponses: 0, identity: 'reported_user_agent_unverified' });
    expect(report.buckets).toEqual(expect.arrayContaining([
      { bot: 'GPTBot', surface: 'faq', status: '200', count: 2 },
      { bot: 'GPTBot', surface: 'faq', status: '502', count: 1 },
      { bot: 'GPTBot', surface: 'faq', status: '5xx', count: 1 },
      { bot: 'ambiguous', surface: 'faq', status: '200', count: 1 },
    ]));
    expect(report.buckets).toHaveLength(4);
    const json = JSON.stringify(report);
    for (const secret of ['hidden', 'spoofed', 'referer', '127.1.2.3', '/faq', 'secret']) expect(json).not.toContain(secret);
  });
  it('flushes at five minutes, resets counts and clears its timer on close', async () => {
    vi.useFakeTimers();
    const { app, log } = await fixture();
    const clear = vi.spyOn(globalThis, 'clearInterval');
    await app.inject({ url: '/faq', headers: { 'user-agent': 'GPTBot' } });
    vi.advanceTimersByTime(300_000);
    expect(reports(log)[0]).toMatchObject({ partial: false });
    await app.inject({ url: '/faq', headers: { 'user-agent': 'GPTBot' } });
    await app.close();
    expect(reports(log)).toHaveLength(2);
    expect(reports(log)[1].buckets[0].count).toBe(1);
    expect(clear).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(600_000);
    expect(reports(log)).toHaveLength(2);
  });
  it('bounds cardinality and reports dropped buckets as incomplete, then resets overflow', async () => {
    vi.useFakeTimers();
    const { app, log } = await fixture();
    const paths = ['/', '/faq', '/support', '/tools/country-fit', '/legal/terms', '/legal/privacy', '/robots.txt', '/llms.txt', '/sitemap.xml', '/vacancies', '/salaries', '/vacancies/moscow'];
    let requests = 0;
    for (const bot of names) for (const url of paths) for (const status of [200, 302, 404]) {
      await app.inject({ url, headers: { 'user-agent': bot, 'x-test-status': String(status) } });
      requests += 1;
    }
    vi.advanceTimersByTime(300_000);
    const [report] = reports(log);
    expect(report.buckets).toHaveLength(256);
    expect(report.complete).toBe(false);
    expect(report.overflowResponses).toBe(requests - 256);
    await app.inject({ url: '/faq', headers: { 'user-agent': 'GPTBot' } });
    await app.close();
    expect(reports(log)[1]).toMatchObject({ complete: true, overflowResponses: 0 });
  }, 30_000);
});
