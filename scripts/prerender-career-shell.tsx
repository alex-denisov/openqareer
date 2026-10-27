import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';
import { pathToFileURL } from 'node:url';
import type { Manifest } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminConsole } from '../src/features/admin/AdminConsole';
import {
  CountryFitPage,
  COUNTRY_FIT_TITLE,
  COUNTRY_FIT_DESCRIPTION,
} from '../src/features/site/CountryFitPage';
import { ResumeBuilderPage } from '../src/features/site/resumeBuilder/ResumeBuilderPage';
import {
  RESUME_BUILDER_DESCRIPTION,
  RESUME_BUILDER_PATH,
  RESUME_BUILDER_PUBLISHED_AT,
  RESUME_BUILDER_TITLE,
} from '../src/features/site/resumeBuilder/resumeBuilderContent';
import {
  RELOCATION_DESCRIPTION,
  RELOCATION_TITLE,
  RelocationPage,
} from '../src/features/site/RelocationPage';
import { LoginPage, SignupPage } from '../src/features/site/AuthPages';
import { LandingPage } from '../src/features/site/LandingPage';
import { PublicHeader, PublicFooter } from '../src/features/site/PublicSiteChrome';
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
import { interviewSitemapUrls } from '../server/seo/sitemapXml';
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
export function pageHead(
  html: string,
  page: {
    readonly path: string;
    readonly title: string;
    readonly description: string;
    readonly shareDescription?: string;
  },
): string {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const shareDescription = escapeHtml(page.shareDescription ?? page.description);
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
      `$1${shareDescription}`,
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
    { loc: `${SITE_ORIGIN}/tools/country-fit`, lastmod: '2026-10-23' },
    { loc: `${SITE_ORIGIN}${RESUME_BUILDER_PATH}`, lastmod: RESUME_BUILDER_PUBLISHED_AT },
    ...interviewSitemapUrls().map((row) => ({
      loc: `${SITE_ORIGIN}${row.path}`,
      lastmod: row.lastmod as string | undefined,
    })),
    { loc: `${SITE_ORIGIN}/tools/relocation`, lastmod: '2026-10-27' },
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

/** 13 countries render twice as radio choices (target and comparison). */
const COUNTRY_FIT_DOCUMENT_BUDGET = 24_000;

/** The existing favicon is the same measured brand geometry as BrandMark. */
export function compactCountryFitDocument(document: string): string {
  return document
    .replace(/<!--[^]*?-->/gu, '')
    .replace(
      /<svg class="brand-lockup-sign"[^]*?<\/svg>/gu,
      '<img class="brand-lockup-sign" src="/favicon.svg" width="26" height="26" alt="" aria-hidden="true"/>',
    )
    .replace(/\n[ \t]*/gu, '');
}

async function writeCountryFitPage(html: string, distDirectory: string): Promise<void> {
  const document = compactCountryFitDocument(
    deferEntryScript(
      pageHead(html, {
        path: '/tools/country-fit',
        title: COUNTRY_FIT_TITLE,
        description: COUNTRY_FIT_DESCRIPTION,
        shareDescription:
          'Налоги и чистая зарплата за 2026 год в 13 странах. Расчёт со своими расходами.',
      }),
    ).replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<CountryFitPage onNavigate={() => {}} />)),
    ),
  );
  if (Buffer.byteLength(document) > COUNTRY_FIT_DOCUMENT_BUDGET) {
    throw new Error(
      `Country Fit document ${Buffer.byteLength(document)} exceeds the ${COUNTRY_FIT_DOCUMENT_BUDGET}-byte route budget`,
    );
  }
  await writeFile(`${distDirectory}/country-fit.html`, document);
}

/** B567: the builder renders its sample resume and copy before the bundle loads. */
const RESUME_BUILDER_DOCUMENT_BUDGET = 28_000;

async function writeResumeBuilderPage(
  html: string,
  distDirectory: string,
  styles: string,
): Promise<void> {
  const document = compactCountryFitDocument(
    deferEntryScript(
      withPageStyles(
        pageHead(html, {
          path: RESUME_BUILDER_PATH,
          title: RESUME_BUILDER_TITLE,
          description: RESUME_BUILDER_DESCRIPTION,
          shareDescription: 'Резюме по шагам с подсказками и проверкой на ATS. PDF и DOCX.',
        }),
        styles,
      ),
    ).replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<ResumeBuilderPage onNavigate={() => {}} />)),
    ),
  );
  if (Buffer.byteLength(document) > RESUME_BUILDER_DOCUMENT_BUDGET) {
    throw new Error(
      `Resume builder document ${Buffer.byteLength(document)} exceeds the ${RESUME_BUILDER_DOCUMENT_BUDGET}-byte route budget`,
    );
  }
  await writeFile(`${distDirectory}/resume-builder.html`, document);
}

/** B354: /tools/relocation ships its first paint with the example estimate. */
async function writeRelocationPage(
  html: string,
  distDirectory: string,
  styles: string,
): Promise<void> {
  const document = compactCountryFitDocument(
    deferEntryScript(
      withPageStyles(
        pageHead(html, {
          path: '/tools/relocation',
          title: RELOCATION_TITLE,
          description: RELOCATION_DESCRIPTION,
          shareDescription:
            'Пути переезда по работе в выбранные страны с официальными порогами 2026 года.',
        }),
        styles,
      ),
    ).replace(
      EMPTY_ROOT,
      bootstrapRoot(renderToStaticMarkup(<RelocationPage onNavigate={() => {}} />)),
    ),
  );
  await writeFile(`${distDirectory}/relocation.html`, document);
}

async function writeToolPages(
  html: string,
  distDirectory: string,
  manifest?: Manifest,
): Promise<void> {
  await writeCountryFitPage(html, distDirectory);
  await writeRelocationPage(html, distDirectory, pageStylesheets(manifest, 'relocationRoute'));
}

/** B535: /faq and /support are indexed documents with their own first paint. */
async function writeHelpPages(
  html: string,
  distDirectory: string,
  manifest?: Manifest,
): Promise<void> {
  await writeResumeBuilderPage(
    html,
    distDirectory,
    pageStylesheets(manifest, 'resumeBuilderRoute'),
  );
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

async function writeSalaryTemplate(html: string, distDirectory: string): Promise<void> {
  // Runtime salary SSR uses the built head/assets; it never embeds sample market data.
  await writeFile(
    `${distDirectory}/salary-market.html`,
    html
      .replace('/assets/oq-analytics-2.js', '/assets/oq-analytics-3.js')
      .replace(
        EMPTY_ROOT,
        renderToStaticMarkup(
          <div className="ps sm-public">
            <a className="ps-skip" href="#main">
              К содержимому
            </a>
            <PublicHeader onNavigate={() => {}} onLanding={false} signedIn={false} />
            {'%%SALARY_CONTENT%%'}
            <PublicFooter
              onNavigate={() => {}}
              onLanding={false}
              signedIn={false}
              interviewLink={false}
              toolLinks={false}
            />
          </div>,
        ),
      )
      .replace(/<script type="module"[^>]*><\/script>/gu, ''),
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
/** B535: sign-in pages carry their own title and stay out of the index. */
export const AUTH_PAGES = [
  {
    path: '/login',
    file: 'login.html',
    title: 'Вход в кабинет | openqareer',
    description:
      'Войдите в кабинет openqareer: профиль, подобранные вакансии, отклики и консультант.',
  },
  {
    path: '/signup',
    file: 'signup.html',
    title: 'Регистрация в openqareer: старт бесплатно',
    description:
      'Создайте аккаунт openqareer бесплатно: загрузите резюме, проверьте его на ATS и получите вакансии с процентом совпадения.',
  },
] as const;

/** Only exact files from Vite's emitted graph may become auth HTML hints. */
export function authResourceHints(manifest: Manifest): string {
  const asset = (file: unknown, extension: 'js' | 'css') => {
    if (
      typeof file !== 'string' ||
      !new RegExp(`^assets/[A-Za-z0-9_-]+\\.${extension}$`, 'u').test(file)
    ) {
      throw new Error('Invalid auth preload asset path');
    }
    return escapeHtml(`/${file}`);
  };
  const dynamicImports = manifest['index.html']?.dynamicImports;
  if (!Array.isArray(dynamicImports)) throw new Error('Missing entry build graph');
  const chunk = (name: string) => {
    const matches = dynamicImports
      .map((key) => manifest[key])
      .filter((entry) => entry?.name === name);
    if (matches.length !== 1) throw new Error(`Expected one emitted auth chunk: ${name}`);
    return matches[0];
  };
  const styleChunks = ['landing', 'auth'].map(chunk);
  const styles = styleChunks.flatMap((entry) => {
    const css = entry.css;
    if (!Array.isArray(css) || css.length === 0)
      throw new Error(`Missing emitted auth stylesheet: ${entry.name}`);
    return css.map((file) => asset(file, 'css'));
  });
  return [
    ...[chunk('AuthPages'), ...styleChunks].map(
      (entry) => `<link rel="modulepreload" crossorigin href="${asset(entry.file, 'js')}">`,
    ),
    ...[...new Set(styles)].map(
      (href) => `<link rel="preload" as="style" crossorigin href="${href}">`,
    ),
  ].join('');
}

/**
 * A tool page's own styles live in its lazy chunk, off the first-paint sheet
 * every public document loads (one 12 KiB delivery part). Its prerendered
 * document links that chunk's stylesheet, so the page never paints unstyled.
 */
export function pageStylesheets(manifest: Manifest | undefined, name: string): string {
  if (!manifest) return '';
  const dynamicImports = manifest['index.html']?.dynamicImports;
  if (!Array.isArray(dynamicImports)) throw new Error('Missing entry build graph');
  const matches = dynamicImports
    .map((key) => manifest[key])
    .filter((entry) => entry?.name === name);
  if (matches.length !== 1) throw new Error(`Expected one emitted page chunk: ${name}`);
  const css = matches[0].css;
  if (!Array.isArray(css) || css.length === 0)
    throw new Error(`Missing emitted page stylesheet: ${name}`);
  return css
    .map((file) => {
      if (typeof file !== 'string' || !/^assets\/[A-Za-z0-9_-]+\.css$/u.test(file))
        throw new Error('Invalid page stylesheet path');
      return `<link rel="stylesheet" crossorigin href="${escapeHtml(`/${file}`)}">`;
    })
    .join('');
}

function withPageStyles(html: string, styles: string): string {
  return styles ? html.replace('</head>', `${styles}</head>`) : html;
}

async function writeAuthFirstPaintStyles(distDirectory: string): Promise<string> {
  // Auth is a lazy route. Reuse its exact styles without putting the legacy
  // landing styles into every public document's initial CSS bundle.
  const source = (
    await Promise.all(
      ['landing.css', 'auth.css'].map((file) =>
        readFile(new URL(`../src/features/site/${file}`, import.meta.url), 'utf8'),
      ),
    )
  ).join('\n');
  // transform() does not bundle/rebase dependencies. Quoted @import paths
  // need this guard too; checking only url() would miss them.
  if (/@import\b|url\s*\(/iu.test(source)) {
    throw new Error('Auth first-paint styles must be self-contained before relocation');
  }
  const { code: css } = await transform(source, { loader: 'css', minify: true });
  if (Buffer.byteLength(css) > 20_000)
    throw new Error('Auth first-paint CSS exceeds the 20000-byte route budget');
  const path = `/assets/auth-first-paint-${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css`;
  await mkdir(`${distDirectory}/assets`, { recursive: true });
  await writeFile(`${distDirectory}${path}`, css);
  return path;
}

/**
 * Show the exact auth page before JavaScript, with disabled inputs and an inert
 * card. createRoot replaces this shell, so credentials cannot be entered early.
 */
async function writeAuthPages(html: string, distDirectory: string, hints: string): Promise<void> {
  const stylesheet = await writeAuthFirstPaintStyles(distDirectory);
  for (const page of AUTH_PAGES) {
    const document = pageHead(html, page)
      .replace('</head>', `${hints}<link rel="stylesheet" href="${stylesheet}"></head>`)
      .replace(
        /<link rel="canonical"[^>]*>/u,
        `<link rel="canonical" href="${SITE_ORIGIN}${page.path}"><meta name="robots" content="noindex, follow">`,
      )
      .replace(
        EMPTY_ROOT,
        bootstrapRoot(
          renderToStaticMarkup(
            <div className="ps ps-auth">
              {page.path === '/login' ? (
                <LoginPage onNavigate={() => {}} bootstrapPending />
              ) : (
                <SignupPage onNavigate={() => {}} bootstrapPending />
              )}
            </div>,
          ),
        ),
      );
    if (Buffer.byteLength(document) > 20_000) {
      throw new Error(`Auth document ${page.path} exceeds the 20000-byte route budget`);
    }
    await writeFile(`${distDirectory}/${page.file}`, document);
  }
}

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
  manifest?: Manifest,
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
  await writeHelpPages(html, distDirectory, manifest);
  await writeToolPages(html, distDirectory, manifest);
  await writeSalaryTemplate(html, distDirectory);
  await writeNotFoundPage(html, distDirectory);
  await writeAuthPages(html, distDirectory, manifest ? authResourceHints(manifest) : '');

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
  await writeFile(`${distDirectory}${CATALOG_STYLESHEET_PATH}`, CATALOG_STYLE);
}

const directPath = process.argv[1];
if (directPath && import.meta.url === pathToFileURL(directPath).href) {
  const indexPath = process.argv[2] ?? 'dist/index.html';
  const adminPath = process.argv[3] ?? 'dist/admin.html';
  const distDirectory = indexPath.replace(/\/[^/]+$/u, '');
  const manifest = JSON.parse(
    await readFile(`${distDirectory}/.vite/manifest.json`, 'utf8'),
  ) as Manifest;
  await prerenderShells(indexPath, adminPath, distDirectory, manifest);
  // The emitted graph is build input, not a public application resource.
  await unlink(`${distDirectory}/.vite/manifest.json`);
  process.stdout.write(
    `prerendered career shell into ${indexPath}, administrator console into ${adminPath} and ${LEGAL_DOCS.length} legal documents\n`,
  );
}
