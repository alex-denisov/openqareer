import { describe, expect, it } from 'vitest';
import { parseRssJobFeed } from './rssFeedParser';
import { parseTelegramChannelHtml } from './telegramChannelParser';

/**
 * Found on the B164 production walk: the pool held one vacancy where the sync
 * had just kept 79.
 *
 * The RSS id was `rss-<source>-<first 32 characters of the escaped guid>`, and
 * `https%3A%2F%2Fweworkremotely.com%2F` is already 35 characters — so every
 * item of that feed collapsed onto one id and overwrote the previous one.
 *
 * Telegram wrote `provenance.sourceId = 'tg-<channel>'` while the registry
 * knows the source as `src-tg-<name>`, so its vacancies were counted under no
 * source at all and could never be evicted by a later sync.
 */
function feed(links: readonly string[]): string {
  const items = links
    .map(
      (link) => `
    <item>
      <title>Engineer at Example</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>Fri, 29 Aug 2026 10:00:00 GMT</pubDate>
      <description>Job description text</description>
    </item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
}

describe('source identity', () => {
  it('gives every feed item its own id even when the links share a long prefix', () => {
    const vacancies = parseRssJobFeed(
      feed([
        'https://weworkremotely.com/remote-jobs/company-one-senior-engineer',
        'https://weworkremotely.com/remote-jobs/company-two-staff-engineer',
        'https://weworkremotely.com/remote-jobs/company-three-lead-engineer',
      ]),
      {
        sourceId: 'src-weworkremotely',
        sourceUrl: 'https://weworkremotely.com/remote-jobs.rss',
        companyName: 'We Work Remotely',
        observedAt: '2026-08-30T12:00:00.000Z',
      },
    );

    expect(vacancies).toHaveLength(3);
    expect(new Set(vacancies.map((vacancy) => vacancy.id)).size).toBe(3);
  });

  it('gives the same feed item the same id on the next read', () => {
    const read = () =>
      parseRssJobFeed(feed(['https://himalayas.app/jobs/one']), {
        sourceId: 'src-himalayas',
        sourceUrl: 'https://himalayas.app/jobs/rss',
        companyName: 'Himalayas',
        observedAt: '2026-08-30T12:00:00.000Z',
      })[0]?.id;

    expect(read()).toBe(read());
  });

  it('records the registry id of the telegram source, not a name of its own', () => {
    const html = `
      <div class="tgme_widget_message" data-post="product_jobs/42">
        <div class="tgme_widget_message_text">Вакансия: Product Manager в Acme. Опыт от 3 лет.</div>
        <time datetime="2026-08-29T10:00:00+00:00"></time>
      </div>`;

    const vacancies = parseTelegramChannelHtml(html, {
      channelName: 'product_jobs',
      sourceId: 'src-tg-product',
      observedAt: '2026-08-30T12:00:00.000Z',
    });

    for (const vacancy of vacancies) {
      expect(vacancy.provenance.sourceId).toBe('src-tg-product');
    }
  });
});
