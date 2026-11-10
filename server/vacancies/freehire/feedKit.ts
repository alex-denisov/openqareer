import type { UnifiedVacancy } from '../../domain/unifiedVacancy';
import { buildJsonVacancy, numeric, type JsonAdapterContext } from '../jsonVacancyRecord';
import type { FeedClient } from './feedClient';

/**
 * Общий каркас лент freehire (B641): постраничное чтение и сборка карточки.
 * Перенос `fetchDetails`/пагинации из github.com/strelov1/freehire (MIT).
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

export const PAGE_DELAY_MS = 700;
const MAX_PAGES = 200;

export interface Row {
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

export const REMOTE_RE = /удал|remote|дистанц/i;

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

export function rubSalary(from: unknown, to: unknown): UnifiedVacancy['salary'] {
  const lo = numeric(from);
  const hi = numeric(to);
  if (lo === undefined && hi === undefined) return undefined;
  return { from: lo, to: hi, currency: 'RUB', period: 'month' };
}

/** Постраничный список: `fetchPage(n)` → записи и признак «есть ещё». */
export async function paged(
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

export function feed(
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
