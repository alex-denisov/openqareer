import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VACANCY_SOURCES,
  vacancySourceMeasurement,
  vacancySourceMeasurements,
} from './defaultVacancySources';
import { hasJsonAdapter } from './jsonSourceAdapters';

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

  it('marks a source that answers nothing without a query, so a scheduled sync skips it', () => {
    const getonbrd = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-getonbrd');

    expect(getonbrd?.requiresQuery).toBe(true);
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
    // другие у которых антиботы». Они остаются названными и выключенными.
    expect(ids).toContain('src-linkedin');
    expect(ids).toContain('src-glassdoor');
    expect(ids).toContain('src-indeed');
  });

  it('carries the newly proven feeds from the 2026-09-05 probe', () => {
    const nodesk = DEFAULT_VACANCY_SOURCES.find((source) => source.id === 'src-nodesk');
    const himalayasApi = DEFAULT_VACANCY_SOURCES.find(
      (source) => source.id === 'src-himalayas-api',
    );

    // Лента NoDesk читается существующим общим разбором RSS, поэтому она
    // подключена. У JSON-адреса Himalayas своя форма записи: замер есть, но
    // пока нет адаптера, источник остаётся названным и выключенным — иначе он
    // числился бы подключённым и не приносил бы ни одной вакансии (B199).
    expect(nodesk?.enabled).toBe(true);
    expect(himalayasApi?.type).toBe('json_api');
    expect(himalayasApi?.enabled).toBe(false);
    expect(himalayasApi?.disabledReason).toBeTruthy();
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
      expect(source.type, `${source.id} pretends to speak ${source.type}`).toBe('browser_session');
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
