import { beforeEach, describe, expect, it } from 'vitest';
import { createFeedClient, resetFeedHostBackoff } from './feedClient';
import { atsBoardFeed, atsFeedId, jobviteHtmlPosting, ORACLE_DETAIL } from './atsFamilies';
import { resetSitemapCache } from './sitemapJsonLdFeed';

const ctx = { observedAt: '2026-11-10T00:00:00.000Z', sourceName: 'x' };

function site(files: Record<string, string>, calls: string[] = []) {
  return createFeedClient({
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const body = files[url];
      return body === undefined ? new Response('', { status: 404 }) : new Response(body);
    }) as typeof fetch,
    sleep: async () => {},
  });
}

const ld = (title: string) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting',
    title,
    hiringOrganization: { name: 'Staffing Agency' },
    datePosted: '2026-11-01',
  })}</script>`;

beforeEach(() => {
  resetSitemapCache();
  resetFeedHostBackoff();
});

describe('iCIMS', () => {
  it('reads the in_iframe fragment and keeps the board as employer', async () => {
    const calls: string[] = [];
    const entry = { provider: 'icims' as const, board: '360care', company: '360 Care', jobs: 1 };
    const client = site(
      {
        'https://careers-360care.icims.com/sitemap.xml':
          '<urlset><url><loc>https://careers-360care.icims.com/jobs/1234/nurse/job</loc></url><url><loc>https://careers-360care.icims.com/jobs/search</loc></url></urlset>',
        'https://careers-360care.icims.com/jobs/1234/nurse/job?in_iframe=1': ld('Nurse'),
      },
      calls,
    );
    const reading = await atsBoardFeed(entry).list(client, ctx, `src-fh-${atsFeedId(entry)}`);
    expect(reading.vacancies.map((v) => [v.title, v.company])).toEqual([['Nurse', '360 Care']]);
    expect(atsFeedId(entry)).toBe('icims-360care');
  });
});

describe('Jobvite', () => {
  const page = `<h2 class="jv-header">
      Commercial Account Manager
    </h2><p class="jv-job-detail-meta">Sales<span class='jv-inline-separator'></span>
      Tokyo,
      Japan
      <span class='jv-inline-separator'></span>Req.Num.: 32825</p>
    <div class="jv-job-detail-description"><p>Sell Nutanix</p></div><div class="jv-job-detail-bottom-actions">`;

  it('falls back to the board markup when a page has no JobPosting', () => {
    expect(jobviteHtmlPosting(page)).toMatchObject({
      title: 'Commercial Account Manager',
      location: 'Tokyo, Japan',
    });
    expect(jobviteHtmlPosting('<html></html>')).toBeUndefined();
  });

  it('lists vacancies from the /jobs page links', async () => {
    const entry = { provider: 'jobvite' as const, board: 'nutanix', company: 'Nutanix', jobs: 1 };
    const client = site({
      'https://jobs.jobvite.com/nutanix/jobs':
        '<a href="/nutanix/job/o79VAfwv">A</a><a href="/nutanix/job/o79VAfwv/apply">Apply</a><a href="https://evil.example/nutanix/job/x1">x</a>',
      'https://jobs.jobvite.com/nutanix/job/o79VAfwv': page,
    });
    const reading = await atsBoardFeed(entry).list(client, ctx, 'src-fh-jobvite-nutanix');
    expect(reading.vacancies).toHaveLength(1);
    expect(reading.vacancies[0]).toMatchObject({ company: 'Nutanix', location: 'Tokyo, Japan' });
  });
});

describe('Oracle Recruiting Cloud', () => {
  const host = 'acme.fa.ocs.oraclecloud.com';
  it('pages by received rows with offset inside the finder', async () => {
    const calls: string[] = [];
    const client = createFeedClient({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        const offset = Number(url.match(/offset=(\d+)/)?.[1]);
        const list =
          offset === 0
            ? [
                { Id: '1', Title: 'A' },
                { Id: '2', Title: 'B' },
              ]
            : [{ Id: '3', Title: 'C' }];
        return new Response(
          JSON.stringify({ items: [{ TotalJobsCount: 3, requisitionList: list }] }),
        );
      }) as typeof fetch,
      sleep: async () => {},
    });
    const entry = { provider: 'oracle' as const, board: `${host}/CX_1`, company: 'Acme', jobs: 3 };
    const reading = await atsBoardFeed(entry).list(client, ctx, `src-fh-${atsFeedId(entry)}`);
    expect(reading.vacancies.map((v) => v.title)).toEqual(['A', 'B', 'C']);
    expect(calls[1]).toContain('finder=findReqs;siteNumber=CX_1,limit=100,offset=2');
    expect(reading.vacancies[0]?.url).toBe(
      `https://${host}/hcmUI/CandidateExperience/en/sites/CX_1/job/1`,
    );
  });

  it('maps the public link to the requisition detail and reads its text', () => {
    const url = `https://${host}/hcmUI/CandidateExperience/en/sites/CX_1/job/42`;
    expect(ORACLE_DETAIL.detailUrl('src-fh-oracle-x', { url })).toBe(
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%2242%22,siteNumber=CX_1`,
    );
    expect(
      ORACLE_DETAIL.detailUrl('src-fh-oracle-x', { url: 'https://evil.example/x' }),
    ).toBeUndefined();
    expect(
      ORACLE_DETAIL.readText({
        items: [{ ExternalDescriptionStr: '<p>Build</p>', ExternalQualificationsStr: 'Go' }],
      }),
    ).toBe('Build\n\nGo');
  });
});

describe('B641 rollout and paid-model gate', () => {
  it('admits 300 ATS boards per day from the start date', async () => {
    const { admittedAtsBoards, ATS_ROLLOUT_START_MS } = await import('./freehireFeeds');
    expect(admittedAtsBoards(ATS_ROLLOUT_START_MS - 1)).toBe(0);
    expect(admittedAtsBoards(ATS_ROLLOUT_START_MS + 3_600_000)).toBe(300);
    expect(admittedAtsBoards(ATS_ROLLOUT_START_MS + 2 * 86_400_000)).toBe(900);
  });

  it('keeps ATS vacancies out of bulk model queues by id and by card url', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { notExcludedSourceUrlSql, notExcludedVacancyIdSql } =
      await import('./paidProcessingGate');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT, url TEXT)');
    const rows: [string, string][] = [
      ['src-fh-sber:1', 'https://rabota.sber.ru/x'],
      ['src-fh-icims-360care:2', 'https://careers-360care.icims.com/jobs/2/a/job'],
      ['src-fh-jobvite-hoar:3', 'https://jobs.jobvite.com/hoar/job/o1'],
      ['src-fh-oracle-x:4', 'https://eihu.fa.us8.oraclecloud.com/hcmUI/x'],
    ];
    for (const [id, url] of rows) db.prepare('INSERT INTO t VALUES (?, ?)').run(id, url);
    const pick = (where: string) =>
      db
        .prepare(`SELECT id FROM t WHERE ${where}`)
        .all()
        .map((r) => r.id);
    expect(pick(notExcludedVacancyIdSql('id'))).toEqual(['src-fh-sber:1']);
    expect(pick(notExcludedSourceUrlSql('url'))).toEqual(['src-fh-sber:1']);
  });
});

describe('B641 Oracle per-poll cap and fuse', () => {
  it('reads at most ORACLE_ROWS_PER_POLL rows per poll, then a full slice', async () => {
    const { resetOracleCursors, ORACLE_ROWS_PER_POLL } = await import('./atsFamilies');
    resetOracleCursors();
    const total = ORACLE_ROWS_PER_POLL + 100;
    const client = createFeedClient({
      fetchImpl: (async (input: string | URL | Request) => {
        const offset = Number(String(input).match(/offset=(\d+)/)?.[1]);
        const n = Math.min(100, total - offset);
        const list = Array.from({ length: n }, (_, i) => ({ Id: String(offset + i), Title: 'T' }));
        return new Response(
          JSON.stringify({ items: [{ TotalJobsCount: total, requisitionList: list }] }),
        );
      }) as typeof fetch,
      sleep: async () => {},
    });
    const entry = {
      provider: 'oracle' as const,
      board: 'big.fa.ocs.oraclecloud.com/CX',
      company: 'Big',
      jobs: total,
    };
    const first = await atsBoardFeed(entry).list(client, ctx, 'src-fh-oracle-big');
    expect([first.vacancies.length, first.partial]).toEqual([ORACLE_ROWS_PER_POLL, true]);
    const second = await atsBoardFeed(entry).list(client, ctx, 'src-fh-oracle-big');
    expect([second.vacancies.length, second.partial]).toEqual([total, false]);
  });

  it('trips on ATS vacancies over 1.5x the pool and on stalls after an hour', async () => {
    const fuse = await import('./atsFuse');
    fuse.resetAtsFuse(0);
    fuse.recordAtsReading('src-fh-icims-a', 100, false);
    expect(fuse.atsFuseTripped(1)).toBeUndefined();
    fuse.recordAtsReading('src-fh-oracle-b', fuse.POOL_BASELINE_VACANCIES / 2, true);
    expect(fuse.atsFuseTripped(2)).toContain('ATS');
    fuse.resetAtsFuse(0);
    const hour = 3_600_000;
    const heavy = fuse.STALL_BASELINE_SECONDS_PER_HOUR * fuse.FUSE_RATIO * 1000 + 1;
    fuse.recordEventLoopStall(heavy, hour - 10);
    expect(fuse.atsFuseTripped(hour - 5)).toBeUndefined();
    expect(fuse.atsFuseTripped(hour)).toContain('стоянки');
  });
});
