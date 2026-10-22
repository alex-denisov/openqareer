/**
 * Публичный каталог вакансий (B209, срез 2).
 *
 * Маршруты без сессии: каталог, который нельзя открыть без входа, — не
 * каталог, и поисковик его не увидит. HTML собирается на запросе, потому что
 * пул меняется каждый час, а сборка неизменяема.
 */
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
  catalogEntries,
} from '../vacancies/vacancyCatalogPage';
import {
  catalogListings,
  listingEntries,
  type CatalogListingSummary,
} from '../vacancies/vacancyCatalogFacets';
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
import { getCatalogSitemaps } from '../seo/catalogSitemapSchedule';
import { isValidIndexNowKey } from '../seo/indexNow';
import { renderSitemapIndex, type SitemapFile } from '../seo/sitemapXml';
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

function withCursor(path: string, cursor: ReturnType<typeof decodeCatalogCursor>): string {
  return cursor ? `${path}?after=${encodeCatalogCursor(cursor)}` : path;
}

function projectedPage(
  page: CatalogEntriesPage,
  requestedPage: number,
  listing?: CatalogListingSummary,
) {
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
        projectedPage(projected, requestedPage),
        filtersForListings(projectedListings),
      ),
    );
  }
  const clusters = deps.multiSourceEngine.getPublicCatalogClusters();
  const page = buildCatalogPage(clusters, pageNumber(request));
  return sendDocument(reply, renderCatalogDocument(page, filtersFor(catalogEntries(clusters))));
}

/**
 * Список по месту и роли. Список, которого нет или который опустел ниже порога
 * публикации, отвечает `410`, а не пустой страницей: адрес, который мы сами же
 * перестали печатать, должен уйти из индекса, а не копиться.
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
  const summary = projectedListings.find(
    (candidate) =>
      candidate.place === listing.place && (candidate.role ?? undefined) === listing.role,
  );
  if (!summary) return undefined;
  const cursor = cursorOf(request);
  const projected = deps.multiSourceEngine.getPublicCatalogEntriesPage({
    limit: CATALOG_PAGE_SIZE,
    ...(cursor ? { after: cursor } : {}),
    place: listing.place,
    ...(listing.role ? { role: listing.role } : {}),
  });
  if (!projected) return undefined;
  const requestedPage = cursor ? (listing.page ?? 1) : 1;
  return sendDocument(
    reply,
    renderCatalogDocument(
      projectedPage(projected, requestedPage, summary),
      filtersForListings(projectedListings, {
        place: listing.place,
        ...(listing.role ? { role: listing.role } : {}),
      }),
    ),
  );
}

async function handleListing(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const listing = parseListingPath(request.url);
  const basePath = listing ? listingPath(listing.place, listing.role) : null;
  const redirect = basePath ? cursorlessPageTarget(request, basePath, listing?.page) : null;
  if (redirect) return reply.redirect(redirect, 301);
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
      ? buildVacancyDetail(found, full?.fullDescription ?? full?.description, full)
      : null;
    if (detail) return sendDocument(reply, renderVacancyDocument(detail));
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
    ? buildVacancyDetail(found, full?.fullDescription ?? full?.description, full)
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
    return sendXml(reply, found.xml);
  };
}

export function registerVacancyCatalogRoutes(app: FastifyInstance, deps: RouteDeps): void {
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
    withDeps(deps, sitemapFileHandler((request) => {
      const raw = (request.params as { name?: string }).name ?? '';
      return /^[a-z]+-[1-9]\d{0,3}\.xml$/u.test(raw) ? raw : '';
    })),
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
