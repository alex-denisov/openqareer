import { describe, expect, it } from 'vitest';
import { fetchLinkedinGuest, linkedinGuestUrl, parseLinkedinCards, LINKEDIN_SOURCE_ID } from './linkedinGuestSource';

/**
 * B218 — LinkedIn гостевой список: HTML по 10 карточек, offset `start`.
 * Форма карточки снята с прод-VM 2026-09-14.
 */
const CARD = (id: string, title: string) => `<li>
  <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:${id}">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-${id}"><span class="sr-only">${title}</span></a>
    <h4 class="base-search-card__subtitle"><a class="hidden-nested-link">Schneider Electric</a></h4>
    <span class="job-search-card__location">Boston, MA</span>
    <time class="job-search-card__listdate" datetime="2026-09-10">1 day ago</time>
  </div></li>`;

describe('LinkedIn guest source (B218)', () => {
  it('строит адрес с offset и комбинацией веера', () => {
    const url = new URL(
      linkedinGuestUrl(20, {
        term: 'data analyst',
        target: { region: 'mena', indeedCountry: 'AE', location: 'Dubai' },
      }),
    );
    expect(url.pathname).toBe('/jobs-guest/jobs/api/seeMoreJobPostings/search');
    expect(url.searchParams.get('start')).toBe('20');
    expect(url.searchParams.get('keywords')).toBe('data analyst');
    expect(url.searchParams.get('location')).toBe('Dubai');
    // Фильтр свежести: площадка отдаёт только размещённое за неделю.
    expect(url.searchParams.get('f_TPR')).toBe('r604800');
  });

  it('разбирает карточки: id, заголовок, компания, город, дата', () => {
    const html = `<ul>${CARD('4456297886', 'Entry Level Mechanical Engineer')}${CARD('4456297887', 'Data Analyst')}</ul>`;
    const cards = parseLinkedinCards(html, '2026-09-14T09:00:00.000Z');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      id: `${LINKEDIN_SOURCE_ID}:4456297886`,
      title: 'Entry Level Mechanical Engineer',
      company: 'Schneider Electric',
      location: 'Boston, MA',
      url: 'https://www.linkedin.com/jobs/view/4456297886',
    });
    expect(cards[0]?.publishedAt.startsWith('2026-09-10')).toBe(true);
  });

  it('карточка без числового id отбрасывается', () => {
    const html = `<li><div data-entity-urn="urn:li:jobPosting:sponsored"><span class="sr-only">Ad</span></div></li>`;
    expect(parseLinkedinCards(html, 'now')).toHaveLength(0);
  });

  it('идёт веером «роль × рынок»: на каждом шаге новый рынок (B218)', async () => {
    const seen: { term: string; location: string; start: number }[] = [];
    const reading = await fetchLinkedinGuest(
      {
        fetchPage: async (url) => {
          const params = new URL(url).searchParams;
          const start = Number(params.get('start'));
          seen.push({ term: params.get('keywords')!, location: params.get('location')!, start });
          // Каждая комбинация отдаёт одну страницу, вторая пуста.
          if (start === 0) return { status: 200, body: `<ul>${CARD(`${seen.length}01`, 'A')}</ul>` };
          return { status: 200, body: '<ul></ul>' };
        },
        sleep: async () => {},
        observedAt: '2026-09-14T09:00:00.000Z',
      },
      0,
    );
    // Двадцать комбинаций за опрос, и каждая — свой рынок: порция опроса
    // покрывает разные регионы, а не одну роль в двадцати городах подряд.
    const locations = new Set(seen.map((s) => s.location));
    expect(locations.size).toBe(20);
    expect(reading.vacancies).toHaveLength(20);
    // Веер шире опроса, поэтому срез дополняется, а не заменяется.
    expect(reading.partial).toBe(true);
  });

  it('429 посреди опроса останавливает чтение и называет его частичным', async () => {
    let calls = 0;
    const reading = await fetchLinkedinGuest(
      {
        fetchPage: async () => {
          calls += 1;
          if (calls === 1) return { status: 200, body: `<ul>${CARD('1', 'A')}</ul>` };
          return { status: 429, body: '' };
        },
        sleep: async () => {},
        observedAt: '2026-09-14T09:00:00.000Z',
      },
      0,
    );
    expect(calls).toBe(2);
    expect(reading.vacancies).toHaveLength(1);
    expect(reading.partial).toBe(true);
  });

  it('429 на первой странице — отказ площадки, а не пустой успех (B199)', async () => {
    await expect(
      fetchLinkedinGuest(
        {
          fetchPage: async () => ({ status: 429, body: '' }),
          sleep: async () => {},
          observedAt: 'now',
        },
        0,
      ),
    ).rejects.toThrow(/429/);
  });
});
