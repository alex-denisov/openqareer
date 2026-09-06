import { describe, expect, it } from 'vitest';
import { RobotsPolicyLoader } from './robotsPolicyLoader';

/**
 * B204 — разбор `robots.txt` был написан, но продукт его не читал: правило
 * площадки приходило из статического реестра, а `Crawl-delay` не приходил
 * вовсе. Загрузчик спрашивает саму площадку и кэширует ответ по адресу хоста.
 */
describe('чтение robots.txt площадки', () => {
  it('запрет в robots.txt становится запретом расписания', async () => {
    const loader = new RobotsPolicyLoader({
      fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nDisallow: /\n' }),
    });

    const policy = await loader.policyFor('https://api.smartrecruiters.com/v1/companies/X/postings');

    expect(policy.verdict).toBe('disallowed');
  });

  it('берёт Crawl-delay из ответа площадки', async () => {
    const loader = new RobotsPolicyLoader({
      fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nAllow: /\nCrawl-delay: 3\n' }),
    });

    const policy = await loader.policyFor('https://api.lever.co/v0/postings/ledger?mode=json');

    expect(policy.verdict).toBe('allowed');
    expect(policy.crawlDelaySeconds).toBe(3);
  });

  it('спрашивает хост один раз, пока держится срок годности', async () => {
    let calls = 0;
    const loader = new RobotsPolicyLoader({
      fetchRobots: async () => {
        calls += 1;
        return { status: 200, body: 'User-agent: *\nDisallow: /embed/\n' };
      },
      ttlMs: 60_000,
    });

    await loader.policyFor('https://boards-api.greenhouse.io/v1/boards/a/jobs', 1_000);
    await loader.policyFor('https://boards-api.greenhouse.io/v1/boards/b/jobs', 2_000);
    expect(calls).toBe(1);

    await loader.policyFor('https://boards-api.greenhouse.io/v1/boards/c/jobs', 100_000);
    expect(calls).toBe(2);
  });

  it('недоступный robots.txt не выдаёт себя за разрешение и не глушит площадку', async () => {
    const loader = new RobotsPolicyLoader({
      fetchRobots: async () => {
        throw new Error('network down');
      },
    });

    const policy = await loader.policyFor('https://example.com/api/jobs');

    // «unconfirmed» — не «allowed» и не «disallowed»: расписание такую площадку
    // не блокирует, но и правом её не наделяет.
    expect(policy.verdict).toBe('unconfirmed');
  });

  it('адрес без схемы http площадку не блокирует и запроса не делает', async () => {
    let calls = 0;
    const loader = new RobotsPolicyLoader({
      fetchRobots: async () => {
        calls += 1;
        return { status: 200, body: '' };
      },
    });

    const policy = await loader.policyFor('not a url');

    expect(policy.verdict).toBe('unconfirmed');
    expect(calls).toBe(0);
  });
});

describe('правило читается под нужный путь', () => {
  it('«Disallow: /embed/» не запрещает ленту досок Greenhouse', async () => {
    const loader = new RobotsPolicyLoader({
      fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nDisallow: /embed/\n' }),
    });

    const feed = await loader.policyFor('https://boards-api.greenhouse.io/v1/boards/x/jobs');
    const embed = await loader.policyFor('https://boards-api.greenhouse.io/embed/job_board');

    expect(feed.verdict).toBe('allowed');
    expect(embed.verdict).toBe('disallowed');
  });
});
