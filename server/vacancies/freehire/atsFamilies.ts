import type { DetailTextSource } from '../detailTextSources';
import { htmlToFeedText } from '../../connectors/feedText';
import { asArray, fromIso, numeric, record, text } from '../jsonVacancyRecord';
import { feed, REMOTE_RE, type FreehireFeed, type Row } from './feedKit';
import { sitemapFeed } from './sitemapJsonLdFeed';
import type { JsonLdPosting } from './jsonLdPosting';

/**
 * ATS, которых у нас не было (B641, третья очередь): iCIMS, Jobvite, Oracle
 * Recruiting Cloud. Перенос `icims.go`, `jobvite.go`, `oracle.go` проекта
 * github.com/strelov1/freehire (MIT, © 2026 freehire contributors).
 *
 * - iCIMS: sitemap доски называет вакансии, страница — оболочка, а фрагмент
 *   `?in_iframe=1` отдаёт JobPosting.
 * - Jobvite: страница `/jobs` перечисляет все вакансии ссылками, страница
 *   вакансии несёт JobPosting; работодатель — сама доска.
 * - Oracle: публичный JSON списка требований, текст — в карточке.
 */
export interface AtsBoardEntry {
  readonly provider: 'icims' | 'jobvite' | 'oracle';
  /** iCIMS и Jobvite — слаг; Oracle — `host/site`. */
  readonly board: string;
  readonly company: string;
  /** Вакансий в живом ответе при проверке доски. */
  readonly jobs: number;
}

const slugId = (board: string): string => board.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function atsFeedId(entry: Pick<AtsBoardEntry, 'provider' | 'board'>): string {
  return `${entry.provider}-${slugId(entry.board)}`;
}

function icimsFeed(entry: AtsBoardEntry): FreehireFeed {
  return sitemapFeed({
    id: atsFeedId(entry),
    name: `${entry.company} (iCIMS)`,
    company: entry.company,
    market: 'Международный',
    sitemapUrl: `https://careers-${entry.board}.icims.com/sitemap.xml`,
    vacancyPattern: /\/jobs\/(\d+)\//,
    postingUrl: (url) => `${url.split('?')[0]}?in_iframe=1`,
    boardOwnsCompany: true,
  });
}

const between = (html: string, start: RegExp, end: RegExp): string => {
  const from = html.search(start);
  if (from < 0) return '';
  const rest = html.slice(from).replace(start, '');
  const to = rest.search(end);
  return to < 0 ? rest : rest.slice(0, to);
};

/** Страница Jobvite без JobPosting: заголовок, место и текст из разметки доски. */
export function jobviteHtmlPosting(html: string): JsonLdPosting | undefined {
  const title = htmlToFeedText(between(html, /<h2[^>]*class="jv-header"[^>]*>/, /<\/h2>/)).trim();
  if (!title) return undefined;
  const meta = htmlToFeedText(between(html, /<p[^>]*class="jv-job-detail-meta"[^>]*>/, /<\/p>/))
    .split(/\n+/)
    .map((part) => part.trim().replace(/,$/, ''))
    .filter((part) => part && !/^Req\.?\s*Num/i.test(part));
  const description = between(
    html,
    /<div[^>]*class="jv-job-detail-description"[^>]*>/,
    /<div[^>]*class="jv-job-detail-bottom-actions"/,
  );
  return {
    title,
    company: '',
    description,
    location: meta.slice(1).join(', '),
    datePosted: '',
    remote: /remote/i.test(meta.join(' ')),
    identifier: '',
  };
}

function jobviteFeed(entry: AtsBoardEntry): FreehireFeed {
  return sitemapFeed({
    id: atsFeedId(entry),
    name: `${entry.company} (Jobvite)`,
    company: entry.company,
    market: 'Международный',
    sitemapUrl: `https://jobs.jobvite.com/${entry.board}/jobs`,
    listing: 'html',
    vacancyPattern: /\/job\/([A-Za-z0-9]+)(?:[/?#]|$)/,
    boardOwnsCompany: true,
    fallbackPosting: jobviteHtmlPosting,
  });
}

const ORACLE_PAGE = 100;

function oracleListUrl(host: string, site: string, offset: number): string {
  return (
    `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
    `?onlyData=true&expand=requisitionList.secondaryLocations` +
    // offset — внутри finder: верхний `&offset=` Oracle молча игнорирует (freehire).
    `&finder=findReqs;siteNumber=${site},limit=${ORACLE_PAGE},offset=${offset},sortBy=POSTING_DATES_DESC`
  );
}

/** Новых строк Oracle за опрос (по аналогии с sitemap, B641): крупная доска набирается за несколько опросов. */
export const ORACLE_ROWS_PER_POLL = 1_500;

interface OracleCursor {
  offset: number;
  rows: Map<string, Row>;
}

/** Прочитанное по доскам Oracle между опросами одного процесса. */
const oracleCursors = new Map<string, OracleCursor>();

export function resetOracleCursors(): void {
  oracleCursors.clear();
}

function oracleRow(host: string, site: string, r: Record<string, unknown>): Row {
  return {
    externalId: text(r.Id),
    title: text(r.Title),
    url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${text(r.Id)}`,
    location: text(r.PrimaryLocation),
    remote: REMOTE_RE.test(text(r.WorkplaceTypeCode)),
    publishedAt: fromIso(r.PostedDate),
  };
}

/**
 * Читает с курсора не больше ORACLE_ROWS_PER_POLL строк. Пока доска не дочитана —
 * частичное чтение только новых строк; дочитав, отдаёт полный срез и начинает новый круг.
 */
function oracleFeed(entry: AtsBoardEntry): FreehireFeed {
  const [host = '', site = ''] = entry.board.split('/');
  return feed(
    {
      id: atsFeedId(entry),
      name: `${entry.company} (Oracle)`,
      company: entry.company,
      market: 'Международный',
      homeUrl: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/jobs`,
    },
    async (client, delay) => {
      const cursor = oracleCursors.get(entry.board) ?? { offset: 0, rows: new Map() };
      oracleCursors.set(entry.board, cursor);
      const fresh: Row[] = [];
      let total = Number.POSITIVE_INFINITY;
      while (fresh.length < ORACLE_ROWS_PER_POLL && cursor.offset < total) {
        if (cursor.offset > 0 || fresh.length > 0) await client.pause(delay);
        let payload: unknown;
        try {
          payload = await client.getJson(oracleListUrl(host, site, cursor.offset));
        } catch (error) {
          // Первая страница опроса падает громко; дальше — отдаём уже прочитанное.
          if (fresh.length === 0) throw error;
          break;
        }
        const first = record(asArray(record(payload).items)?.[0]);
        total = numeric(first.TotalJobsCount) ?? 0;
        const rows = (asArray(first.requisitionList) ?? [])
          .map(record)
          .map((r) => oracleRow(host, site, r));
        if (rows.length === 0) break;
        cursor.offset += rows.length;
        for (const row of rows) cursor.rows.set(row.externalId, row);
        fresh.push(...rows);
      }
      if (cursor.offset < total) return { rows: fresh, partial: true };
      oracleCursors.delete(entry.board);
      return { rows: [...cursor.rows.values()], partial: false };
    },
  );
}

export function atsBoardFeed(entry: AtsBoardEntry): FreehireFeed {
  if (entry.provider === 'icims') return icimsFeed(entry);
  if (entry.provider === 'jobvite') return jobviteFeed(entry);
  return oracleFeed(entry);
}

/** Карточка Oracle: текст по публичной ссылке `/sites/<site>/job/<id>`. */
export const ORACLE_DETAIL: DetailTextSource = {
  format: 'json',
  detailUrl: (_sourceId, vacancy) => {
    try {
      const url = new URL(vacancy.url);
      const m = url.pathname.match(
        /^\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/(\w+)\/job\/(\d+)$/,
      );
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.oraclecloud.com') || !m) {
        return undefined;
      }
      return (
        `${url.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
        `?expand=all&onlyData=true&finder=ById;Id=%22${m[2]}%22,siteNumber=${m[1]}`
      );
    } catch {
      return undefined;
    }
  },
  readText: (payload) => {
    const d = record(asArray(record(payload).items)?.[0]);
    return ['ExternalDescriptionStr', 'ExternalResponsibilitiesStr', 'ExternalQualificationsStr']
      .map((key) => text(d[key]))
      .filter((part) => part.trim())
      .map((part) => htmlToFeedText(part).trim())
      .join('\n\n');
  },
  intervalMs: 3_000,
  intervalJitterMs: 2_000,
  throttlePauseMs: 600_000,
};
