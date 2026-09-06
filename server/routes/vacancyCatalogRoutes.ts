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
  parseVacancyPath,
  vacancyKey,
} from '../../shared/vacancyCatalogRoutes';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import {
  CATALOG_PAGE_SIZE,
  buildCatalogPage,
  buildVacancyDetail,
  catalogEntries,
} from '../vacancies/vacancyCatalogPage';
import {
  renderCatalogDocument,
  renderGoneDocument,
  renderVacancyDocument,
} from '../vacancies/vacancyCatalogDocument';
import type { RouteDeps } from './deps';
import { withDeps } from './helpers';

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

async function handleCatalog(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const page = buildCatalogPage(deps.multiSourceEngine.getActiveClusters(), pageNumber(request));
  return sendDocument(reply, renderCatalogDocument(page));
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
  const detail = found ? buildVacancyDetail(found) : null;

  if (!detail) {
    const page = buildCatalogPage(clusters, 1);
    return sendDocument(reply, renderGoneDocument(page), 410);
  }
  return sendDocument(reply, renderVacancyDocument(detail));
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
  // Карта сайта живая, поэтому маршрут перекрывает файл сборки.
  app.get('/sitemap.xml', withDeps(deps, handleSitemap));
}
