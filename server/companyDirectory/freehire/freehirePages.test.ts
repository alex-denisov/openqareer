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
import { employerJobSite, readPagesState, runPagesTick } from './freehirePagesSchedule';

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

  it('imports a page, writes LinkedIn and placements, and resumes from its position', async () => {
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
    const first = await runPagesTick(db, client, async () => 3, pass);
    expect(first.read).toBe(2);
    const row = db
      .prepare("SELECT * FROM company_directory WHERE company_key = 'amazon'")
      .get() as Record<string, string>;
    expect(row.website_url).toBe('https://aboutamazon.com/');
    expect(row.linkedin_url).toBe('https://www.linkedin.com/company/amazon');
    expect(JSON.parse(row.evidence).profiles.value.twitter).toBe('https://twitter.com/amazon');
    const placements = db
      .prepare('SELECT placement_id FROM company_placement ORDER BY 1')
      .all()
      .map((r) => (r as { placement_id: string }).placement_id);
    expect(placements).toEqual([
      'ats:lever:amazon-leo',
      'site:aboutamazon.com',
      'site:amazon.jobs',
    ]);
    expect(row.careers_url).toBe('https://www.amazon.jobs/');
    expect(readPagesState(db)).toMatchObject({
      shard: 0,
      index: 2,
      read: 2,
      added: 1,
      linkedin: 1,
      skipped: 1,
    });
    // shard exhausted → next shard; empty shard → done
    expect((await runPagesTick(db, client, async () => 3, pass)).state.shard).toBe(10_000);
    expect((await runPagesTick(db, client, async () => 3, pass)).state.done).toBeTruthy();
  });
});
