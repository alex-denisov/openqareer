import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminConsole } from '../src/features/admin/AdminConsole';
import { LandingPage } from '../src/features/site/LandingPage';
import { LegalDocumentPage, legalDocumentTitle } from '../src/features/legal/LegalDocumentPage';
import { buildLlmsFullTxt, buildLlmsTxt } from '../shared/aeoSurface';
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
  return html
    .replace(/<title>[^<]*<\/title>/u, `<title>${escapeHtml(legalDocumentTitle(slug))}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/u,
      `<meta name="description" content="${escapeHtml(description)}">`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*">/u,
      `<link rel="canonical" href="${SITE_ORIGIN}${legalPath(slug)}">`,
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

function bootstrapRoot(markup: string): string {
  return (
    `<div id="root" aria-busy="true">` +
    `<div class="career-bootstrap-shell" data-bootstrap-shell="true" inert>` +
    markup +
    '</div></div>'
  );
}

/**
 * Two documents, one bundle.
 *
 * The public root `/` delivers the indexed landing page with semantic H1,
 * structured JSON-LD and instant first paint.
 * The administrator console `/admin` has its own prerendered first paint.
 */
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
      bootstrapRoot(renderToStaticMarkup(<LandingPage onNavigate={() => {}} />)),
    ),
  );
  // The console's own pending state, rendered by the console itself, so the
  // first paint and the mounted screen cannot drift apart.
  await writeFile(
    adminPath,
    html.replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<AdminConsole sessionPending />)),
    ),
  );
  // Each legal document is its own indexed page with its own first paint, so a
  // crawler reads the text rather than the workspace bootstrap (B173).
  for (const doc of LEGAL_DOCS) {
    await writeFile(
      `${distDirectory}/${legalDocumentFileName(doc.slug)}`,
      legalHead(html, doc.slug, doc.description).replace(
        EMPTY_ROOT,
        bootstrapRoot(
          renderToStaticMarkup(<LegalDocumentPage slug={doc.slug} onNavigate={() => {}} />),
        ),
      ),
    );
  }
  const sitemap = buildSitemap();
  assertSitemapUrlPolicy(sitemapUrls(sitemap));
  await writeFile(`${distDirectory}/sitemap.xml`, sitemap);
  // Витрина для ИИ-поисковиков собирается из того же источника, что и продукт,
  // поэтому расхождение с ним невозможно (B209).
  await writeFile(`${distDirectory}/llms.txt`, buildLlmsTxt());
  await writeFile(`${distDirectory}/llms-full.txt`, buildLlmsFullTxt());
}

const directPath = process.argv[1];
if (directPath && import.meta.url === pathToFileURL(directPath).href) {
  const indexPath = process.argv[2] ?? 'dist/index.html';
  const adminPath = process.argv[3] ?? 'dist/admin.html';
  await prerenderShells(indexPath, adminPath);
  process.stdout.write(
    `prerendered career shell into ${indexPath}, administrator console into ${adminPath} and ${LEGAL_DOCS.length} legal documents with a sitemap\n`,
  );
}
