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
  it('строит адрес с offset, ключевыми словами и локацией', () => {
    const url = new URL(linkedinGuestUrl(20));
    expect(url.pathname).toBe('/jobs-guest/jobs/api/seeMoreJobPostings/search');
    expect(url.searchParams.get('start')).toBe('20');
    expect(url.searchParams.get('keywords')).toContain('engineer');
    expect(url.searchParams.get('location')).toBe('United States');
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

  it('пагинация по offset до пустой страницы; чтение частичное на 429', async () => {
    const seen: number[] = [];
    const reading = await fetchLinkedinGuest({
      fetchPage: async (url) => {
        const start = Number(new URL(url).searchParams.get('start'));
        seen.push(start);
        if (start === 0) return { status: 200, body: `<ul>${CARD('1', 'A')}${CARD('2', 'B')}</ul>` };
        if (start === 10) return { status: 429, body: '' };
        return { status: 200, body: '<ul></ul>' };
      },
      sleep: async () => {},
      observedAt: '2026-09-14T09:00:00.000Z',
    });
    expect(seen).toEqual([0, 10]);
    expect(reading.vacancies).toHaveLength(2);
    expect(reading.partial).toBe(true);
  });

  it('429 на первой странице — отказ площадки, а не пустой успех (B199)', async () => {
    await expect(
      fetchLinkedinGuest({
        fetchPage: async () => ({ status: 429, body: '' }),
        sleep: async () => {},
        observedAt: 'now',
      }),
    ).rejects.toThrow(/429/);
  });
});
