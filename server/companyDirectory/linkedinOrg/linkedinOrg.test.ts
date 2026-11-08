import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import {
  companySlugsInHtml,
  detectBlock,
  parseJobViewCompany,
  parseSearchCards,
  slugFromLinkedinUrl,
} from './linkedinGuestPages';
import {
  registrableDomain,
  resolveCompany,
  siteUrls,
  type FetchPage,
  type PageResponse,
} from './linkedinOrgResolver';
import { cooldownMs, LinkedinOrgRunner } from './linkedinOrgRunner';
import { LinkedinOrgStore, type QueueRow } from './linkedinOrgStore';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const SITE = fixture('site-ciklum.html');
const SEARCH = fixture('search-ciklum.html');
const VIEW = fixture('jobview-ciklum.html');
const CLOUDFLARE = fixture('cloudflare-block.html');
const RECAPTCHA = fixture('recaptcha.html');
const NOW = new Date('2026-11-08T12:00:00Z');

const ok = (body: string, finalUrl = 'https://x'): PageResponse => ({
  status: 200,
  body,
  finalUrl,
});

function routes(map: Record<string, PageResponse | Error>): FetchPage & { calls: string[] } {
  const calls: string[] = [];
  const fetchPage = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(map).find((k) => url.includes(k));
    const hit = key ? map[key]! : ok('<html></html>');
    if (hit instanceof Error) throw hit;
    return hit;
  }) as FetchPage & { calls: string[] };
  fetchPage.calls = calls;
  return fetchPage;
}

const CIKLUM: QueueRow = {
  companyKey: 'ciklum',
  companyName: 'Ciklum',
  websiteUrl: 'https://www.ciklum.com/',
  careersUrl: null,
  linkedinUrl: null,
};

const happy = () =>
  routes({
    'ciklum.com': ok(SITE, 'https://www.ciklum.com/'),
    seeMoreJobPostings: ok(SEARCH),
    '/jobs/view/4484448310': ok(VIEW),
  });

describe('guest page parsers (real responses)', () => {
  it('reads company slugs linked from the official site, ignoring showcase pages', () => {
    expect(companySlugsInHtml(SITE)).toEqual(['ciklum']);
  });
  it('reads JSON-escaped links without a trailing backslash', () => {
    expect(
      companySlugsInHtml('{"url":"https:\\/\\/www.linkedin.com\\/company\\/auroradriver\\/"}'),
    ).toEqual(['auroradriver']);
  });
  it('reads job id and employer slug from guest search cards', () => {
    const cards = parseSearchCards(SEARCH);
    expect(cards).toContainEqual({ jobId: '4484448310', companySlug: 'ciklum' });
    expect(cards.filter((c) => c.companySlug === 'ciklumczsk').length).toBeGreaterThan(3);
  });
  it('reads companyId and the same employer slug from a guest job view', () => {
    expect(parseJobViewCompany(VIEW)).toEqual({ companyId: '9183', companySlug: 'ciklum' });
  });
  it('detects rate limits and browser checks', () => {
    expect(detectBlock(429, '')).toBe('rate_limited');
    expect(detectBlock(999, '')).toBe('rate_limited');
    expect(detectBlock(403, CLOUDFLARE)).toBe('challenge');
    expect(detectBlock(200, RECAPTCHA)).toBe('challenge');
    expect(detectBlock(200, SEARCH)).toBeNull();
  });
  it('normalizes registry urls', () => {
    expect(slugFromLinkedinUrl('https://www.linkedin.com/company/Uzum-UZ/jobs/')).toBe('uzum-uz');
    expect(slugFromLinkedinUrl(null)).toBeNull();
  });
});

describe('resolveCompany', () => {
  it('resolves the id only through the domain-linked slug', async () => {
    const outcome = await resolveCompany(CIKLUM, happy(), NOW);
    expect(outcome).toMatchObject({ status: 'resolved', slug: 'ciklum', orgId: '9183' });
  });

  it('never takes an id from a name match: a sibling page with the same name is ignored', async () => {
    const view = VIEW.replace(/company\/ciklum\?/g, 'company/ciklumczsk?');
    const outcome = await resolveCompany(
      CIKLUM,
      routes({ 'ciklum.com': ok(SITE), seeMoreJobPostings: ok(SEARCH), '/jobs/view/': ok(view) }),
      NOW,
    );
    expect(outcome.status).toBe('ambiguous');
    expect(outcome.reason).toBe('no_open_jobs');
    expect(outcome.orgId).toBeUndefined();
  });

  it('records no_page when the official site links no LinkedIn company', async () => {
    const row = { ...CIKLUM, companyKey: 'ru-co', websiteUrl: 'https://example.ru/' };
    const outcome = await resolveCompany(
      row,
      routes({ 'example.ru': ok('<a href="https://vk.com/x">') }),
      NOW,
    );
    expect(outcome).toMatchObject({ status: 'no_page', reason: 'no_linkedin_link_on_site' });
  });

  it('keeps a registry url that the site does not confirm as ambiguous', async () => {
    const row = { ...CIKLUM, linkedinUrl: 'https://www.linkedin.com/company/ciklum/jobs/' };
    const outcome = await resolveCompany(row, routes({ 'ciklum.com': ok('<html></html>') }), NOW);
    expect(outcome).toMatchObject({ status: 'ambiguous', reason: 'registry_url_not_on_site' });
  });

  it('corrects a registry url that disagrees with the domain-linked page', async () => {
    const row = { ...CIKLUM, linkedinUrl: 'https://www.linkedin.com/company/ciklum-it-services/' };
    const outcome = await resolveCompany(row, happy(), NOW);
    expect(outcome).toMatchObject({
      status: 'resolved',
      reason: 'registry_url_corrected:ciklum-it-services',
      orgId: '9183',
      replaceUrl: true,
    });
  });

  it('does not take the LinkedIn page of a shared ATS host as company evidence', async () => {
    const row = {
      ...CIKLUM,
      websiteUrl: 'https://jobs.lever.co',
      careersUrl: 'https://jobs.lever.co/ciklum',
    };
    const fetchPage = routes({
      'lever.co': ok('<a href="https://www.linkedin.com/company/lever/">'),
    });
    const outcome = await resolveCompany(row, fetchPage, NOW);
    expect(outcome).toMatchObject({ status: 'no_page', reason: 'no_official_site' });
    expect(fetchPage.calls).toEqual([]);
  });

  it('reads careers pages only on the company domain', () => {
    expect(siteUrls({ ...CIKLUM, careersUrl: 'https://jobs.ciklum.com/open' })).toEqual([
      'https://www.ciklum.com/',
      'https://jobs.ciklum.com/open',
    ]);
    expect(siteUrls({ ...CIKLUM, careersUrl: 'https://boards.greenhouse.io/ciklum' })).toEqual([
      'https://www.ciklum.com/',
    ]);
    expect(registrableDomain('https://careers.example.co.uk/x')).toBe('example.co.uk');
  });

  it('retries later when the official site is unreachable', async () => {
    const outcome = await resolveCompany(
      CIKLUM,
      routes({ 'ciklum.com': new Error('ECONNRESET') }),
      NOW,
    );
    expect(outcome.status).toBe('retry_after');
    expect(outcome.retryAt).toBe('2026-11-11T12:00:00.000Z');
  });

  it('takes a numeric company link from the site as the id without LinkedIn calls', async () => {
    const fetchPage = routes({
      'ciklum.com': ok('<a href="https://www.linkedin.com/company/9183/">'),
    });
    const outcome = await resolveCompany(CIKLUM, fetchPage, NOW);
    expect(outcome).toMatchObject({ status: 'resolved', orgId: '9183' });
    expect(fetchPage.calls.some((u) => u.includes('linkedin.com'))).toBe(false);
  });
});

function seededDb(rows: readonly { key: string; orgId?: string; site?: string }[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  for (const r of rows) {
    db.prepare(
      `INSERT INTO company_directory (company_key, company_name, website_url, linkedin_org_id, source_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'linkedin_guest', 'x', 'x')`,
    ).run(
      r.key,
      r.key === 'ciklum' ? 'Ciklum' : r.key,
      r.site ?? 'https://www.ciklum.com/',
      r.orgId ?? null,
    );
  }
  return db;
}

const silentLog = { info: () => undefined, warn: () => undefined };

describe('LinkedinOrgRunner', () => {
  it('writes the id and url once and leaves rows that already have an id untouched', async () => {
    const db = seededDb([{ key: 'ciklum' }, { key: 'has-id', orgId: '777' }]);
    const store = new LinkedinOrgStore(db);
    const runner = new LinkedinOrgRunner({
      store,
      fetchPage: happy(),
      log: silentLog,
      minGapMs: 0,
      now: () => NOW,
    });
    const first = await runner.step();
    expect(first).toMatchObject({ kind: 'done', companyKey: 'ciklum' });
    expect(await runner.step()).toEqual({ kind: 'idle' });
    const rows = db
      .prepare(
        'SELECT company_key, linkedin_org_id, linkedin_url FROM company_directory ORDER BY 1',
      )
      .all();
    expect(rows).toEqual([
      {
        company_key: 'ciklum',
        linkedin_org_id: '9183',
        linkedin_url: 'https://www.linkedin.com/company/ciklum/jobs/',
      },
      { company_key: 'has-id', linkedin_org_id: '777', linkedin_url: null },
    ]);
    expect(store.counts()).toEqual({ resolved: 1 });
  });

  it('replaces a wrong registry url only together with a domain-verified id', () => {
    const db = seededDb([{ key: 'ciklum' }]);
    db.prepare(
      "UPDATE company_directory SET linkedin_url = 'https://www.linkedin.com/company/wrong/'",
    ).run();
    const store = new LinkedinOrgStore(db);
    store.record('ciklum', { status: 'ambiguous', reason: 'no_open_jobs', slug: 'ciklum' }, NOW);
    expect(db.prepare('SELECT linkedin_url FROM company_directory').get()).toEqual({
      linkedin_url: 'https://www.linkedin.com/company/wrong/',
    });
    store.record(
      'ciklum',
      { status: 'resolved', reason: 'x', slug: 'ciklum', orgId: '9183', replaceUrl: true },
      NOW,
    );
    expect(db.prepare('SELECT linkedin_url, linkedin_org_id FROM company_directory').get()).toEqual(
      {
        linkedin_url: 'https://www.linkedin.com/company/ciklum/jobs/',
        linkedin_org_id: '9183',
      },
    );
  });

  it('pauses on 429, keeps the row queued, backs off and resumes after the pause', async () => {
    const db = seededDb([{ key: 'ciklum' }]);
    const store = new LinkedinOrgStore(db);
    let clock = NOW.getTime();
    let limited = true;
    const fetchPage: FetchPage = async (url, kind) => {
      if (kind === 'linkedin' && limited) return { status: 429, body: '', finalUrl: url };
      return happy()(url, kind);
    };
    const runner = new LinkedinOrgRunner({
      store,
      fetchPage,
      log: silentLog,
      minGapMs: 0,
      now: () => new Date(clock),
    });
    const paused = await runner.step();
    expect(paused).toEqual({ kind: 'cooldown', until: new Date(clock + 10 * 60_000) });
    expect(store.counts()).toEqual({ retry_after: 1 });
    clock += 5 * 60_000;
    expect((await runner.step()).kind).toBe('cooldown');
    clock += 6 * 60_000;
    const second = await runner.step();
    expect(second).toEqual({ kind: 'cooldown', until: new Date(clock + 20 * 60_000) });
    clock += 21 * 60_000;
    limited = false;
    expect(await runner.step()).toMatchObject({ kind: 'done', outcome: { status: 'resolved' } });
    expect(store.cooldownUntil()?.strikes).toBe(2);
    db.prepare('UPDATE company_directory SET linkedin_org_id = NULL').run();
    db.prepare("DELETE FROM company_linkedin_resolution WHERE company_key = 'ciklum'").run();
    clock += 61 * 60_000;
    expect(await runner.step()).toMatchObject({ kind: 'done' });
    expect(store.cooldownUntil()?.strikes).toBe(0);
  });

  it('spaces LinkedIn requests by the minimum gap and leaves site requests unpaced', async () => {
    const db = seededDb([{ key: 'ciklum' }]);
    const sleeps: number[] = [];
    let clock = NOW.getTime();
    const runner = new LinkedinOrgRunner({
      store: new LinkedinOrgStore(db),
      fetchPage: happy(),
      log: silentLog,
      minGapMs: 20_000,
      now: () => new Date(clock),
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await runner.step();
    expect(sleeps).toEqual([20_000]);
  });

  it('caps the backoff at six hours', () => {
    expect(cooldownMs(1)).toBe(600_000);
    expect(cooldownMs(3)).toBe(2_400_000);
    expect(cooldownMs(20)).toBe(21_600_000);
  });

  it('picks up new registry rows automatically and rechecks no_page rows after 30 days', async () => {
    const db = seededDb([{ key: 'ru-co', site: 'https://example.ru/' }]);
    const store = new LinkedinOrgStore(db);
    let clock = NOW.getTime();
    const runner = new LinkedinOrgRunner({
      store,
      fetchPage: routes({}),
      log: silentLog,
      minGapMs: 0,
      now: () => new Date(clock),
    });
    expect(await runner.step()).toMatchObject({ outcome: { status: 'no_page' } });
    expect(await runner.step()).toEqual({ kind: 'idle' });
    db.prepare(
      `INSERT INTO company_directory (company_key, company_name, website_url, source_type, created_at, updated_at)
       VALUES ('ciklum', 'Ciklum', 'https://www.ciklum.com/', 'linkedin_guest', 'x', 'x')`,
    ).run();
    clock += 60_000;
    expect(await runner.step()).toMatchObject({ companyKey: 'ciklum' });
    clock += 31 * 86_400_000;
    expect(await runner.step()).toMatchObject({ companyKey: 'ru-co' });
  });
});
