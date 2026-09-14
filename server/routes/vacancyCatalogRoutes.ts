/**
 * Публичный каталог вакансий (B209, срез 2).
 *
 * Маршруты без сессии: каталог, который нельзя открыть без входа, — не
 * каталог, и поисковик его не увидит. HTML собирается на запросе, потому что
 * пул меняется каждый час, а сборка неизменяема.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LEGAL_DOCS, LEGAL_PACK_PUBLISHED_AT, legalPath } from '../../shared/legalRegistry';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import {
  CATALOG_ROOT,
  catalogPagePath,
  parseListingPath,
  parseVacancyPath,
  vacancyKey,
} from '../../shared/vacancyCatalogRoutes';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import {
  CATALOG_PAGE_SIZE,
  buildCatalogPage,
  buildListingPage,
  buildVacancyDetail,
  catalogEntries,
} from '../vacancies/vacancyCatalogPage';
import { catalogListings, listingEntries } from '../vacancies/vacancyCatalogFacets';
import { catalogFilterGroups } from '../vacancies/vacancyCatalogFilters';
import {
  renderCatalogDocument,
  renderGoneDocument,
  renderVacancyDocument,
} from '../vacancies/vacancyCatalogDocument';
import type { RouteDeps } from './deps';
import { withDeps } from './helpers';

/** Сколько подборок печатать ссылками на странице. */

/** Предел протокола карты сайта — 50 000 адресов в одном файле. */
const SITEMAP_URL_LIMIT = 50_000;

function urlEntry(path: string, lastmod?: string): string {
  return `  <url><loc>${SITE_ORIGIN}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
}

/**
 * Карта сайта собирается на запросе: статический файл сборки не может
 * перечислить вакансии, которых на момент сборки ещё не было, и не может
 * убрать те, что уже пропали.
 */
export function buildCatalogSitemap(clusters: readonly VacancyCluster[]): string {
  const entries = catalogEntries(clusters);
  const pageCount = Math.max(1, Math.ceil(entries.length / CATALOG_PAGE_SIZE));

  const urls = [
    urlEntry('/'),
    ...LEGAL_DOCS.map((doc) => urlEntry(legalPath(doc.slug), LEGAL_PACK_PUBLISHED_AT)),
    urlEntry(CATALOG_ROOT),
    ...Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      urlEntry(catalogPagePath(index + 2)),
    ),
    // Списки по месту и роли — те самые страницы, по которым ищут (срез 2b).
    ...catalogListings(entries).map((listing) => urlEntry(listing.path)),
    ...entries.map((entry) => urlEntry(entry.path, entry.lastSeenAt.slice(0, 10))),
  ].slice(0, SITEMAP_URL_LIMIT);

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function sendDocument(reply: FastifyReply, html: string, status = 200): FastifyReply {
  return reply
    .status(status)
    .header('Content-Type', 'text/html; charset=utf-8')
    // Пул обновляется опросом, поэтому страница живёт минуты, а не год.
    .header('Cache-Control', 'public, max-age=300')
    .send(html);
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

async function handleCatalog(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const clusters = deps.multiSourceEngine.getActiveClusters();
  const page = buildCatalogPage(clusters, pageNumber(request));
  return sendDocument(reply, renderCatalogDocument(page, filtersFor(catalogEntries(clusters))));
}

/**
 * Список по месту и роли. Список, которого нет или который опустел ниже порога
 * публикации, отвечает `410`, а не пустой страницей: адрес, который мы сами же
 * перестали печатать, должен уйти из индекса, а не копиться.
 */
async function handleListing(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const listing = parseListingPath(request.url);
  const clusters = deps.multiSourceEngine.getActiveClusters();
  const entries = catalogEntries(clusters);
  const summary = listing
    ? catalogListings(entries).find(
        (candidate) =>
          candidate.place === listing.place && (candidate.role ?? undefined) === listing.role,
      )
    : undefined;

  if (!listing || !summary) {
    return sendDocument(reply, renderGoneDocument(buildCatalogPage(clusters, 1)), 410);
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
  const clusters = deps.multiSourceEngine.getActiveClusters();
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
  return sendDocument(reply, renderVacancyDocument(detail, full));
}

async function handleSitemap(deps: RouteDeps, _request: FastifyRequest, reply: FastifyReply) {
  return reply
    .header('Content-Type', 'application/xml; charset=utf-8')
    .header('Cache-Control', 'public, max-age=900')
    .send(buildCatalogSitemap(deps.multiSourceEngine.getActiveClusters()));
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
  // Карта сайта живая, поэтому маршрут перекрывает файл сборки.
  app.get('/sitemap.xml', withDeps(deps, handleSitemap));
}
