import {
  asArray,
  fromEpochSeconds,
  fromIso,
  fromLooseDate,
  numeric,
  record,
  text,
} from '../jsonVacancyRecord';
import { feed, paged, REMOTE_RE, rubSalary, type FreehireFeed, type Row } from './feedKit';

/**
 * Российские площадки и сайты второй партии (B641). Адреса и поля перенесены
 * из `internal/ingest/sources/{getmatch,habrcareer,megafon,mts}.go` проекта
 * github.com/strelov1/freehire (MIT, © 2026 freehire contributors); каждая
 * лента проверена живым запросом 10.11.
 */
const items = (value: unknown): unknown[] => asArray(value) ?? [];

/* ------------------------------------------------------------ getmatch */
export const getmatchFeed = feed(
  {
    id: 'getmatch',
    name: 'getmatch',
    company: '',
    market: 'Россия',
    homeUrl: 'https://getmatch.ru/vacancies',
  },
  async (client, delay) => {
    let offset = 0;
    return paged(client, delay, async () => {
      const payload = record(
        await client.getJson(`https://getmatch.ru/api/offers?offset=${offset}&limit=100`),
      );
      const rows = items(payload.offers)
        .map(record)
        .map((o): Row => {
          const places = items(o.location_items).map(record);
          return {
            externalId: text(o.id),
            title: text(o.position),
            url: `https://getmatch.ru${text(o.url)}`,
            company: text(record(o.company).name),
            location: places.map((p) => text(p.label)).join(', '),
            remote: places.some((p) => text(p.format) === 'remote'),
            description: text(o.offer_description),
            // `2026-11-10T06:00:40.460920` — без пояса, площадка в UTC (freehire).
            publishedAt: fromLooseDate(text(o.published_at).replace('T', ' ').slice(0, 19)),
          };
        });
      offset += rows.length;
      return { rows, more: offset < (numeric(record(payload.meta).total) ?? 0) };
    });
  },
);

/* -------------------------------------------------------- Хабр Карьера */
const HABR_HEADERS = { Accept: 'application/json', Referer: 'https://career.habr.com/vacancies' };

export const habrCareerFeed = feed(
  {
    id: 'habr-career',
    name: 'Хабр Карьера',
    company: '',
    market: 'Россия',
    homeUrl: 'https://career.habr.com/vacancies',
  },
  (client, delay) =>
    paged(client, delay, async (page) => {
      const payload = record(
        await client.getJson(
          `https://career.habr.com/api/frontend/vacancies?type=all&sort=date&page=${page + 1}`,
          { headers: HABR_HEADERS },
        ),
      );
      const rows = items(payload.list)
        .map(record)
        .map((v): Row => {
          const salary = record(v.salary);
          return {
            externalId: text(v.id),
            title: text(v.title),
            url: `https://career.habr.com/vacancies/${text(v.id)}`,
            company: text(record(v.company).title),
            location: items(v.locations)
              .map((l) => text(record(l).title))
              .join(', '),
            remote: v.remoteWork === true,
            publishedAt: fromIso(record(v.publishedDate).date),
            salary:
              text(salary.currency).toLowerCase() === 'rur'
                ? rubSalary(salary.from, salary.to)
                : undefined,
          };
        });
      return { rows, more: page + 1 < (numeric(record(payload.meta).totalPages) ?? 0) };
    }),
);

/* ------------------------------------------------------------- МегаФон */
export const megafonFeed = feed(
  {
    id: 'megafon',
    name: 'МегаФон — карьера',
    company: 'МегаФон',
    market: 'Россия',
    homeUrl: 'https://job.megafon.ru/',
  },
  // Без `cities` лента отдаёт все города разом (1 011 записей, 10.11): обходить
  // 738 городов, как freehire, не нужно.
  (client, delay) =>
    paged(client, delay, async (page) => {
      const payload = record(
        await client.getJson(`https://job.megafon.ru/api/v1/vacancies?page=${page + 1}`),
      );
      const rows = items(payload.vacancies)
        .map(record)
        .map((v): Row => {
          const city = record(v.city);
          return {
            externalId: text(v.id),
            title: text(v.title),
            url: `https://job.megafon.ru/vacancy/${text(city.slug)}/${text(record(v.sector).slug)}/${text(v.slug)}`,
            company: text(record(v.organisation).title),
            location: text(city.title),
            remote: text(city.slug) === 'udalennyj-format',
            publishedAt: fromEpochSeconds(numeric(v.publishedAt)),
          };
        });
      return { rows, more: page + 1 < (numeric(payload.pages) ?? 0) };
    }),
);

/* ----------------------------------------------------------------- МТС */
const MTS_KEY_RE = /apiKey:"([^"]+)"/;

export const mtsFeed = feed(
  {
    id: 'mts',
    name: 'МТС — карьера',
    company: 'МТС',
    market: 'Россия',
    homeUrl: 'https://job.mts.ru/',
  },
  async (client, delay) => {
    // Ключ API — публичная настройка фронтенда сайта, не секрет (freehire).
    const key = (await client.getText('https://job.mts.ru/')).match(MTS_KEY_RE)?.[1];
    if (!key) throw new Error('vacancy_source_payload_unreadable: mts apiKey');
    let offset = 0;
    return paged(client, delay, async () => {
      const data = record(
        record(
          await client.getJson('https://api.job.mts.ru/v1/vacancies/filtered/career', {
            method: 'POST',
            body: { offset, limit: 200 },
            headers: { 'x-api-key': key },
          }),
        ).data,
      );
      const rows = items(data.vacancies)
        .map(record)
        .map((v): Row => {
          const info = record(v.info);
          return {
            externalId: text(v.id),
            title: text(v.name),
            url: `https://job.mts.ru/vacancy/${text(v.id)}`,
            company: text(info.brand),
            location: text(info.city),
            remote: REMOTE_RE.test(text(info.worktype)),
            description: [info.category, info.experience, info.mode].map(text).join('\n'),
            salary: rubSalary(info.salaryMin, info.salaryMax),
          };
        });
      offset += rows.length;
      return { rows, more: offset < (numeric(record(data.pageInfo).total) ?? 0) };
    });
  },
);

export const RUSSIAN_PLATFORM_FEEDS: readonly FreehireFeed[] = [
  getmatchFeed,
  habrCareerFeed,
  megafonFeed,
  mtsFeed,
];
