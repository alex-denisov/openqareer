import { describe, expect, it } from 'vitest';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { linkedinProviderCapability } from '../crawler/linkedinProviderCapability';
import {
  fetchLinkedinGuest,
  linkedinGuestUrl,
  parseLinkedinCards,
  LINKEDIN_SOURCE_ID,
  UAE_LOCATIONS,
  resetLinkedinFanCursor,
} from './linkedinGuestSource';

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
  it('owner decision 2026-11-03: guest channel is on by default', async () => {
    expect(linkedinProviderCapability().verdict).toBe('provider_permitted');
    const source = DEFAULT_VACANCY_SOURCES.find((s) => s.id === LINKEDIN_SOURCE_ID);
    expect(source?.enabled).toBe(true);
    expect(source?.disabledReason).toBeUndefined();
    let calls = 0;
    await fetchLinkedinGuest(
      {
        fetchPage: async () => {
          calls += 1;
          return { status: 200, body: '<ul></ul>' };
        },
        sleep: async () => {},
        observedAt: 'now',
      },
      0,
    );
    expect(calls).toBeGreaterThan(0);
  });

  it('fails closed when the capability is explicitly not configured', async () => {
    let calls = 0;
    const reading = await fetchLinkedinGuest({
      fetchPage: async () => {
        calls += 1;
        return { status: 200, body: '<ul></ul>' };
      },
      sleep: async () => {},
      observedAt: 'now',
      providerCapability: 'not_configured',
    });

    expect(reading).toEqual({ vacancies: [], partial: true });
    expect(calls).toBe(0);
  });

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
          if (start === 0)
            return { status: 200, body: `<ul>${CARD(`${seen.length}01`, 'A')}</ul>` };
          return { status: 200, body: '<ul></ul>' };
        },
        sleep: async () => {},
        observedAt: '2026-09-14T09:00:00.000Z',
        providerCapability: 'provider_permitted',
      },
      0,
    );
    // Двадцать комбинаций за опрос, и каждая — свой рынок: порция опроса
    // покрывает разные регионы, а не одну роль в двадцати городах подряд.
    const locations = new Set(seen.map((s) => s.location));
    expect(locations.size).toBeGreaterThanOrEqual(18);
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
        providerCapability: 'provider_permitted',
      },
      0,
    );
    expect(calls).toBe(4);
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
          providerCapability: 'provider_permitted',
        },
        0,
      ),
    ).rejects.toThrow(/429/);
  });

  it('сначала читает роли кандидатов, затем общий веер (27.10)', async () => {
    const terms: string[] = [];
    await fetchLinkedinGuest(
      {
        fetchPage: async (url) => {
          const params = new URL(url).searchParams;
          if (params.get('start') === '0') terms.push(params.get('keywords')!);
          return { status: 200, body: '<ul></ul>' };
        },
        sleep: async () => {},
        observedAt: '2026-10-27T09:00:00.000Z',
        providerCapability: 'provider_permitted',
        demandTerms: ['head of ai'],
      },
      0,
    );
    expect(terms[0]).toBe('head of ai');
    expect(terms.filter((term) => term === 'head of ai').length).toBeGreaterThan(1);
    expect(terms.at(-UAE_LOCATIONS.length - 1)).not.toBe('head of ai');
  });

  it('every sync reads the UAE: Dubai, Abu Dhabi, Sharjah and the country', async () => {
    const locations = new Set<string>();
    for (let tick = 0; tick < 3; tick += 1) {
      await fetchLinkedinGuest(
        {
          fetchPage: async (url) => {
            const params = new URL(url).searchParams;
            if (params.get('start') === '0') locations.add(params.get('location')!);
            return { status: 200, body: '<ul></ul>' };
          },
          sleep: async () => {},
          observedAt: 'now',
          providerCapability: 'provider_permitted',
        },
        tick * 90 * 60_000,
      );
    }
    for (const place of ['Dubai', 'Abu Dhabi', 'Sharjah', 'United Arab Emirates']) {
      expect(locations.has(place)).toBe(true);
    }
  });

  it('pauses at least 0.4 s with jitter between requests', async () => {
    const pauses: number[] = [];
    await fetchLinkedinGuest(
      {
        fetchPage: async () => ({ status: 200, body: '<ul></ul>' }),
        sleep: async (ms) => {
          pauses.push(ms);
        },
        observedAt: 'now',
        providerCapability: 'provider_permitted',
      },
      0,
    );
    expect(pauses.length).toBeGreaterThan(5);
    expect(Math.min(...pauses)).toBeGreaterThanOrEqual(400);
    expect(new Set(pauses).size).toBeGreaterThan(1);
  });

  it('429 mid-run: waits with exponential backoff / Retry-After, then continues', async () => {
    let calls = 0;
    const pauses: number[] = [];
    const reading = await fetchLinkedinGuest(
      {
        fetchPage: async () => {
          calls += 1;
          if (calls === 2) return { status: 429, body: '', retryAfterSeconds: 30 };
          if (calls === 1) return { status: 200, body: `<ul>${CARD('1', 'A')}</ul>` };
          return { status: 200, body: `<ul>${CARD(`9${calls}`, 'B')}</ul>` };
        },
        sleep: async (ms) => {
          pauses.push(ms);
        },
        observedAt: 'now',
        providerCapability: 'provider_permitted',
      },
      0,
    );
    expect(pauses.some((ms) => ms >= 30_000)).toBe(true);
    expect(reading.vacancies.length).toBeGreaterThan(1);
    expect(reading.partial).toBe(true);
  });

  it('repeated 429 stops the run, partial, with growing pauses', async () => {
    let calls = 0;
    const pauses: number[] = [];
    const reading = await fetchLinkedinGuest(
      {
        fetchPage: async () => {
          calls += 1;
          if (calls === 1) return { status: 200, body: `<ul>${CARD('1', 'A')}</ul>` };
          return { status: 429, body: '' };
        },
        sleep: async (ms) => {
          pauses.push(ms);
        },
        observedAt: 'now',
        providerCapability: 'provider_permitted',
      },
      0,
    );
    const backoff = pauses.filter((ms) => ms >= 5_000);
    expect(backoff.length).toBe(2);
    expect(backoff[1]!).toBeGreaterThan(backoff[0]!);
    expect(reading.partial).toBe(true);
    expect(reading.vacancies).toHaveLength(1);
  });

  describe('time budget and page timeouts (03.11)', () => {
    const base = {
      sleep: async () => {},
      observedAt: '2026-11-03T09:00:00.000Z',
      providerCapability: 'provider_permitted' as const,
      demandTerms: [] as string[],
    };

    it('a page timeout after the first page keeps what was read', async () => {
      let calls = 0;
      const reading = await fetchLinkedinGuest(
        {
          ...base,
          fetchPage: async () => {
            calls += 1;
            if (calls <= 2) return { status: 200, body: `<ul>${CARD(String(calls), 'A')}</ul>` };
            throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
          },
        },
        0,
      );
      expect(reading.vacancies).toHaveLength(2);
      expect(reading.partial).toBe(true);
    });

    it('a timeout on the very first page is a source failure', async () => {
      await expect(
        fetchLinkedinGuest(
          {
            ...base,
            fetchPage: async () => {
              throw new DOMException('timeout', 'TimeoutError');
            },
          },
          1,
        ),
      ).rejects.toThrow(/timeout/);
    });

    it('an exhausted budget ends the run successfully, the next run resumes there', async () => {
      resetLinkedinFanCursor();
      let now = 0;
      let n = 0;
      const urls: string[] = [];
      const deps = {
        ...base,
        budgetMs: 1_000,
        clock: () => now,
        fetchPage: async (url: string) => {
          urls.push(url);
          now += 400;
          n += 1;
          return { status: 200, body: `<ul>${CARD(String(n), 'A')}</ul>` };
        },
      };
      const first = await fetchLinkedinGuest(deps, 5_000);
      expect(first.partial).toBe(true);
      expect(first.vacancies.length).toBe(3);
      const firstCombo = new URL(urls[0]!).searchParams.get('keywords');
      urls.length = 0;
      now = 0;
      await fetchLinkedinGuest(deps, 5_000 + 60_000);
      const secondFirst = new URL(urls[0]!);
      // same 90-minute tick: continues the fan, does not restart from combo 0
      expect(urls.length).toBeGreaterThan(0);
      expect(`${secondFirst.searchParams.get('keywords')}|${secondFirst.searchParams.get('start')}`).not.toBe(
        `${firstCombo}|0`,
      );
    });
  });
});
