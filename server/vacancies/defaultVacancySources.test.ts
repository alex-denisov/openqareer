import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VACANCY_SOURCES,
  vacancySourceMeasurement,
  vacancySourceMeasurements,
} from './defaultVacancySources';
import { hasJsonAdapter, normalizeJsonSource } from './jsonSourceAdapters';

/**
 * B164 — the registry used to carry sources nobody had ever contacted, and
 * several of the addresses turned out not to exist. A registered source now
 * has to say which access class it belongs to and what a live probe actually
 * returned, and it may only be enabled if that probe returned vacancies.
 */
describe('registry of vacancy sources', () => {
  it('gives every source an access class the owner named', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      expect(['open_web', 'api', 'browser_session']).toContain(source.accessClass);
    }
  });

  it('never enables a source that has not been observed returning vacancies', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      const measurement = vacancySourceMeasurement(source.id);
      expect(measurement, `${source.id} has no measurement`).toBeDefined();
      if (source.enabled) {
        expect(measurement!.items, `${source.id} is enabled with an empty probe`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('dates every measurement, so a stale registry is visible', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      const measurement = vacancySourceMeasurement(source.id)!;
      expect(Number.isNaN(Date.parse(measurement.observedAt))).toBe(false);
    }
  });

  it('declares the transport it actually speaks, not the one it resembles', () => {
    const remoteok = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-remoteok');

    // It was registered as `rss` while pointing at a JSON endpoint (B161 review §6).
    expect(remoteok?.type).toBe('json_api');
    expect(remoteok?.targetUrl).toContain('remoteok.com/api');
  });

  it('carries no duplicate ids and no duplicate endpoints', () => {
    const ids = DEFAULT_VACANCY_SOURCES.map((source) => source.id);
    const urls = DEFAULT_VACANCY_SOURCES.map((source) => source.targetUrl);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('keeps a disabled source only with a written reason', () => {
    for (const source of DEFAULT_VACANCY_SOURCES.filter((entry) => !entry.enabled)) {
      expect(source.disabledReason, `${source.id} is disabled without a reason`).toBeTruthy();
    }
  });

  it('Get on Board читается веером по категориям и больше не требует запроса (B217)', () => {
    const getonbrd = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-getonbrd');

    expect(getonbrd?.enabled).toBe(true);
    expect(getonbrd?.requiresQuery).toBeFalsy();
    expect(getonbrd?.targetUrl).toContain('/api/v0/categories/');
    expect(getonbrd?.targetUrl).toContain('expand=');
  });

  it('подключает площадки решения владельца B217 с замером с прод-маршрута', () => {
    const enabled = new Map(DEFAULT_VACANCY_SOURCES.map((source) => [source.id, source]));
    for (const id of ['src-apple-jobs', 'src-microsoft-careers', 'src-crossover', 'remotive']) {
      expect(enabled.get(id)?.enabled, id).toBe(true);
      expect(vacancySourceMeasurements(id).some((m) => m.route === 'eu-prod' && m.items > 0)).toBe(
        true,
      );
    }
    // Remotive — единственное разрешение поверх robots, и оно названо словами.
    const remotive = enabled.get('remotive');
    expect(remotive?.type).toBe('json_api');
    expect(remotive?.robotsOverride?.grantedBy).toBe('owner');
    expect(remotive?.refreshIntervalMinutes).toBeGreaterThanOrEqual(360);
    // Разрешение поверх robots — только явное, у Remotive и LinkedIn (B217, B218).
    const overridden = DEFAULT_VACANCY_SOURCES.filter((s) => s.robotsOverride)
      .map((s) => s.id)
      .sort();
    expect(overridden).toEqual(['remotive', 'src-indeed', 'src-linkedin-guest']);
  });
});

/**
 * B199 — до этого замер был один и безымянный, поэтому «источник молчит» и
 * «наш канал не дотянул» выглядели одинаково. Проба 2026-09-05 с трёх
 * маршрутов показала, что половина отказов была свойством маршрута: ТрудВсем
 * отдаёт 322 КБ российскому ЦОДу и обрывается на 30 КБ для прод-VM в EU, а
 * remoteok наоборот. Реестр обязан хранить, **откуда** сделан замер, и
 * запрещать включение источника, которого не видел тот маршрут, на котором
 * работает продукт.
 */
describe('registry of vacancy sources: routes and address status (B199)', () => {
  it('names the route of every measurement, so a reading cannot be routeless', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      const readings = vacancySourceMeasurements(source.id);
      expect(readings.length, `${source.id} has no measurement at all`).toBeGreaterThan(0);
      for (const reading of readings) {
        expect(
          ['eu-prod', 'ru-dc', 'ru-owner'],
          `${source.id} was measured from an unnamed route`,
        ).toContain(reading.route);
      }
    }
  });

  it('enables a source only if the route production runs on has seen vacancies from it', () => {
    for (const source of DEFAULT_VACANCY_SOURCES.filter((entry) => entry.enabled)) {
      const production = vacancySourceMeasurements(source.id).find(
        (reading) => reading.route === 'eu-prod',
      );

      expect(production, `${source.id} is enabled without a production-route probe`).toBeDefined();
      expect(
        production!.items,
        `${source.id} is enabled although the production route saw nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps a source measured only on a route production does not use disabled', () => {
    // ТрудВсем: 322 121 байт за 5,4 с из российского ЦОДа, обрыв на 30 КБ из EU.
    const trudvsem = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-trudvsem');
    const routes = vacancySourceMeasurements('src-trudvsem').map((reading) => reading.route);

    expect(routes).toContain('ru-dc');
    expect(trudvsem?.enabled).toBe(false);
  });

  it('gives every source an address status that a probe actually established', () => {
    for (const source of DEFAULT_VACANCY_SOURCES) {
      expect(
        [
          'live',
          'needs_browser_session',
          'robots_forbidden',
          'address_lost',
          'route_limited',
          'official_access_required',
        ],
        `${source.id} carries no established address status`,
      ).toContain(source.addressStatus);
    }
  });

  it('never lets the server contact an address the platform forbade or hid behind anti-bot', () => {
    const unreachableByPolicy = DEFAULT_VACANCY_SOURCES.filter((source) =>
      ['needs_browser_session', 'robots_forbidden', 'address_lost'].includes(source.addressStatus),
    );

    expect(unreachableByPolicy.length).toBeGreaterThan(0);
    for (const source of unreachableByPolicy) {
      expect(source.enabled, `${source.id} is enabled although it must not be contacted`).toBe(
        false,
      );
    }
  });

  it('registers the platforms the owner named rather than dropping the ones we cannot fetch', () => {
    const ids = DEFAULT_VACANCY_SOURCES.map((source) => source.id);

    // Владелец 2026-09-05: «Не отсекай площадки типа linkedin, glassdoor и
    // другие у которых антиботы». Indeed и LinkedIn подключены по механике
    // JobSpy (B218), Glassdoor остаётся названным и выключенным.
    expect(ids).toContain('src-linkedin-guest');
    expect(ids).toContain('src-glassdoor');
    expect(ids).toContain('src-indeed');
  });

  it('carries the newly proven feeds from the 2026-09-05 probe', () => {
    const nodesk = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-nodesk');
    const himalayasApi = DEFAULT_VACANCY_SOURCES.find(
      (source) => source.id === 'src-himalayas-api',
    );

    // Лента NoDesk читается существующим общим разбором RSS, поэтому она
    // подключена. JSON-адрес Himalayas с B199 стоял выключенным без адаптера;
    // B216 дал ему адаптер и курсорную постраничность — теперь он включён.
    expect(nodesk?.enabled).toBe(true);
    expect(himalayasApi?.type).toBe('json_api');
    expect(himalayasApi?.enabled).toBe(true);
  });

  it('подключает постраничные площадки и карьерные сайты B216 с замером с прод-маршрута', () => {
    const enabledIds = DEFAULT_VACANCY_SOURCES.filter((source) => source.enabled).map(
      (source) => source.id,
    );

    for (const id of ['src-themuse', 'src-amazon-jobs', 'src-netflix', 'ats-workday-nvidia']) {
      expect(enabledIds).toContain(id);
      expect(vacancySourceMeasurements(id).some((m) => m.route === 'eu-prod' && m.items > 0)).toBe(
        true,
      );
    }
  });

  it('records what a platform allows, not only whether it answered', () => {
    const nodesk = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-nodesk');

    // nodesk.co: `Allow: /` нам, но `Content-Signal: ai-train=no` и запрет
    // ClaudeBot/GPTBot/CCBot. Лента разрешена, обучение на контенте — нет.
    expect(nodesk?.contentSignals).toContain('ai-train=no');
  });
});

/**
 * B199 — источник, который сервер не имеет права опрашивать, не должен
 * притворяться лентой. Пять площадок владельца (LinkedIn, Indeed, Glassdoor,
 * Monster, ZipRecruiter, Wellfound) были бы записаны как `rss`, хотя ленты у
 * них нет и опрашивать их сервер не будет никогда.
 */
describe('registry of vacancy sources: browser-session sources name their transport (B199)', () => {
  it('declares browser_session as the transport, not a feed it does not have', () => {
    const browserOnly = DEFAULT_VACANCY_SOURCES.filter(
      (source) => source.accessClass === 'browser_session',
    );

    expect(browserOnly.length).toBeGreaterThan(0);
    for (const source of browserOnly) {
      if (source.id === 'src-linkedin-crawler') {
        expect(source.type).toBe('linkedin_crawler');
      } else {
        expect(source.type, `${source.id} pretends to speak ${source.type}`).toBe('browser_session');
      }
    }
  });
});

/**
 * B199 — включённый источник обязан быть читаемым существующим кодом. Замер
 * доказывает, что адрес отдаёт данные; он ничего не говорит о том, умеет ли
 * продукт разобрать эту запись. У каждой JSON-площадки своя форма записи, и
 * без адаптера сбор падает на `vacancy_source_adapter_missing` — источник
 * числится подключённым, а вакансий с него не приходит никогда.
 */
describe('registry of vacancy sources: an enabled source is readable (B199)', () => {
  it('gives every enabled json_api source its own adapter', () => {
    const missing = DEFAULT_VACANCY_SOURCES.filter(
      (source) => source.enabled && source.type === 'json_api' && !hasJsonAdapter(source.id),
    ).map((source) => source.id);

    expect(missing).toEqual([]);
  });
});

describe('Qualcomm Eightfold source', () => {
  it('registers Qualcomm as an enabled Eightfold source with measurement', () => {
    const qualcomm = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-qualcomm-careers');
    expect(qualcomm).toBeDefined();
    expect(qualcomm?.name).toBe('Qualcomm');
    expect(qualcomm?.type).toBe('json_api');
    expect(qualcomm?.accessClass).toBe('api');
    expect(qualcomm?.addressStatus).toBe('live');
    expect(qualcomm?.enabled).toBe(true);
    expect(qualcomm?.targetUrl).toBe(
      'https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com',
    );

    const readings = vacancySourceMeasurements('src-qualcomm-careers');
    expect(readings.length).toBeGreaterThan(0);
    const prod = readings.find((r) => r.route === 'eu-prod');
    expect(prod).toBeDefined();
    expect(prod?.items).toBe(1963);
    expect(prod?.observedAt).toBe('2026-09-14');
  });

  it('normalises Qualcomm Eightfold position payload', () => {
    const [vacancy] = normalizeJsonSource(
      'src-qualcomm-careers',
      {
        data: {
          count: 1963,
          positions: [
            {
              id: '3071234',
              displayJobId: '3071234',
              name: 'Staff Engineer, SW Architecture',
              locations: ['San Diego, CA, United States'],
              postedTs: 1789365721,
              department: 'Engineering - Software',
              workLocationOption: 'onsite',
              positionUrl: '/careers/job/3071234',
            },
          ],
        },
      },
      { observedAt: '2026-09-14T09:00:00.000Z', sourceName: 'Qualcomm' },
    );
    expect(vacancy).toMatchObject({
      company: 'Qualcomm',
      title: 'Staff Engineer, SW Architecture',
      location: 'San Diego, CA, United States',
      isRemote: false,
      url: 'https://careers.qualcomm.com/careers/job/3071234',
      publishedAt: new Date(1789365721 * 1000).toISOString(),
    });
    expect(vacancy?.provenance.externalId).toBe('3071234');
    expect(vacancy?.description).toContain('Engineering - Software');
  });
});

describe('Hacker News Who is hiring source', () => {
  it('registers Hacker News as an enabled source with measurement', () => {
    const hn = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-hn-whoishiring');
    expect(hn).toBeDefined();
    expect(hn?.name).toBe('Hacker News');
    expect(hn?.type).toBe('json_api');
    expect(hn?.accessClass).toBe('api');
    expect(hn?.addressStatus).toBe('live');
    expect(hn?.enabled).toBe(true);
    expect(hn?.targetUrl).toContain('hn.algolia.com/api/v1/search_by_date');

    const readings = vacancySourceMeasurements('src-hn-whoishiring');
    expect(readings.length).toBeGreaterThan(0);
    const prod = readings.find((r) => r.route === 'eu-prod');
    expect(prod).toBeDefined();
    expect(prod?.items).toBeGreaterThan(0);
    expect(prod?.observedAt).toBe('2026-09-14');
  });

  it('normalises Hacker News comments payload via normalizeJsonSource', () => {
    const [vacancy] = normalizeJsonSource(
      'src-hn-whoishiring',
      {
        hits: [
          {
            objectID: '49667711',
            parent_id: 49522897,
            story_id: 49522897,
            author: 'Daniel_Van_Zant',
            created_at: '2026-09-02T16:00:00Z',
            comment_text:
              'Lumen Labs | Robotics Engineer | San Francisco, CA | ONSITE | $150k<p>We build physical AI.',
          },
        ],
      },
      { observedAt: '2026-09-14T22:00:00Z' },
    );

    expect(vacancy).toBeDefined();
    expect(vacancy?.company).toBe('Lumen Labs');
    expect(vacancy?.title).toBe('Robotics Engineer');
    expect(vacancy?.location).toBe('San Francisco, CA');
    expect(vacancy?.isRemote).toBe(false);
    expect(vacancy?.url).toBe('https://news.ycombinator.com/item?id=49667711');
  });
});

describe('JobSpy sources in default registry', () => {
  it('registers Naukri, BDJobs, and ZipRecruiter as enabled sources with measurements', () => {
    for (const id of ['src-naukri', 'src-bdjobs', 'src-ziprecruiter']) {
      const source = DEFAULT_VACANCY_SOURCES.find((s) => s.id === id);
      expect(source).toBeDefined();
      expect(source?.type).toBe('json_api');
      expect(source?.accessClass).toBe('api');
      expect(source?.addressStatus).toBe('live');
      expect(source?.enabled).toBe(true);

      const readings = vacancySourceMeasurements(id);
      expect(readings.length).toBeGreaterThan(0);
      const prod = readings.find((r) => r.route === 'eu-prod');
      expect(prod).toBeDefined();
      expect(prod?.items).toBeGreaterThan(0);
      expect(prod?.observedAt).toBe('2026-09-14');
    }
  });
});

describe('LinkedIn Obscura crawler in default registry (B208)', () => {
  it('registers src-linkedin-crawler as an enabled source with measurement', () => {
    const source = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-linkedin-crawler');
    expect(source).toBeDefined();
    expect(source?.name).toBe('LinkedIn (Obscura Crawler)');
    expect(source?.type).toBe('linkedin_crawler');
    expect(source?.accessClass).toBe('browser_session');
    expect(source?.addressStatus).toBe('live');
    expect(source?.enabled).toBe(true);
    expect(source?.targetUrl).toBe('https://www.linkedin.com/jobs/search');

    const readings = vacancySourceMeasurements('src-linkedin-crawler');
    expect(readings.length).toBeGreaterThan(0);
    const prod = readings.find((r) => r.route === 'eu-prod');
    expect(prod).toBeDefined();
    expect(prod?.items).toBeGreaterThan(0);
  });
});
