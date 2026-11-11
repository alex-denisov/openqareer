/**
 * Публичный каталог вакансий (B209, срез 2).
 *
 * Маршруты без сессии: каталог, который нельзя открыть без входа, — не
 * каталог, и поисковик его не увидит. HTML собирается на запросе, потому что
 * пул меняется каждый час, а сборка неизменяема.
 */
import { isCardInRollout } from '../seo/catalogCardRolloutReader';
import { readCatalogRuSummary } from '../seo/catalogRuSummaryReader';
import { searchIndexFor } from '../vacancies/vacancyCatalogSearch';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CATALOG_ROOT,
  listingPath,
  parseListingPath,
  parseVacancyPath,
  vacancyKey,
} from '../../shared/vacancyCatalogRoutes';
import {
  CATALOG_PAGE_SIZE,
  buildCatalogPage,
  buildCatalogPageFromEntries,
  buildListingPage,
  buildListingPageFromEntries,
  buildVacancyDetail,
  type RuSummaryReader,
  catalogEntries,
  type CatalogPage,
} from '../vacancies/vacancyCatalogPage';
import {
  MIN_LISTING_SIZE,
  catalogListings,
  listingEntries,
  type CatalogListingSummary,
} from '../vacancies/vacancyCatalogFacets';
import { nearbyListings, smallListingSummary } from '../vacancies/catalogNearbyListings';
import { isIndexableListing } from '../seo/catalogIndexing';
import {
  catalogFilterGroups,
  catalogFilterGroupsFromListings,
} from '../vacancies/vacancyCatalogFilters';
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  type CatalogEntriesPage,
} from '../vacancies/vacancyCatalogProjection';
import {
  renderCatalogDocument,
  renderGoneDocument,
  renderVacancyDocument,
} from '../vacancies/vacancyCatalogDocument';
import { getCatalogSitemaps, getListingHistory } from '../seo/catalogSitemapSchedule';
import { isValidIndexNowKey } from '../seo/indexNow';
import { renderSitemapIndex, type SitemapFile } from '../seo/sitemapXml';
import { liveJobsXml } from '../seo/liveSitemap';
import {
  RELOCATION_LIST_KEY,
  RELOCATION_PLACE,
  parseListingChip,
  type CatalogChip,
} from '../vacancies/catalogChips';
import { salaryStatsKey } from '../vacancies/catalogSalaryStatsStore';
import type { RouteDeps } from './deps';
import { withDeps } from './helpers';

function sendDocument(reply: FastifyReply, html: string, status = 200): FastifyReply {
  return (
    reply
      .status(status)
      .header('Content-Type', 'text/html; charset=utf-8')
      // Пул обновляется опросом, поэтому страница живёт минуты, а не год.
      .header('Cache-Control', 'public, max-age=300')
      .send(html)
  );
}

function pageNumber(request: FastifyRequest): number {
  const raw = (request.params as { page?: string }).page;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Фильтры считаются по всему каталогу, а не по выбранному списку.
 *
 * Иначе со страницы «Берлин» нельзя было бы уйти ни в какое другое место: в
 * выбранных записях других мест нет по определению, и «сузить» превращалось бы
 * в «остаться здесь» (B209, срез 2b).
 */
function filtersFor(
  entries: readonly ReturnType<typeof catalogEntries>[number][],
  current?: { place: string; role?: string },
) {
  return catalogFilterGroups(entries, current);
}

function filtersForListings(
  listings: readonly CatalogListingSummary[],
  current?: { place: string; role?: string },
) {
  return catalogFilterGroupsFromListings(listings, current);
}

function queryValue(request: FastifyRequest, name: string): unknown {
  return (request.query as Record<string, unknown> | undefined)?.[name];
}

function cursorOf(request: FastifyRequest) {
  return decodeCatalogCursor(queryValue(request, 'after'));
}

/**
 * Pages after the first exist only behind a cursor (`?after=`). A bare
 * `/page/12` or `?page=12` used to answer 200 with a copy of page 1 (SEO
 * review, round 4); it now moves permanently to the list's first page.
 */
function cursorlessPageTarget(
  request: FastifyRequest,
  basePath: string,
  pathPage: number | undefined,
): string | null {
  if (cursorOf(request)) return null;
  const pageQuery = queryValue(request, 'page');
  return (pathPage !== undefined && pathPage > 1) || pageQuery !== undefined ? basePath : null;
}

function withCursor(
  path: string,
  cursor: ReturnType<typeof decodeCatalogCursor>,
  chip?: CatalogChip,
): string {
  const query = [
    ...(chip ? [`f=${chip}`] : []),
    ...(cursor ? [`after=${encodeCatalogCursor(cursor)}`] : []),
  ];
  return query.length > 0 ? `${path}?${query.join('&')}` : path;
}

/**
 * A page behind a cursor is a crawl path to the cards, not a page for the index:
 * the cursor moves with every new vacancy, so it points its canonical at the
 * first page (the bare /page/N is a 301) and never enters the sitemap. 11.11:
 * no noindex on a live page (owner decision).
 */
function cursorPageView(
  page: CatalogPage,
  cursor: ReturnType<typeof decodeCatalogCursor>,
  firstPagePath: string,
): CatalogPage {
  return cursor ? { ...page, canonicalPath: firstPagePath, indexable: false } : page;
}

function projectedPage(
  page: CatalogEntriesPage,
  requestedPage: number,
  listing?: CatalogListingSummary,
  chip?: CatalogChip,
): CatalogPage {
  if (listing && chip) {
    // B574: a chip narrows the list; the unfiltered list stays the indexed one.
    const {
      nextPath: _next,
      previousPath: _previous,
      ...built
    } = projectedPage(page, requestedPage, listing);
    return {
      ...built,
      indexable: false,
      canonicalPath: listing.path,
      ...(page.nextCursor ? { nextPath: withCursor(listing.path, page.nextCursor, chip) } : {}),
    };
  }
  if (listing) {
    const built = buildListingPageFromEntries(
      page.items,
      {
        place: listing.place,
        placeLabel: listing.placeLabel,
        ...(listing.role ? { role: listing.role, roleLabel: listing.roleLabel } : {}),
        path: listing.path,
        count: listing.count,
      },
      requestedPage,
      page.total,
    );
    return page.nextCursor
      ? {
          ...built,
          nextPath: withCursor(built.nextPath ?? listing.path, page.nextCursor),
        }
      : built;
  }
  const built = buildCatalogPageFromEntries(page.items, requestedPage, page.total);
  return page.nextCursor
    ? { ...built, nextPath: withCursor(built.nextPath ?? CATALOG_ROOT, page.nextCursor) }
    : built;
}

async function handleCatalog(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const pathPage = (request.params as { page?: string }).page ? pageNumber(request) : undefined;
  const redirect = cursorlessPageTarget(request, CATALOG_ROOT, pathPage);
  if (redirect) return reply.redirect(redirect, 301);
  const cursor = cursorOf(request);
  const projected = deps.multiSourceEngine.getPublicCatalogEntriesPage({
    limit: CATALOG_PAGE_SIZE,
    ...(cursor ? { after: cursor } : {}),
  });
  const projectedListings = deps.multiSourceEngine.getPublicCatalogListings();
  if (projected && projectedListings) {
    const requestedPage = cursor ? pageNumber(request) : 1;
    return sendDocument(
      reply,
      renderCatalogDocument(
        cursorPageView(projectedPage(projected, requestedPage), cursor, CATALOG_ROOT),
        filtersForListings(projectedListings),
      ),
    );
  }
  const clusters = deps.multiSourceEngine.getPublicCatalogClusters();
  const page = buildCatalogPage(clusters, pageNumber(request));
  return sendDocument(reply, renderCatalogDocument(page, filtersFor(catalogEntries(clusters))));
}

/** B574: a list page, narrowed by `?f=` when that chip has vacancies behind it. */
function listingEntriesPage(
  deps: RouteDeps,
  request: FastifyRequest,
  listing: { place: string; role?: string },
  cursor: ReturnType<typeof cursorOf>,
) {
  const listKey = salaryStatsKey(listing);
  const counts = deps.multiSourceEngine.getPublicCatalogChipCounts(listKey);
  const wanted = parseListingChip(queryValue(request, 'f'));
  const chip = wanted && (counts[wanted] ?? 0) > 0 ? wanted : undefined;
  const after = cursor ? { after: cursor } : {};
  const projected = chip
    ? deps.multiSourceEngine.getPublicCatalogChipPage({
        listKey,
        chip,
        limit: CATALOG_PAGE_SIZE,
        ...after,
      })
    : deps.multiSourceEngine.getPublicCatalogEntriesPage({
        limit: CATALOG_PAGE_SIZE,
        ...after,
        place: listing.place,
        ...(listing.role ? { role: listing.role } : {}),
      });
  return { counts, chip, projected };
}

/**
 * Список по месту и роли (03.11).
 * - Есть хотя бы одна вакансия — `200`. Ниже порога публикации страница
 *   честно говорит, что вакансий мало, и ведёт на соседние списки.
 * - Индексируется по порогу, а однажды проиндексированный — ещё 30 дней,
 *   пока в нём есть вакансия (`isIndexableListing`): раньше страница у порога
 *   каждый день переключалась index/noindex/410.
 * - Опустевший список, который мы публиковали, — `301` на место, место — на
 *   каталог. Адрес, которого никогда не было, уходит дальше и отвечает `410`.
 */
function handleProjectedListing(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  listing: ReturnType<typeof parseListingPath>,
): FastifyReply | undefined {
  if (!listing) return undefined;
  const projectedListings = deps.multiSourceEngine.getPublicCatalogListings();
  if (!projectedListings) return undefined;
  const cursor = cursorOf(request);
  const { counts, chip, projected } = listingEntriesPage(deps, request, listing, cursor);
  if (!projected) return undefined;
  const history = getListingHistory(listing.place, listing.role);
  if (projected.total === 0) {
    return history ? reply.redirect(emptiedListingTarget(deps, listing), 301) : undefined;
  }
  const published = projectedListings.find(
    (candidate) =>
      candidate.place === listing.place && (candidate.role ?? undefined) === listing.role,
  );
  const summary = published ?? smallListingSummary(listing, projected.items, projected.total);
  if (!summary) return undefined;
  const requestedPage = cursor ? (listing.page ?? 1) : 1;
  const built = projectedPage(projected, requestedPage, summary, chip);
  const page = chip ? built : cursorPageView(built, cursor, summary.path);
  // A chip page counts the chip; the listing itself is the unfiltered total.
  const total = chip ? summary.count : projected.total;
  return sendDocument(
    reply,
    renderCatalogDocument(
      {
        ...page,
        indexable:
          !chip && !cursor && isIndexableListing(total, Boolean(listing.role), history, new Date()),
      },
      filtersForListings(projectedListings, {
        place: listing.place,
        ...(listing.role ? { role: listing.role } : {}),
      }),
      {
        stats: deps.multiSourceEngine.getPublicCatalogSalaryStats({
          place: listing.place,
          ...(listing.role ? { role: listing.role } : {}),
        }),
        chips: { counts, ...(chip ? { active: chip } : {}), path: summary.path },
        ...(total < MIN_LISTING_SIZE ? { nearby: nearbyListings(projectedListings, listing) } : {}),
      },
    ),
  );
}

/** A role list moves to its place while the place has a vacancy, else to the catalog. */
function emptiedListingTarget(
  deps: RouteDeps,
  listing: NonNullable<ReturnType<typeof parseListingPath>>,
): string {
  if (!listing.role) return CATALOG_ROOT;
  const place = deps.multiSourceEngine.getPublicCatalogEntriesPage({
    limit: 1,
    place: listing.place,
  });
  return place && place.total > 0 ? (listingPath(listing.place) ?? CATALOG_ROOT) : CATALOG_ROOT;
}

/**
 * B574: `/vacancies/relocation` — vacancies that mention relocation, over the
 * whole catalog. The maintenance process writes the list; empty means 410.
 */
function handleRelocation(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  listing: NonNullable<ReturnType<typeof parseListingPath>>,
): FastifyReply | undefined {
  const count = deps.multiSourceEngine.getPublicCatalogChipCounts(RELOCATION_LIST_KEY).relocation;
  if (!count) return undefined;
  const cursor = cursorOf(request);
  const projected = deps.multiSourceEngine.getPublicCatalogChipPage({
    listKey: RELOCATION_LIST_KEY,
    chip: 'relocation',
    limit: CATALOG_PAGE_SIZE,
    ...(cursor ? { after: cursor } : {}),
  });
  if (!projected) return undefined;
  const summary: CatalogListingSummary = {
    place: RELOCATION_PLACE,
    placeLabel: 'С релокацией',
    path: listingPath(RELOCATION_PLACE) ?? `${CATALOG_ROOT}/${RELOCATION_PLACE}`,
    count,
  };
  const listings = deps.multiSourceEngine.getPublicCatalogListings() ?? [];
  return sendDocument(
    reply,
    renderCatalogDocument(
      cursorPageView(
        projectedPage(projected, cursor ? (listing.page ?? 1) : 1, summary),
        cursor,
        summary.path,
      ),
      filtersForListings(listings),
    ),
  );
}

async function handleListing(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const listing = parseListingPath(request.url);
  const basePath = listing ? listingPath(listing.place, listing.role) : null;
  const redirect = basePath ? cursorlessPageTarget(request, basePath, listing?.page) : null;
  if (redirect) return reply.redirect(redirect, 301);
  if (listing?.place === RELOCATION_PLACE && !listing.role) {
    const relocationReply = handleRelocation(deps, request, reply, listing);
    if (relocationReply) return relocationReply;
  }
  const projectedReply = handleProjectedListing(deps, request, reply, listing);
  if (projectedReply) return projectedReply;
  const clusters = deps.multiSourceEngine.getPublicCatalogClusters();
  const entries = catalogEntries(clusters);
  const summary = listing
    ? catalogListings(entries).find(
        (candidate) =>
          candidate.place === listing.place && (candidate.role ?? undefined) === listing.role,
      )
    : undefined;

  if (!listing || !summary) {
    return sendDocument(reply, renderGoneDocument(buildCatalogPage(clusters, 1), 'listing'), 410);
  }

  const chosen = listingEntries(entries, listing);
  const chosenClusters = clusters.filter((cluster) =>
    chosen.some((entry) => entry.key === vacancyKey(cluster.id)),
  );
  const page = buildListingPage(chosenClusters, summary, listing.page ?? 1);
  return sendDocument(
    reply,
    renderCatalogDocument(
      page,
      filtersFor(entries, {
        place: listing.place,
        ...(listing.role ? { role: listing.role } : {}),
      }),
    ),
  );
}

/**
 * Пропавшая вакансия отвечает `410 Gone`, а не `200` с пустотой: `410` —
 * единственный ответ, по которому поисковик выбрасывает адрес из индекса
 * сразу, а не копит мёртвые ссылки на домене.
 */
/** One primary-key row per card page; the maintenance process writes the summaries. */
function ruSummaryReader(deps: RouteDeps): RuSummaryReader {
  return (card) => readCatalogRuSummary(deps.config.databasePath, card);
}

async function handleVacancy(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const key = parseVacancyPath(request.url);
  const projected = key ? deps.multiSourceEngine.getPublicCatalogEntry(key) : undefined;
  if (projected) {
    const found = deps.multiSourceEngine.getPublicCatalogCluster(projected.clusterId);
    const sourceId = found?.id.startsWith('cluster-')
      ? found.id.slice('cluster-'.length)
      : undefined;
    const full = sourceId ? deps.multiSourceEngine.getVacancy(sourceId) : undefined;
    const detail = found
      ? buildVacancyDetail(
          found,
          full?.fullDescription ?? full?.description,
          full,
          new Date(),
          ruSummaryReader(deps),
          (clusterId) => isCardInRollout(deps.config.databasePath, clusterId),
        )
      : null;
    // 11.11: the stored path is the one the sitemap and the lists link to; a slug
    // rebuilt from a since-cleaned title must not point the canonical elsewhere.
    if (detail) {
      const entry = { ...detail.entry, path: projected.path };
      return sendDocument(reply, renderVacancyDocument({ ...detail, entry }));
    }
    return sendDocument(
      reply,
      renderGoneDocument(buildCatalogPageFromEntries([projected], 1, 1)),
      410,
    );
  }
  const clusters = deps.multiSourceEngine.getPublicCatalogClusters();
  const found = key ? clusters.find((cluster) => vacancyKey(cluster.id) === key) : undefined;
  // Кластер несёт только первые 300 знаков описания. Полный текст лежит у
  // исходной вакансии — её идентификатор и есть хвост идентификатора кластера
  // (`cluster-<vacancyId>`), поэтому разметка и страница показывают то же
  // самое, что отдала площадка, а не обрывок на полуслове.
  const sourceId = found?.id.startsWith('cluster-') ? found.id.slice('cluster-'.length) : undefined;
  const full = sourceId ? deps.multiSourceEngine.getVacancy(sourceId) : undefined;
  const detail = found
    ? buildVacancyDetail(
        found,
        full?.fullDescription ?? full?.description,
        full,
        new Date(),
        ruSummaryReader(deps),
        (clusterId) => isCardInRollout(deps.config.databasePath, clusterId),
      )
    : null;

  if (!detail) {
    const page = buildCatalogPage(clusters, 1);
    return sendDocument(reply, renderGoneDocument(page), 410);
  }
  return sendDocument(reply, renderVacancyDocument(detail));
}

function sitemapFiles(): readonly SitemapFile[] {
  return getCatalogSitemaps() ?? [];
}

function sendXml(reply: FastifyReply, xml: string): FastifyReply {
  return reply
    .header('Content-Type', 'application/xml; charset=utf-8')
    .header('Cache-Control', 'public, max-age=900')
    .send(xml);
}

async function handleSitemapIndex(_deps: RouteDeps, _request: FastifyRequest, reply: FastifyReply) {
  return sendXml(reply, renderSitemapIndex(sitemapFiles()));
}

function sitemapFileHandler(name: (request: FastifyRequest) => string) {
  return async (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => {
    const wanted = name(request);
    const found = sitemapFiles().find((file) => file.name === wanted);
    if (!found) return reply.status(404).send({ error: 'not_found' });
    if (!found.name.startsWith('jobs-')) return sendXml(reply, found.xml);
    return sendXml(reply, liveJobsFile(deps, found));
  };
}

const LIVE_JOBS_TTL_MS = 60_000;
const liveJobsMemo = new Map<string, { source: string; xml: string; at: number }>();

/** 11.11: the job file minus cards closed since the build, with moved slugs followed. */
function liveJobsFile(deps: RouteDeps, file: SitemapFile): string {
  const cached = liveJobsMemo.get(file.name);
  const now = Date.now();
  if (cached && cached.source === file.xml && now - cached.at < LIVE_JOBS_TTL_MS) return cached.xml;
  const xml = liveJobsXml(file.xml, (key) => {
    const entry = deps.multiSourceEngine.getPublicCatalogEntry(key);
    return entry && deps.multiSourceEngine.getPublicCatalogCluster(entry.clusterId)
      ? entry.path
      : undefined;
  });
  liveJobsMemo.set(file.name, { source: file.xml, xml, at: now });
  return xml;
}

/** Cities and roles that have a public list, with counts, for the search box. */
async function handleSearchIndex(deps: RouteDeps, _request: FastifyRequest, reply: FastifyReply) {
  const listings = deps.multiSourceEngine.getPublicCatalogListings() ?? [];
  return reply
    .header('Cache-Control', 'public, max-age=300')
    .type('application/json; charset=utf-8')
    .send(searchIndexFor(listings));
}

export function registerVacancyCatalogRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(`${CATALOG_ROOT}/search-index.json`, withDeps(deps, handleSearchIndex));
  app.get(CATALOG_ROOT, withDeps(deps, handleCatalog));
  app.get(`${CATALOG_ROOT}/page/:page`, withDeps(deps, handleCatalog));
  app.get(`${CATALOG_ROOT}/job/:slug`, withDeps(deps, handleVacancy));
  // Списки по месту и роли, со своей постраничной навигацией (срез 2b).
  app.get(`${CATALOG_ROOT}/:place`, withDeps(deps, handleListing));
  app.get(`${CATALOG_ROOT}/:place/page/:page`, withDeps(deps, handleListing));
  app.get(`${CATALOG_ROOT}/:place/:role`, withDeps(deps, handleListing));
  app.get(`${CATALOG_ROOT}/:place/:role/page/:page`, withDeps(deps, handleListing));
  // Карта сайта живая, поэтому маршрут перекрывает файл сборки. Сама карта —
  // индекс дочерних файлов, подготовленных процессом обслуживания.
  app.get('/sitemap.xml', withDeps(deps, handleSitemapIndex));
  app.get(
    '/sitemaps/:name',
    withDeps(
      deps,
      sitemapFileHandler((request) => {
        const raw = (request.params as { name?: string }).name ?? '';
        return /^[a-z]+-[1-9]\d{0,3}\.xml$/u.test(raw) ? raw : '';
      }),
    ),
  );
  const indexNowKey = process.env.INDEXNOW_KEY?.trim() ?? '';
  if (isValidIndexNowKey(indexNowKey)) {
    app.get(`/${indexNowKey}.txt`, async (_request, reply) =>
      reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .send(indexNowKey),
    );
  }
}
