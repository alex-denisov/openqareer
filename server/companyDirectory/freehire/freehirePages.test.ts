import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import {
  cardOfPageData,
  companyLinkedin,
  slugsOfSitemap,
  withoutFreehireTracking,
} from './freehirePages';
import { FreehirePagesClient } from './freehirePagesClient';
import {
  employerJobSite,
  readPagesState,
  runPagesTick,
} from './freehirePagesSchedule';

// Shape of a real `/companies/amazon/__data.json` (11.11), trimmed.
const AMAZON = {
  type: 'data',
  nodes: [
    { type: 'data', data: [{ user: 1 }, null] },
    {
      type: 'data',
      data: [
        { company: 1, initial: 9, slug: 2 },
        { slug: 2, name: 3, company_info: 4 },
        'amazon',
        'Amazon',
        { website: 5, linkedin: 6, twitter: 7, ceo: 8 },
        'aboutamazon.com',
        'https://www.linkedin.com/company/amazon',
        'https://twitter.com/amazon',
        'Andy Jassy',
        { items: 10 },
        [11, 14],
        { source: 12, url: 13 },
        'amazon',
        'https://www.amazon.jobs/en/jobs/10601723/sr-sde?utm_source=freehire.me',
        { source: 12, url: 15 },
        'https://jobs.lever.co/amazon-leo/abc?utm_source=freehire.me&lang=en',
      ],
    },
  ],
};

describe('B645 freehire pages', () => {
  it('reads company slugs from a sitemap shard', () => {
    const xml =
      '<urlset><url><loc>https://freehire.me/companies/amazon</loc></url><url><loc>https://freehire.me/jobs/x</loc></url><url><loc>https://freehire.me/companies/0011-miele</loc></url></urlset>';
    expect(slugsOfSitemap(xml)).toEqual(['amazon', '0011-miele']);
  });

  it('decodes the SvelteKit page data into a card without freehire tracking', () => {
    const card = cardOfPageData('amazon', AMAZON)!;
    expect(card.name).toBe('Amazon');
    expect(card.website).toBe('aboutamazon.com');
    expect(card.linkedin).toBe('https://www.linkedin.com/company/amazon');
    expect(card.profiles).toEqual({ twitter: 'https://twitter.com/amazon' });
    expect(card.jobs.map((j) => j.url)).toEqual([
      'https://www.amazon.jobs/en/jobs/10601723/sr-sde',
      'https://jobs.lever.co/amazon-leo/abc?lang=en',
    ]);
    expect(cardOfPageData('x', { nodes: [{ data: [{ user: 1 }] }] })).toBeNull();
  });

  it('keeps only LinkedIn company pages', () => {
    expect(companyLinkedin('https://linkedin.com/company/Acme-Inc/about')).toBe(
      'https://www.linkedin.com/company/acme-inc',
    );
    expect(companyLinkedin('https://www.linkedin.com/in/someone')).toBeNull();
    expect(withoutFreehireTracking('not a url')).toBe('not a url');
  });

  it('takes the employer own jobs domain, not ATS or aggregators', () => {
    const card = (name: string, url: string) => ({
      slug: name.toLowerCase(),
      name,
      website: null,
      linkedin: null,
      profiles: {},
      jobs: [{ source: '', url }],
    });
    expect(employerJobSite(card('Amazon', 'https://www.amazon.jobs/en/jobs/1'))).toEqual({
      origin: 'https://www.amazon.jobs/',
      careers: 'https://www.amazon.jobs/',
    });
    expect(employerJobSite(card('Acme Inc.', 'https://acme.com/careers/12'))).toEqual({
      origin: 'https://acme.com/',
      careers: 'https://acme.com/careers',
    });
    expect(employerJobSite(card('Acme', 'https://careers.acme.com/x/1'))?.origin).toBe(
      'https://careers.acme.com/',
    );
    expect(employerJobSite(card('Acme', 'https://jobs.lever.co/acme/1'))).toBeNull();
    expect(employerJobSite(card('Acme', 'https://recruitingbypaycor.com/acme/1'))).toBeNull();
    expect(employerJobSite(card('Acme', 'https://nl.whatjobs.com/acme'))).toBeNull();
  });

  it('stages direct sources, keeps them out of the live directory, and starts the next pass', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(COMPANY_DIRECTORY_MIGRATION);
    db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
    const responses: Record<string, unknown> = {
      '/sitemap-companies.xml?offset=0':
        '<loc>https://freehire.me/companies/amazon</loc><loc>https://freehire.me/companies/gone</loc>',
      '/companies/amazon/__data.json': JSON.stringify(AMAZON),
    };
    const fetchImpl = (async (url: string) => {
      const body = responses[new URL(url).pathname + new URL(url).search];
      return {
        status: body ? 200 : 404,
        headers: new Headers(),
        text: async () => body,
      } as unknown as Response;
    }) as typeof fetch;
    const client = new FreehirePagesClient(
      fetchImpl,
      async () => {},
      () => 0,
    );
    const pass = {};
    readPagesState(db);
    const legacyDone = new Date('2026-11-13T04:49:00Z').toISOString();
    db.prepare('INSERT INTO freehire_pages_state VALUES (1, ?, ?)')
      .run(JSON.stringify({ shard: 530_000, done: legacyDone }), legacyDone);
    const first = await runPagesTick(db, client, pass, () => new Date(legacyDone));
    expect(first.read).toBe(2);
    const row = db.prepare("SELECT evidence FROM freehire_company_source_candidates WHERE slug = 'amazon'")
      .get() as { evidence: string };
    expect(JSON.parse(row.evidence)).toMatchObject({
      website: 'aboutamazon.com',
      linkedin: 'https://www.linkedin.com/company/amazon',
      careers: 'https://www.amazon.jobs/',
      employerSite: { origin: 'https://www.amazon.jobs/' },
      boards: [{ provider: 'lever', slug: 'amazon-leo' }],
    });
    expect(db.prepare('SELECT count(*) AS count FROM company_directory').get()).toMatchObject({ count: 0 });
    expect(readPagesState(db)).toMatchObject({
      shard: 0,
      index: 2,
      read: 2,
      linkedin: 1,
      skipped: 1,
    });
    // shard exhausted → next shard; empty shard → done
    expect((await runPagesTick(db, client, pass)).state.shard).toBe(10_000);
    const completedAt = new Date('2026-11-13T04:50:32Z');
    const at = (elapsed: number) => () => new Date(completedAt.getTime() + elapsed);
    const week = 7 * 24 * 60 * 60 * 1000;
    const finished = await runPagesTick(db, client, pass, at(0));
    expect(finished.state.done).toBe(completedAt.toISOString());
    expect(await runPagesTick(db, client, {}, at(week - 1))).toEqual(finished);
    const refreshed = await runPagesTick(db, client, {}, at(week));
    expect(refreshed).toMatchObject({ read: 2, state: { shard: 0, index: 2, read: 2 } });
    expect(refreshed.state.done).toBeUndefined();
  });

});
