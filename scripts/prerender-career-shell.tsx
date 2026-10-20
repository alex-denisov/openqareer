import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminConsole } from '../src/features/admin/AdminConsole';
import { LandingPage } from '../src/features/site/LandingPage';
import {
  FAQ_DESCRIPTION,
  FAQ_TITLE,
  FaqPage,
  NOT_FOUND_TITLE,
  NotFoundPage,
  SUPPORT_DESCRIPTION,
  SUPPORT_TITLE,
  SupportPage,
} from '../src/features/site/PublicHelpPages';
import { deferEntryScript, landingTokenStats } from '../shared/landingStats';
import { LegalDocumentPage, legalDocumentTitle } from '../src/features/legal/LegalDocumentPage';
import { buildLlmsFullTxt, buildLlmsTxt } from '../shared/aeoSurface';
import { CATALOG_STYLE, CATALOG_STYLESHEET_PATH } from '../server/vacancies/vacancyCatalogDocument';
import { publicPathViolation } from '../shared/seoSlugPolicy';
import {
  LEGAL_DOCS,
  LEGAL_PACK_PUBLISHED_AT,
  legalPath,
  type LegalDocSlug,
} from '../shared/legalRegistry';

const SITE_ORIGIN = 'https://openqareer.com';

/** `dist/legal-<slug>.html` — one prerendered document per published text. */
export function legalDocumentFileName(slug: LegalDocSlug): string {
  return `legal-${slug}.html`;
}

/**
 * A legal page is indexed on its own terms: its own title, description and
 * canonical have to be in the served HTML, not applied after hydration.
 */
function legalHead(html: string, slug: LegalDocSlug, description: string): string {
  return pageHead(html, {
    path: legalPath(slug),
    title: legalDocumentTitle(slug),
    description,
  });
}

/** B535: /faq and /support carry their own title, description, canonical and og. */
export const HELP_PAGES = [
  { path: '/faq', file: 'faq.html', title: FAQ_TITLE, description: FAQ_DESCRIPTION },
  {
    path: '/support',
    file: 'support.html',
    title: SUPPORT_TITLE,
    description: SUPPORT_DESCRIPTION,
  },
] as const;

function helpHead(html: string, page: (typeof HELP_PAGES)[number]): string {
  return pageHead(html, page);
}

/** Title, description, canonical and the og/twitter copies of them. */
function pageHead(
  html: string,
  page: { readonly path: string; readonly title: string; readonly description: string },
): string {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const url = `${SITE_ORIGIN}${page.path}`;
  return html
    .replace(/<title>[^<]*<\/title>/u, `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/u,
      `<meta name="description" content="${description}">`,
    )
    .replace(/<link rel="canonical" href="[^"]*">/u, `<link rel="canonical" href="${url}">`)
    .replace(
      /<meta property="og:url" content="[^"]*">/u,
      `<meta property="og:url" content="${url}">`,
    )
    .replace(
      /(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]*/gu,
      `$1${title.replace(/\s+(?:·|\||&amp;#124;)\s+openqareer$/u, '')}`,
    )
    .replace(
      /(<meta (?:property|name)="(?:og|twitter):description" content=")[^"]*/gu,
      `$1${description}`,
    );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/** Every public URL this release publishes, newest documents included. */
export function buildSitemap(): string {
  const urls = [
    { loc: `${SITE_ORIGIN}/`, lastmod: undefined as string | undefined },
    ...HELP_PAGES.map((page) => ({
      loc: `${SITE_ORIGIN}${page.path}`,
      lastmod: undefined as string | undefined,
    })),
    ...LEGAL_DOCS.map((doc) => ({
      loc: `${SITE_ORIGIN}${legalPath(doc.slug)}`,
      lastmod: LEGAL_PACK_PUBLISHED_AT,
    })),
  ];
  const body = urls
    .map(
      (url) =>
        `  <url><loc>${url.loc}</loc>${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ''}</url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Адреса из готовой карты сайта — вход для сторожа политики адресов. */
export function sitemapUrls(sitemap: string): readonly string[] {
  return Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu), (match) => match[1] as string);
}

/**
 * B209 — правило владельца «только естественный английский URL, транслит
 * запрещён» держит сборка. Нарушение роняет её здесь, а не всплывает через
 * месяц в поисковой выдаче.
 */
export function assertSitemapUrlPolicy(urls: readonly string[]): void {
  for (const url of urls) {
    const violation = publicPathViolation(new URL(url).pathname);
    if (violation) throw new Error(`политика адресов нарушена: ${violation}`);
  }
}

const EMPTY_ROOT = '<div id="root"></div>';

/** Served with status 404 for addresses no surface owns (B535). */
export const NOT_FOUND_DOCUMENT = 'not-found.html';

/**
 * Первый кадр до JavaScript. Лендинг и правовые страницы — настоящие ссылки:
 * они обязаны работать сразу, пока части приложения ещё едут (на медленном
 * маршруте это 10–17 с, и владелец 2026-09-20 не мог нажать «Войти»). `inert`
 * остаётся только у консоли, где до гидратации нечего нажимать.
 */
function bootstrapRoot(markup: string, options: { inert?: boolean } = {}): string {
  const inert = options.inert ? ' inert' : '';
  return (
    `<div id="root" aria-busy="true">` +
    `<div class="career-bootstrap-shell" data-bootstrap-shell="true"${inert}>` +
    markup +
    '</div></div>'
  );
}

/** B535: /faq and /support are indexed documents with their own first paint. */
async function writeHelpPages(html: string, distDirectory: string): Promise<void> {
  await writeFile(
    `${distDirectory}/faq.html`,
    deferEntryScript(helpHead(html, HELP_PAGES[0])).replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<FaqPage onNavigate={() => {}} />)),
    ),
  );
  await writeFile(
    `${distDirectory}/support.html`,
    deferEntryScript(helpHead(html, HELP_PAGES[1])).replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<SupportPage onNavigate={() => {}} />)),
    ),
  );
}

/**
 * Two documents, one bundle.
 *
 * The public root `/` delivers the indexed landing page with semantic H1,
 * structured JSON-LD and instant first paint.
 * The administrator console `/admin` has its own prerendered first paint.
 */
/** Unknown addresses: the server answers 404 with this document (B535). */
async function writeNotFoundPage(html: string, distDirectory: string): Promise<void> {
  await writeFile(
    `${distDirectory}/${NOT_FOUND_DOCUMENT}`,
    deferEntryScript(
      pageHead(html, {
        path: '/',
        title: NOT_FOUND_TITLE,
        description: 'Страница не найдена. Перейдите на главную openqareer или в каталог вакансий.',
      }),
    )
      .replace(/<link rel="canonical"[^>]*>/u, '<meta name="robots" content="noindex">')
      .replace(
        EMPTY_ROOT,
        bootstrapRoot(renderToStaticMarkup(<NotFoundPage onNavigate={() => {}} />)),
      ),
  );
}

export async function prerenderShells(
  indexPath: string,
  adminPath: string,
  distDirectory = indexPath.replace(/\/[^/]+$/u, ''),
): Promise<void> {
  const html = await readFile(indexPath, 'utf8');
  if (!html.includes('id="root"')) {
    throw new Error('production root mount point is missing');
  }
  if (!html.includes(EMPTY_ROOT)) {
    throw new Error('production root mount point is not empty');
  }

  await writeFile(
    indexPath,
    html.replace(
      EMPTY_ROOT,
      bootstrapRoot(
        renderToStaticMarkup(<LandingPage onNavigate={() => {}} stats={landingTokenStats()} />),
      ),
    ),
  );
  // The console's own pending state, rendered by the console itself, so the
  // first paint and the mounted screen cannot drift apart.
  await writeFile(
    adminPath,
    html.replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<AdminConsole sessionPending />), { inert: true }),
    ),
  );
  // Each legal document is its own indexed page with its own first paint, so a
  // crawler reads the text rather than the workspace bootstrap (B173).
  for (const doc of LEGAL_DOCS) {
    await writeFile(
      `${distDirectory}/${legalDocumentFileName(doc.slug)}`,
      deferEntryScript(legalHead(html, doc.slug, doc.description)).replace(
        EMPTY_ROOT,
        bootstrapRoot(
          renderToStaticMarkup(<LegalDocumentPage slug={doc.slug} onNavigate={() => {}} />),
        ),
      ),
    );
  }
  await writeHelpPages(html, distDirectory);
  await writeNotFoundPage(html, distDirectory);

  // Карту сайта отдаёт сервер из живого пула (B209, срез 2), поэтому файла в
  // сборке больше нет. Постоянные адреса всё равно проверяются здесь: сборка
  // обязана падать на транслите до выката, а не после.
  assertSitemapUrlPolicy(sitemapUrls(buildSitemap()));
  // Витрина для ИИ-поисковиков собирается из того же источника, что и продукт,
  // поэтому расхождение с ним невозможно (B209).
  await writeFile(`${distDirectory}/llms.txt`, buildLlmsTxt());
  await writeFile(`${distDirectory}/llms-full.txt`, buildLlmsFullTxt());
  // Стиль публичного каталога — настоящий файл, а не инлайн: боевая политика
  // `style-src 'self'` инлайновый стиль не применит (B209).
  await mkdir(`${distDirectory}/assets`, { recursive: true });
  await writeFile(`${distDirectory}${CATALOG_STYLESHEET_PATH}`, CATALOG_STYLE);
}

const directPath = process.argv[1];
if (directPath && import.meta.url === pathToFileURL(directPath).href) {
  const indexPath = process.argv[2] ?? 'dist/index.html';
  const adminPath = process.argv[3] ?? 'dist/admin.html';
  await prerenderShells(indexPath, adminPath);
  process.stdout.write(
    `prerendered career shell into ${indexPath}, administrator console into ${adminPath} and ${LEGAL_DOCS.length} legal documents\n`,
  );
}
