import { describe, expect, it } from 'vitest';
import { parseRssJobFeed } from './rssFeedParser';

describe('RSS / XML Job Feed Parser', () => {
  const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TechCorp Careers</title>
    <link>https://techcorp.com/careers</link>
    <description>Open positions at TechCorp</description>
    <item>
      <title>Staff Software Engineer (Node.js &amp; TypeScript)</title>
      <link>https://techcorp.com/careers/staff-se-101</link>
      <guid>https://techcorp.com/careers/staff-se-101</guid>
      <pubDate>Mon, 17 Aug 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[We are seeking a Staff Software Engineer to lead backend architecture. Requirements: Node.js, TypeScript, PostgreSQL, Redis. Remote friendly.]]></description>
    </item>
  </channel>
</rss>`;

  it('parses an RSS career feed into structured UnifiedVacancy items', () => {
    const vacancies = parseRssJobFeed(sampleRssXml, {
      sourceId: 'techcorp-careers',
      sourceUrl: 'https://techcorp.com/careers/rss.xml',
      companyName: 'TechCorp',
      observedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(vacancies).toHaveLength(1);
    const job = vacancies[0];
    expect(job.title).toBe('Staff Software Engineer (Node.js & TypeScript)');
    expect(job.company).toBe('TechCorp');
    expect(job.url).toBe('https://techcorp.com/careers/staff-se-101');
    expect(job.requiredSkills).toContain('Node.js');
    expect(job.requiredSkills).toContain('TypeScript');
    expect(job.requiredSkills).toContain('PostgreSQL');
    expect(job.isRemote).toBe(true);
    expect(job.provenance.sourceType).toBe('rss');
  });
});

describe('what the candidate actually reads (B164)', () => {
  const meta = {
    sourceId: 'src-himalayas',
    sourceUrl: 'https://himalayas.app/jobs/rss',
    observedAt: '2026-08-30T12:00:00.000Z',
  };

  const feed = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Senior Technical Support Engineer]]></title>
      <link>https://himalayas.app/jobs/one</link>
      <guid>https://himalayas.app/jobs/one</guid>
      <pubDate>Sat, 30 Aug 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[Remote&nbsp;role at Acme&nbsp;&amp;&nbsp;Co &#8212; TypeScript &#x26; React]]></description>
    </item>
  </channel></rss>`;

  it('shows a title without the feed’s own CDATA wrapper', () => {
    const [vacancy] = parseRssJobFeed(feed, meta);
    expect(vacancy.title).toBe('Senior Technical Support Engineer');
  });

  it('decodes the entities a feed escapes instead of printing them raw', () => {
    const [vacancy] = parseRssJobFeed(feed, meta);
    expect(vacancy.description).toBe(
      'Remote role at Acme & Co — TypeScript & React',
    );
    expect(vacancy.description).not.toContain('&nbsp;');
    expect(vacancy.description).not.toContain('&#');
  });
});

describe('feeds that escape a whole HTML body (B164)', () => {
  it('reads the escaped markup to its end instead of stopping one level short', () => {
    const [vacancy] = parseRssJobFeed(
      `<rss><channel><item>
        <title>Role</title>
        <link>https://example.test/1</link>
        <guid>https://example.test/1</guid>
        <description>&lt;p&gt;Remote&amp;nbsp;role at Acme&lt;/p&gt;</description>
      </item></channel></rss>`,
      {
        sourceId: 'src-test',
        sourceUrl: 'https://example.test/rss',
        observedAt: '2026-08-30T12:00:00.000Z',
      },
    );
    // We Work Remotely publishes exactly this shape: HTML escaped once, so its
    // own `&nbsp;` arrives as `&amp;nbsp;`. Decoding only the XML layer left
    // `<p>` and `&nbsp;` in the card (B164 prod walk).
    expect(vacancy.description).toBe('Remote role at Acme');
  });
});

/**
 * Агрегатор — не работодатель. До этого разбора каждая запись ленты получала
 * имя самой площадки («Himalayas», «NoDesk»), а лента без имени — выдуманное
 * «Tech Company». Кандидат читал название агрегатора там, где должен стоять
 * работодатель, и не мог отличить одно от другого.
 *
 * Формы взяты из живых лент 2026-09-06, а не придуманы.
 */
describe('работодатель берётся из записи, а не из имени площадки', () => {
  function feed(item: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:himalayasJobs="https://himalayas.app/rss">
  <channel><title>Aggregator</title>${item}</channel>
</rss>`;
  }

  const description = '<![CDATA[Remote position. Requirements: TypeScript, PostgreSQL.]]>';

  it('читает собственный тег ленты с именем компании (Himalayas)', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title><![CDATA[Senior SAP PSM Consultant (m/f/d)]]></title>
        <link>https://himalayas.app/companies/nagarro/jobs/senior-sap-psm-consultant</link>
        <description>${description}</description>
        <himalayasJobs:companyName><![CDATA[Nagarro]]></himalayasJobs:companyName>
      </item>`),
      { sourceId: 'src-himalayas', sourceUrl: 'https://himalayas.app/jobs/rss', observedAt: '2026-09-06T00:00:00.000Z' },
    );
    expect(job.company).toBe('Nagarro');
    expect(job.title).toBe('Senior SAP PSM Consultant (m/f/d)');
  });

  it('читает автора записи как работодателя (Хабр Карьера)', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title>Требуется «Senior Golang Developer»</title>
        <link>https://career.habr.com/vacancies/1000167185</link>
        <description>${description}</description>
        <author>Raft Digital Solutions</author>
      </item>`),
      { sourceId: 'src-habr-career', sourceUrl: 'https://career.habr.com/vacancies/rss', observedAt: '2026-09-06T00:00:00.000Z' },
    );
    expect(job.company).toBe('Raft Digital Solutions');
  });

  it('разбирает объявленную форму «Компания: должность» (We Work Remotely)', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title>Reddit: Director, Privacy Legal</title>
        <link>https://weworkremotely.com/remote-jobs/reddit-director</link>
        <description>${description}</description>
      </item>`),
      {
        sourceId: 'src-weworkremotely',
        sourceUrl: 'https://weworkremotely.com/remote-jobs.rss',
        observedAt: '2026-09-06T00:00:00.000Z',
        employerShape: 'title-colon-prefix',
      },
    );
    expect(job.company).toBe('Reddit');
    expect(job.title).toBe('Director, Privacy Legal');
  });

  it('разбирает объявленную форму «должность at Компания» (NoDesk)', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title>Staff Systems Engineer, IT at GitLab</title>
        <link>https://nodesk.co/remote-jobs/staff-systems-engineer-it-gitlab</link>
        <description>${description}</description>
      </item>`),
      {
        sourceId: 'src-nodesk',
        sourceUrl: 'https://nodesk.co/remote-jobs/index.xml',
        observedAt: '2026-09-06T00:00:00.000Z',
        employerShape: 'title-at-suffix',
      },
    );
    expect(job.company).toBe('GitLab');
    expect(job.title).toBe('Staff Systems Engineer, IT');
  });

  it('оставляет работодателя пустым, когда запись его не назвала', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title>Backend Engineer</title>
        <link>https://example.com/jobs/1</link>
        <description>${description}</description>
      </item>`),
      { sourceId: 'src-any', sourceUrl: 'https://example.com/rss', observedAt: '2026-09-06T00:00:00.000Z' },
    );
    expect(job.company).toBe('');
  });

  it('не режет должность по форме, которую площадка не объявляла', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title>Data Analyst at Scale</title>
        <link>https://example.com/jobs/2</link>
        <description>${description}</description>
      </item>`),
      { sourceId: 'src-any', sourceUrl: 'https://example.com/rss', observedAt: '2026-09-06T00:00:00.000Z' },
    );
    expect(job.title).toBe('Data Analyst at Scale');
    expect(job.company).toBe('');
  });

  it('не принимает адрес почты за имя работодателя', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title>Backend Engineer</title>
        <link>https://example.com/jobs/3</link>
        <description>${description}</description>
        <author>jobs@example.com</author>
      </item>`),
      { sourceId: 'src-any', sourceUrl: 'https://example.com/rss', observedAt: '2026-09-06T00:00:00.000Z' },
    );
    expect(job.company).toBe('');
  });

  it('читает простой тег company без пространства имён', () => {
    const [job] = parseRssJobFeed(
      feed(`<item>
        <title>Backend Engineer</title>
        <link>https://example.com/jobs/4</link>
        <description>${description}</description>
        <company>Acme</company>
      </item>`),
      { sourceId: 'src-any', sourceUrl: 'https://example.com/rss', observedAt: '2026-09-06T00:00:00.000Z' },
    );
    expect(job.company).toBe('Acme');
  });

  it('оставляет заголовок целым, когда объявленная форма в нём не встретилась', () => {
    const [colon] = parseRssJobFeed(
      feed(`<item>
        <title>Director of Privacy Legal</title>
        <link>https://example.com/jobs/5</link>
        <description>${description}</description>
      </item>`),
      {
        sourceId: 'src-weworkremotely',
        sourceUrl: 'https://example.com/rss',
        observedAt: '2026-09-06T00:00:00.000Z',
        employerShape: 'title-colon-prefix',
      },
    );
    expect(colon.title).toBe('Director of Privacy Legal');
    expect(colon.company).toBe('');

    const [suffix] = parseRssJobFeed(
      feed(`<item>
        <title>Staff Systems Engineer</title>
        <link>https://example.com/jobs/6</link>
        <description>${description}</description>
      </item>`),
      {
        sourceId: 'src-nodesk',
        sourceUrl: 'https://example.com/rss',
        observedAt: '2026-09-06T00:00:00.000Z',
        employerShape: 'title-at-suffix',
      },
    );
    expect(suffix.title).toBe('Staff Systems Engineer');
    expect(suffix.company).toBe('');
  });
});
