import { describe, expect, it } from 'vitest';
import { fetchCrossover, parseCrossoverSitemap, CROSSOVER_SOURCE_ID } from './crossoverSource';

/**
 * B217 — у Crossover нет открытого списка вакансий: `profile-api` отвечает 403
 * без ключа. Открытые вакансии называет sitemap (`/jobs/<id>/<brand>/<slug>`),
 * а описание лежит в Kentico Delivery без ключа (`pipeline_code` = id). Обе
 * половины честные; ключ из бандла не берётся.
 */
const SITEMAP = `<?xml version="1.0"?><urlset>
<url><loc>https://www.crossover.com/jobs/3147/trilogy/finance-manager</loc></url>
<url><loc>https://www.crossover.com/jobs/ai-engineer</loc></url>
<url><loc>https://www.crossover.com/jobs/5630/alpha/campus-operations-specialist</loc></url>
<url><loc>https://www.crossover.com/jobs/3147/trilogy/finance-manager?utm=x</loc></url>
</urlset>`;

describe('Crossover (B217)', () => {
  it('sitemap: только адреса вакансий с числовым id, без дублей', () => {
    expect(parseCrossoverSitemap(SITEMAP)).toEqual([
      { id: '3147', brand: 'trilogy', slug: 'finance-manager', url: 'https://www.crossover.com/jobs/3147/trilogy/finance-manager' },
      { id: '5630', brand: 'alpha', slug: 'campus-operations-specialist', url: 'https://www.crossover.com/jobs/5630/alpha/campus-operations-specialist' },
    ]);
  });

  it('собирает карточку из sitemap и Kontent по pipeline_code', async () => {
    const requested: string[] = [];
    const reading = await fetchCrossover(
      { sitemapUrl: 'https://www.crossover.com/sitemap.xml', kontentUrl: 'https://kontent-proxy.crossover.com/items' },
      {
        fetchText: async (url) => {
          requested.push(url);
          return SITEMAP;
        },
        fetchJson: async (url) => {
          requested.push(url);
          if (url.includes('system.type=brand')) {
            return {
              items: [{ system: { codename: 'alpha', name: 'Alpha' }, elements: { name: { value: 'Alpha School' } } }],
              pagination: { next_page: '' },
            };
          }
          return {
            items: [
              {
                system: { name: 'Campus Operations Specialist, Alpha', last_modified: '2026-09-01T10:00:00Z', codename: 'x' },
                elements: {
                  pipeline_code: { value: '5630' },
                  hook: { value: '<p>LOCATION NOTE: in-person role at our Austin campus.</p>' },
                  responsibilities: { value: '<p>Keep the campus safe.</p>' },
                  requirements: { value: '<ul><li>Bachelor’s degree</li></ul>' },
                  work_location: { value: 'Austin, TX, United States' },
                  remote_policy: { value: [{ name: 'In-person', codename: 'in_person' }] },
                  weekly_hours: { value: 'Full-time (40 hrs/week)' },
                  functional_domain: { value: [{ name: 'Education', codename: 'education' }] },
                  brand: { value: ['alpha'] },
                },
              },
            ],
            pagination: { next_page: '' },
          };
        },
        observedAt: '2026-09-14T09:00:00.000Z',
      },
    );
    expect(requested[0]).toBe('https://www.crossover.com/sitemap.xml');
    expect(requested[1]).toContain('system.type=brand');
    expect(requested[2]).toContain('system.type=pipeline');
    expect(requested[2]).toContain('elements.pipeline_code%5Bin%5D=3147%2C5630');
    expect(reading.partial).toBe(false);
    expect(reading.vacancies).toHaveLength(1);
    expect(reading.vacancies[0]).toMatchObject({
      id: `${CROSSOVER_SOURCE_ID}:5630`,
      title: 'Campus Operations Specialist',
      company: 'Alpha School',
      location: 'Austin, TX, United States',
      isRemote: false,
      employmentType: 'Full-time (40 hrs/week)',
      url: 'https://www.crossover.com/jobs/5630/alpha/campus-operations-specialist',
    });
    expect(reading.vacancies[0]?.description).toContain('Keep the campus safe');
    expect(reading.vacancies[0]?.requiredSkills).toContain('Education');
  });

  it('пустой sitemap — отказ, а не пустой успех (B161)', async () => {
    await expect(
      fetchCrossover(
        { sitemapUrl: 'https://x/sitemap.xml', kontentUrl: 'https://x/items' },
        { fetchText: async () => '<urlset></urlset>', fetchJson: async () => ({ items: [] }), observedAt: 'now' },
      ),
    ).rejects.toThrow(/crossover_sitemap_empty/);
  });
});
