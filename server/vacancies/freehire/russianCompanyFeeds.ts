import type { UnifiedVacancy } from '../../domain/unifiedVacancy';
import {
  asArray,
  buildJsonVacancy,
  fromIso,
  fromLooseDate,
  numeric,
  record,
  text,
  type JsonAdapterContext,
} from '../jsonVacancyRecord';
import type { FeedClient } from './feedClient';

/**
 * Карьерные сайты российских компаний (B641, первая очередь).
 *
 * Адреса, поля и фильтры перенесены из адаптеров `internal/ingest/sources/
 * <name>.go` проекта github.com/strelov1/freehire (MIT, © 2026 freehire
 * contributors). Каждая лента живьём проверена с прод-VM (Германия) 10.11.
 *
 * Отличие от freehire: опрос читает только список. Полный текст карточки
 * дочитывает воркер текстов (`detailTextSources`) по одной вакансии в такт, а
 * не опрос по тысяче запросов — у Ozon одних списочных страниц 114.
 *
 * Лента без даты публикации (Купер, Домклик, Додо, RWB, VK): сайт отдаёт только
 * открытые вакансии, поэтому дата — момент чтения. Это не «невычитанная дата»
 * из `jsonVacancyRecord`: запись есть на сайте сейчас.
 */
export interface FeedListing {
  readonly vacancies: readonly UnifiedVacancy[];
  /** Список дочитан не до конца — срез дополняется, а не заменяется. */
  readonly partial: boolean;
}

export interface FreehireFeed {
  readonly id: string;
  readonly name: string;
  readonly company: string;
  readonly market: string;
  readonly homeUrl: string;
  /** Пауза между страницами списка. */
  readonly pageDelayMs: number;
  list(client: FeedClient, context: JsonAdapterContext, sourceId: string): Promise<FeedListing>;
}

const PAGE_DELAY_MS = 700;
const MAX_PAGES = 200;

interface Row {
  readonly externalId: string;
  readonly title: string;
  readonly url: string;
  readonly company?: string;
  readonly location?: string;
  readonly remote?: boolean;
  readonly description?: string;
  readonly publishedAt?: string;
  readonly salary?: UnifiedVacancy['salary'];
}

const REMOTE_RE = /удал|remote|дистанц/i;

function toVacancy(
  feed: Pick<FreehireFeed, 'company'>,
  row: Row,
  context: JsonAdapterContext,
  sourceId: string,
): UnifiedVacancy {
  return buildJsonVacancy({
    sourceId,
    context,
    externalId: row.externalId,
    title: row.title,
    company: row.company?.trim() || feed.company,
    location: row.location?.trim() || undefined,
    isRemote: row.remote ?? REMOTE_RE.test(row.location ?? ''),
    description: row.description ?? '',
    skills: [],
    salary: row.salary,
    url: row.url,
    publishedAt: row.publishedAt ?? context.observedAt,
  });
}

function rubSalary(from: unknown, to: unknown): UnifiedVacancy['salary'] {
  const lo = numeric(from);
  const hi = numeric(to);
  if (lo === undefined && hi === undefined) return undefined;
  return { from: lo, to: hi, currency: 'RUB', period: 'month' };
}

/** Постраничный список: `fetchPage(n)` → записи и признак «есть ещё». */
async function paged(
  client: FeedClient,
  delayMs: number,
  fetchPage: (page: number) => Promise<{ rows: Row[]; more: boolean }>,
): Promise<{ rows: Row[]; partial: boolean }> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (page > 0) await client.pause(delayMs);
    let result: { rows: Row[]; more: boolean };
    try {
      result = await fetchPage(page);
    } catch (err) {
      // Отказ на первой странице — отказ площадки; дальше — частичное чтение.
      if (page === 0) throw err;
      return { rows, partial: true };
    }
    rows.push(...result.rows);
    if (!result.more || result.rows.length === 0) return { rows, partial: false };
  }
  return { rows, partial: true };
}

function feed(
  base: Omit<FreehireFeed, 'list' | 'pageDelayMs'> & { pageDelayMs?: number },
  read: (client: FeedClient, delayMs: number) => Promise<{ rows: Row[]; partial: boolean }>,
): FreehireFeed {
  const pageDelayMs = base.pageDelayMs ?? PAGE_DELAY_MS;
  const self: FreehireFeed = {
    ...base,
    pageDelayMs,
    async list(client, context, sourceId) {
      const { rows, partial } = await read(client, pageDelayMs);
      const seen = new Set<string>();
      const vacancies = rows
        .filter((row) => row.externalId && row.title.trim() && !seen.has(row.externalId))
        .map((row) => {
          seen.add(row.externalId);
          return toVacancy(self, row, context, sourceId);
        });
      return { vacancies, partial };
    },
  };
  return self;
}

const items = (value: unknown): unknown[] => asArray(value) ?? [];

/* ---------------------------------------------------------------- Сбер */
const SBER_LIST =
  'https://rabota.sber.ru/public/app-candidate-public-api-gateway/api/v1/publications';
/** Площадка молча режет `take` до 100 (замер 10.11): шаг — по полученным записям. */
const SBER_PAGE = 100;

export const sberFeed = feed(
  {
    id: 'sber',
    name: 'Сбер — карьера',
    company: 'Сбер',
    market: 'Россия',
    homeUrl: 'https://rabota.sber.ru/search',
  },
  async (client, delay) => {
    let skip = 0;
    return paged(client, delay, async () => {
      const data = record(
        record(await client.getJson(`${SBER_LIST}?skip=${skip}&take=${SBER_PAGE}`)).data,
      );
      const rows = items(data.vacancies).map((raw): Row => {
        const v = record(raw);
        return {
          externalId: text(v.requisitionId),
          title: text(v.title),
          url: `https://rabota.sber.ru/search/${text(v.internalId)}`,
          company: text(v.company),
          location: text(v.city),
          description: ['introduction', 'duties', 'requirements', 'conditions']
            .map((key) => text(v[key]))
            .join('\n'),
          publishedAt: fromIso(v.publicationDate),
        };
      });
      skip += rows.length;
      return { rows, more: skip < (numeric(data.total) ?? 0) };
    });
  },
);

/* -------------------------------------------------------------- Яндекс */
const YANDEX_LIST = 'https://yandex.ru/jobs/api/publications';

export const yandexFeed = feed(
  {
    id: 'yandex',
    name: 'Яндекс — карьера',
    company: 'Яндекс',
    market: 'Россия',
    homeUrl: 'https://yandex.ru/jobs/vacancies',
  },
  async (client, delay) => {
    let cursor = '';
    const seenCursors = new Set<string>();
    return paged(client, delay, async () => {
      const payload = record(
        await client.getJson(
          cursor ? `${YANDEX_LIST}?cursor=${encodeURIComponent(cursor)}` : YANDEX_LIST,
        ),
      );
      const rows = items(payload.results)
        .map(record)
        // Перенаправление на чужую страницу и «быстрый трек» — не вакансия (freehire).
        .filter((v) => v.redirect_url == null && v.fast_track == null)
        .map((v): Row => {
          const vacancy = record(v.vacancy);
          const cities = items(vacancy.cities).map((c) => text(record(c).name));
          const modes = items(vacancy.work_modes).map((m) => text(record(m).slug));
          return {
            externalId: text(v.id),
            title: text(v.title),
            url: `https://yandex.ru/jobs/vacancies/${text(v.publication_slug_url)}`,
            location: cities.filter(Boolean).join(', '),
            remote: modes.some((slug) => slug.includes('remote')),
          };
        });
      const next = text(payload.next);
      const nextCursor = next ? (new URL(next, YANDEX_LIST).searchParams.get('cursor') ?? '') : '';
      const more = nextCursor !== '' && !seenCursors.has(nextCursor);
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      return { rows, more };
    });
  },
);

/* ---------------------------------------------------------------- Ozon */
export const ozonFeed = feed(
  {
    id: 'ozon',
    name: 'Ozon — карьера',
    company: 'Ozon',
    market: 'Россия',
    homeUrl: 'https://career.ozon.ru/',
  },
  (client, delay) =>
    paged(client, delay, async (page) => {
      const payload = record(
        await client.getJson(`https://job-api.ozon.ru/v2/vacancy?page=${page + 1}&limit=50`),
      );
      const rows = items(payload.items)
        .map(record)
        .filter((v) => text(v.vacancyType) === 'external_vacancy')
        .map((v): Row => ({
          externalId: text(v.hhId),
          title: text(v.title),
          // Публичная страница принимает hhId вместо slug (проверено 10.11).
          url: `https://career.ozon.ru/vacancy/${text(v.hhId)}/`,
          location: text(v.city),
          remote: items(v.workFormat).some((f) => REMOTE_RE.test(text(f))),
        }));
      return { rows, more: page + 1 < (numeric(record(payload.meta).totalPages) ?? 0) };
    }),
);

/* ------------------------------------------------------------------ VK */
export const vkFeed = feed(
  {
    id: 'vk',
    name: 'VK — карьера',
    company: 'VK',
    market: 'Россия',
    homeUrl: 'https://team.vk.company/vacancy/',
  },
  async (client, delay) => {
    let url = 'https://team.vk.company/career/api/v2/vacancies/?limit=50&offset=0';
    return paged(client, delay, async () => {
      const payload = record(await client.getJson(url));
      const rows = items(payload.results)
        .map(record)
        .map((v): Row => ({
          externalId: text(v.id),
          title: text(v.title),
          url: `https://team.vk.company/vacancy/${text(v.id)}/`,
          location: text(record(v.town).name),
          remote: v.remote === true,
        }));
      const next = text(payload.next).replace(/^http:/, 'https:');
      url = next;
      return { rows, more: next.startsWith('https://team.vk.company/') };
    });
  },
);

/* ------------------------------------------------------------------ X5 */
export const x5Feed = feed(
  {
    id: 'x5',
    name: 'X5 Group — карьера',
    company: 'X5 Group',
    market: 'Россия',
    homeUrl: 'https://rabota.x5.ru/vacancies',
  },
  (client, delay) =>
    paged(client, delay, async (page) => {
      const payload = record(
        await client.getJson(
          `https://rabota.x5.ru/vacancy/api/v1/public/vacancies?page=${page + 1}&page_size=100`,
        ),
      );
      const rows = items(payload.items)
        .map(record)
        .map((v): Row => {
          const unit = items(v.business_units)
            .map((u) => text(record(record(u).business_unit).name).trim())
            .find(Boolean);
          const fixed = numeric(v.salary);
          return {
            externalId: text(v.id),
            title: text(v.name),
            url: `https://rabota.x5.ru/vacancies/${text(v.id)}`,
            company: unit,
            location: text(v.city) || text(v.address),
            remote: text(v.work_format) === 'remote',
            description: items(v.key_features).map(text).join('\n'),
            publishedAt: fromIso(v.published_at),
            salary:
              fixed !== undefined ? rubSalary(fixed, fixed) : rubSalary(v.salary_min, v.salary_max),
          };
        });
      return { rows, more: page + 1 < (numeric(payload.pages) ?? 0) };
    }),
);

/* -------------------------------------------------------------- Магнит */
export const magnitFeed = feed(
  {
    id: 'magnit',
    name: 'Магнит Tech — карьера',
    company: 'Магнит',
    market: 'Россия',
    homeUrl: 'https://magnit.tech/vacancies',
  },
  (client, delay) =>
    paged(client, delay, async (page) => {
      const payload = record(
        await client.getJson(`https://magnit.tech/api/v1/vacancy?page=${page + 1}&per_page=50`),
      );
      const rows = items(payload.results)
        .map(record)
        .map((v): Row => {
          const formats = items(v.work_formats).map((f) => text(record(f).name));
          return {
            externalId: text(v.id),
            title: text(v.title),
            url: `https://magnit.tech/vacancies/${text(v.id)}`,
            location: [text(v.location), ...formats].filter(Boolean).join('; '),
            description: items(v.technologies)
              .map((t) => text(record(t).name))
              .join(', '),
          };
        });
      return { rows, more: record(payload.meta).has_more_pages === true };
    }),
);

/* ---------------------------------------------------------- Ростелеком */
const headed = (title: string, body: unknown): string =>
  text(body).trim() ? `<h3>${title}</h3>${text(body)}` : '';

export const rostelecomFeed = feed(
  {
    id: 'rostelecom',
    name: 'Ростелеком — карьера',
    company: 'Ростелеком',
    market: 'Россия',
    homeUrl: 'https://job.rt.ru/',
  },
  (client, delay) =>
    paged(client, delay, async (page) => {
      const payload = record(
        await client.getJson(`https://job.rt.ru/backend/api/vacancies?page=${page}&size=100`),
      );
      const rows = items(payload.vacancies)
        .map(record)
        .map((v): Row => ({
          externalId: text(v.id),
          title: text(v.name),
          url: `https://job.rt.ru/vacancy/${text(v.id)}`,
          location: text(record(v.city).name),
          description:
            headed('Чем предстоит заниматься', v.whatWeToDo) +
            headed('Что мы ожидаем', v.whatWeExpect) +
            headed('Что мы предлагаем', v.whatWeOffer),
          salary: rubSalary(v.salaryFrom, v.salaryTo),
        }));
      return { rows, more: page + 1 < (numeric(payload.totalPages) ?? 0) };
    }),
);

/* -------------------------------------------------------------- Lamoda */
export const lamodaFeed = feed(
  {
    id: 'lamoda',
    name: 'Lamoda — карьера',
    company: 'Lamoda',
    market: 'Россия',
    homeUrl: 'https://job.lamoda.ru/vacancies',
  },
  async (client, delay) => {
    let start = 0;
    return paged(client, delay, async () => {
      const payload = record(
        await client.getJson(
          `https://job.lamoda.ru/api/hr/vacancies/compact?pagination%5Blimit%5D=100&pagination%5Bstart%5D=${start}`,
        ),
      );
      const data = items(payload.data).map(record);
      start += data.length;
      const rows = data.map((v): Row => ({
        externalId: text(v.id),
        title: text(v.name),
        url: `https://job.lamoda.ru/vacancies/${text(v.slug)}`,
        location: text(record(v.location).name),
        description: text(v.shortInfo).replace(/;/g, '\n'),
        publishedAt: fromIso(v.externalPublicationDate),
      }));
      return { rows, more: start < (numeric(record(payload.meta).total) ?? 0) };
    });
  },
);

/* --------------------------------------------------------------- Купер */
export const kuperFeed = feed(
  {
    id: 'kuper',
    name: 'Купер — карьера',
    company: 'Купер',
    market: 'Россия',
    homeUrl: 'https://kuper.ru/rabota',
  },
  (client, delay) =>
    paged(client, delay, async (page) => {
      const payload = record(
        await client.getJson(
          `https://vacancies-api.sbermarket.ru/api/vacancy_pagination/?page=${page + 1}`,
        ),
      );
      let pages = 1;
      let vacancies: unknown[] = [];
      for (const block of items(payload.result).map(record)) {
        if (text(block.category) === 'pagination') pages = numeric(record(block.data).pages) ?? 1;
        if (text(block.category) === 'vacancies') vacancies = items(block.data);
      }
      const rows = vacancies.map(record).map((v): Row => ({
        externalId: text(v.id),
        title: text(v.title),
        url: `https://kuper.ru/rabota/${text(v.friendlyUrl)}-${text(v.idForUrl)}`,
        location: text(v.city),
        remote: items(v.wf).some((f) => REMOTE_RE.test(text(f))),
        description: text(v.description),
      }));
      return { rows, more: page + 1 < pages };
    }),
);

/* ------------------------------------------------------------- Домклик */
export const domclickFeed = feed(
  {
    id: 'domclick',
    name: 'Домклик — карьера',
    company: 'Домклик',
    market: 'Россия',
    homeUrl: 'https://career.domclick.ru/',
  },
  (client, delay) =>
    paged(client, delay, async () => {
      const payload = record(await client.getJson('https://career.domclick.ru/api/v1/vacancy/'));
      const rows = items(payload.result)
        .map(record)
        .map((v): Row => ({
          externalId: text(v.slug),
          title: text(v.title),
          url: `https://career.domclick.ru/vacancy/${text(v.slug)}`,
          location: text(record(v.area).name),
          remote: items(record(v.vacancycontent).work_format).some((f) => text(f) === 'REMOTE'),
        }));
      return { rows, more: false };
    }),
);

/* ---------------------------------------------------------------- Додо */
export const dodoFeed = feed(
  {
    id: 'dodo',
    name: 'Додо — карьера',
    company: 'Додо',
    market: 'Россия',
    homeUrl: 'https://dodoteam.ru/',
  },
  (client, delay) =>
    paged(client, delay, async () => {
      const payload = record(
        await client.getJson('https://job-site-backend.dodo-ai-platform.io/api/v1/vacancies'),
      );
      const rows = items(payload.data)
        .flatMap((group) => items(record(group).items))
        .map(record)
        .map((v): Row => {
          const brand = text(v.brand);
          return {
            externalId: text(v.id),
            title: text(v.position),
            url: `https://dodoteam.ru/vacancy/${text(v.id)}`,
            company: brand === 'Engineering' ? 'Dodo Engineering' : brand || undefined,
            location: text(v.vacancy_location),
            remote: items(v.work_format).some((f) => REMOTE_RE.test(text(f))),
          };
        });
      return { rows, more: false };
    }),
);

/* ----------------------------------------------------------------- RWB */
export const rwbFeed = feed(
  {
    id: 'rwb',
    name: 'RWB (Wildberries) — карьера',
    company: 'Wildberries',
    market: 'Россия',
    homeUrl: 'https://career.rwb.ru/vacancies',
    // Анти-бот отвечает 403 на частые запросы (замер 10.11).
    pageDelayMs: 2_000,
  },
  async (client, delay) => {
    let offset = 0;
    return paged(client, delay, async () => {
      const data = record(
        record(
          await client.getJson(
            `https://career.rwb.ru/crm-api/api/v1/pub/vacancies?limit=50&offset=${offset}`,
          ),
        ).data,
      );
      const rows = items(data.items)
        .map(record)
        .map((v): Row => {
          const modes = items(v.employment_types).map((e) => text(record(e).title));
          return {
            externalId: text(v.id),
            title: text(v.name),
            url: `https://career.rwb.ru/vacancies/${text(v.id)}`,
            location: text(v.city_title),
            remote: modes.some((m) => REMOTE_RE.test(m)),
          };
        });
      // Лента режет `limit` до 50: шаг — по полученным записям.
      offset += rows.length;
      return { rows, more: offset < (numeric(record(data.range).count) ?? 0) };
    });
  },
);

/* ------------------------------------------------------------ МТС Линк */
export const mtslinkFeed = feed(
  {
    id: 'mtslink',
    name: 'МТС Линк — карьера',
    company: 'МТС Линк',
    market: 'Россия',
    homeUrl: 'https://mts-link.ru/vacancies/',
  },
  (client, delay) =>
    paged(client, delay, async () => {
      const list = items(await client.getJson('https://mts-link.ru/api/huntflow/vacancies'));
      const rows = list
        .map(record)
        .filter((v) => text(v.state) === 'OPEN' && v.hidden !== true)
        .map((v): Row => ({
          externalId: text(v.id),
          title: text(v.position),
          url: `https://mts-link.ru/vacancies/${text(v.id)}/`,
          remote: REMOTE_RE.test(text(v.workFormat)),
          description: [v.body, v.requirements, v.conditions].map(text).join('\n'),
          publishedAt: v.created ? fromLooseDate(record(v.created).date) : undefined,
        }));
      return { rows, more: false };
    }),
);

export const RUSSIAN_COMPANY_FEEDS: readonly FreehireFeed[] = [
  sberFeed,
  yandexFeed,
  ozonFeed,
  vkFeed,
  x5Feed,
  magnitFeed,
  rostelecomFeed,
  lamodaFeed,
  kuperFeed,
  domclickFeed,
  dodoFeed,
  rwbFeed,
  mtslinkFeed,
];
