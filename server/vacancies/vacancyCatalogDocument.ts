/**
 * HTML публичного каталога вакансий (B209, срез 2).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ДОКУМЕНТ, А НЕ ЭКРАН ПРИЛОЖЕНИЯ. Пул меняется каждый час —
 * предрендерить тысячи страниц на сборке нельзя. А если на такую страницу
 * смонтируется бандл, React заменит серверную разметку тем, что роутер отдаёт
 * на незнакомый путь: краулер увидел бы вакансию, человек — главную. Поэтому
 * каталог — документ: своя разметка, общая таблица стилей, никакого бандла.
 *
 * ПОЧЕМУ ЭКРАНИРОВАНИЕ ЗДЕСЬ ГЛАВНОЕ. Названия, работодатели и описания
 * приходят с чужих площадок и никем не проверены. Незакрытая кавычка в
 * названии вакансии — чужой скрипт на нашем домене, поэтому весь внешний текст
 * идёт только через `escapeHtml`, а микроразметка — ещё и через экранирование
 * закрывающего тега.
 */
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { CATALOG_ROOT } from '../../shared/vacancyCatalogRoutes';
import { employerLabel } from '../../shared/employerLabel';
import type {
  CatalogEntry,
  CatalogPage,
  StructuredGraph,
  VacancyDetail,
} from './vacancyCatalogPage';
import type { CatalogFilterGroup } from './vacancyCatalogFilters';
import { isIndexablePage } from '../seo/catalogIndexing';
import { escapeHtml } from './catalogHtml';
import { CATALOG_STYLE } from './catalogStyle';
import { CATALOG_CHROME_FOOTER, catalogChromeHeader } from './catalogChrome';
import { meaningfulText, plainSummary, renderDescriptionHtml } from './catalogMarkdown';
import { countLabel, formatRuDate, pageFacts } from './catalogCopy';

/**
 * ПОЧЕМУ ФАЙЛ, А НЕ ИНЛАЙН. Боевая политика безопасности — `style-src 'self'`
 * (`deploy/Caddyfile.openqareer`): инлайновый `<style>` браузер просто не
 * применит, и каталог приехал бы к читателю без вёрстки. Имя файла несёт хеш
 * содержимого, поэтому его можно отдавать неизменяемым и не бояться, что
 * следующий релиз оставит читателю старый стиль.
 *
 * Собственный стиль документа. Таблица приложения выходит пятнадцатью частями —
 * тянуть её на страницу-документ значит платить пятнадцатью запросами за
 * вёрстку, которой здесь нет. Значения токенов взяты из `src/App.css`, чтобы
 * каталог читался как тот же продукт.
 */

export { escapeHtml };

/**
 * JSON внутри `<script>` закрывается не кавычкой, а строкой `</script>` в
 * данных, поэтому экранируется именно она.
 */
function jsonLdScript(graph: StructuredGraph): string {
  const json = JSON.stringify(graph).replace(/</gu, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/** Устойчивое имя файла стиля: меняется вместе с содержимым. */
function styleFingerprint(): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < CATALOG_STYLE.length; index += 1) {
    hash ^= CATALOG_STYLE.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export const CATALOG_STYLESHEET_PATH = `/assets/catalog-${styleFingerprint()}.css`;

export { CATALOG_STYLE };

/** og/twitter title without the site suffix: og:site_name already names it. */
function shareTitle(title: string): string {
  return title.replace(/\s+[·|]\s+openqareer$/u, '');
}

function head(options: {
  title: string;
  description: string;
  canonicalPath: string;
  jsonLd: StructuredGraph;
  noindex?: boolean;
  previousPath?: string;
  nextPath?: string;
  ogType?: 'website' | 'article';
}): string {
  return [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="theme-color" content="#f9fafc">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<meta name="description" content="${escapeHtml(options.description)}">`,
    `<link rel="canonical" href="${SITE_ORIGIN}${escapeHtml(options.canonicalPath)}">`,
    options.noindex ? '<meta name="robots" content="noindex, follow">' : '',
    options.previousPath
      ? `<link rel="prev" href="${SITE_ORIGIN}${escapeHtml(options.previousPath)}">`
      : '',
    options.nextPath
      ? `<link rel="next" href="${SITE_ORIGIN}${escapeHtml(options.nextPath)}">`
      : '',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    `<meta property="og:type" content="${options.ogType ?? 'website'}">`,
    `<meta property="og:image" content="${SITE_ORIGIN}/og-cover-4.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:locale" content="ru_RU">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(shareTitle(options.title))}">`,
    `<meta name="twitter:description" content="${escapeHtml(options.description)}">`,
    `<meta name="twitter:image" content="${SITE_ORIGIN}/og-cover-4.png">`,
    '<meta property="og:site_name" content="openqareer">',
    `<meta property="og:title" content="${escapeHtml(shareTitle(options.title))}">`,
    `<meta property="og:description" content="${escapeHtml(options.description)}">`,
    `<meta property="og:url" content="${SITE_ORIGIN}${escapeHtml(options.canonicalPath)}">`,
    `<link rel="stylesheet" href="${CATALOG_STYLESHEET_PATH}">`,
    jsonLdScript(options.jsonLd),
    '<script src="/assets/oq-analytics-2.js" defer></script>',
  ]
    .filter(Boolean)
    .join('');
}

function shell(headHtml: string, bodyHtml: string): string {
  return `<!doctype html><html lang="ru"><head>${headHtml}</head><body><div class="ps"><a class="ps-skip" href="#main">К содержимому</a>${bodyHtml}</div></body></html>`;
}

function siteHeader(): string {
  return catalogChromeHeader();
}

function siteFooter(): string {
  return CATALOG_CHROME_FOOTER;
}

const CTA_BOX =
  '<div class="cat-box"><h2>Подберём вакансии под ваше резюме</h2>' +
  '<p>Загрузите резюме: openqareer покажет процент совпадения с каждой вакансией и почему, ' +
  'проверит резюме на ATS и подготовит отклик, который вы одобрите.</p>' +
  '<a class="ps-btn is-primary" href="/signup">Загрузить резюме бесплатно</a></div>';

const formatDate = formatRuDate;

function descriptionBlock(markdown: string, summary: string): string {
  const html = renderDescriptionHtml(markdown) || renderDescriptionHtml(summary);
  return html
    ? `<div class="cat-body">${html}</div>`
    : '<div class="cat-body"><p>Источник не передал текст вакансии. Полное описание — на сайте работодателя.</p></div>';
}

function factsBlock(page: CatalogPage): string {
  const facts = pageFacts(page.total, page.entries);
  if (facts.length === 0) return '';
  return `<section class="cat-facts-box" aria-label="Коротко о разделе">${facts
    .map((fact) => `<p>${escapeHtml(fact)}</p>`)
    .join('')}</section>`;
}

function crumbs(trail: readonly { readonly label: string; readonly path: string }[]): string {
  if (trail.length === 0) return '';
  const links = [{ label: 'openqareer', path: '/' }, ...trail]
    .map((item) => `<a href="${escapeHtml(item.path)}">${escapeHtml(item.label)}</a>`)
    .join(' / ');
  return `<nav class="ps-crumbs" aria-label="Навигационная цепочка">${links}</nav>`;
}

function placeLabel(entry: CatalogEntry): string {
  if (entry.isRemote && !entry.location) return 'Удалённо';
  if (entry.isRemote && entry.location) return `Удалённо · ${entry.location}`;
  return entry.location ?? 'Место не указано';
}

function metaLine(entry: CatalogEntry): string {
  return (
    '<p class="cat-meta">' +
    (entry.salaryLabel ? `<span class="cat-salary">${escapeHtml(entry.salaryLabel)}</span>` : '') +
    `<span>${escapeHtml(employerLabel(entry.company))}</span>` +
    `<span>${escapeHtml(placeLabel(entry))}</span>` +
    '</p>'
  );
}

function summaryLine(entry: CatalogEntry): string {
  const text = meaningfulText(entry.summary, entry.title);
  return text ? `<p class="cat-summary">${escapeHtml(plainSummary(text, 220))}</p>` : '';
}

function entryCard(entry: CatalogEntry): string {
  return (
    '<li class="cat-card">' +
    `<h2><a href="${escapeHtml(entry.path)}">${escapeHtml(entry.title)}</a></h2>` +
    metaLine(entry) +
    summaryLine(entry) +
    '</li>'
  );
}

/**
 * Фильтры каталога — ссылки, сгруппированные по тому, по чему идёт сужение.
 *
 * Без них краулер доходит до страницы списка только через карту сайта, а
 * читатель — никогда: у каталога не было бы ни одного способа сузить выборку.
 * До этого среза группа была одна и плоская: «Берлин» стоял рядом с «Frontend
 * Developer — Берлин», и что из этого место, а что роль, читатель не видел.
 */
function filterPanel(groups: readonly CatalogFilterGroup[]): string {
  const filled = groups.filter((group) => group.links.length > 0);
  if (filled.length === 0) return '';
  return (
    '<nav class="cat-box cat-filters" aria-label="Фильтры каталога"><h2>Сузить выборку</h2>' +
    filled
      .map(
        (group) =>
          `<section class="cat-filter"><h3>${escapeHtml(group.title)}</h3><ul>` +
          group.links
            .map(
              (link) =>
                `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}</a> <span>${link.count}</span></li>`,
            )
            .join('') +
          '</ul></section>',
      )
      .join('') +
    '</nav>'
  );
}

function pagination(page: CatalogPage): string {
  if (page.pageCount <= 1) return '';
  const previous = page.previousPath
    ? `<a rel="prev" href="${escapeHtml(page.previousPath)}">← Предыдущая</a>`
    : '';
  const next = page.nextPath
    ? `<a rel="next" href="${escapeHtml(page.nextPath)}">Следующая →</a>`
    : '';
  return `<nav class="cat-pager" aria-label="Страницы каталога">${previous}<span>Страница ${page.page} из ${page.pageCount}</span>${next}</nav>`;
}

/**
 * Ответ на адрес вакансии, которой в пуле больше нет.
 *
 * Читатель пришёл по ссылке и должен узнать, что произошло, а не гадать, почему
 * вместо вакансии список. Поисковику этот адрес индексировать нечего — отсюда
 * `noindex` поверх кода `410`.
 */
const GONE_COPY = {
  vacancy: {
    heading: 'Этой вакансии больше нет',
    lead:
      'Площадка сняла вакансию, а карточку без подтверждения источником мы не показываем. ' +
      'Откройте актуальные вакансии из каталога ниже или загрузите резюме: подберём похожие.',
    title: 'Вакансия снята · openqareer',
    description:
      'Эту вакансию сняли с площадки, и в каталоге её больше нет. ' +
      'Откройте актуальные вакансии и откликайтесь на сайте работодателя.',
  },
  listing: {
    heading: 'В этом разделе сейчас нет вакансий',
    lead:
      'Вакансии по этому городу или роли закрылись или ещё не появились. ' +
      'Откройте вакансии из каталога ниже или загрузите резюме: подберём похожие.',
    title: 'Раздел каталога пуст · openqareer',
    description:
      'Вакансий по этому городу или роли сейчас нет. ' +
      'Откройте актуальные вакансии каталога и откликайтесь на сайте работодателя.',
  },
} as const;

export function renderGoneDocument(
  page: CatalogPage,
  kind: keyof typeof GONE_COPY = 'vacancy',
): string {
  const copy = GONE_COPY[kind];
  const body =
    siteHeader() +
    '<main id="main" class="ps-wrap ps-page">' +
    crumbs([]) +
    `<div class="cat-head"><h1>${copy.heading}</h1><p class="cat-lead">${copy.lead}</p></div>` +
    '<div class="cat-layout"><div>' +
    (page.entries.length > 0
      ? `<ul class="cat-list">${page.entries.map(entryCard).join('')}</ul>`
      : '') +
    '</div><aside class="cat-side">' +
    CTA_BOX +
    '</aside></div></main>' +
    siteFooter();

  return shell(
    head({
      title: copy.title,
      description: copy.description,
      canonicalPath: CATALOG_ROOT,
      jsonLd: page.jsonLd,
      noindex: true,
    }),
    body,
  );
}

/**
 * Одна страница-список на все случаи: корень каталога и списки по месту и роли
 * отличаются только заголовком и адресом, а вёрстка, разметка и постраничная
 * навигация у них общие (B209, срез 2b).
 */
export function renderCatalogDocument(
  page: CatalogPage,
  filters: readonly CatalogFilterGroup[] = [],
): string {
  const empty = page.total === 0;
  const title = page.documentTitle;
  const description = page.description;

  const root = page.canonicalPath === CATALOG_ROOT;
  const body =
    siteHeader() +
    '<main id="main" class="ps-wrap ps-page">' +
    crumbs(root ? [] : [{ label: 'Вакансии', path: CATALOG_ROOT }]) +
    `<div class="cat-head"><h1>${escapeHtml(page.heading)}</h1>` +
    (empty
      ? '<p class="cat-empty">Каталог пока пуст: ни одной вакансии с публичным адресом ' +
        'в пуле сейчас нет. Это состояние данных, а не ошибка страницы.</p></div>'
      : `<p class="cat-lead">${countLabel(page.total)} с открытых площадок и сайтов работодателей. ` +
        'У каждой указаны источник и дата, отклик подаётся на сайте работодателя.</p></div>') +
    '<div class="cat-layout"><div>' +
    (empty
      ? ''
      : factsBlock(page) +
        `<ul class="cat-list">${page.entries.map(entryCard).join('')}</ul>` +
        pagination(page)) +
    '</div><aside class="cat-side">' +
    CTA_BOX +
    filterPanel(filters) +
    '</aside></div></main>' +
    siteFooter();

  return shell(
    head({
      title,
      description,
      canonicalPath: page.canonicalPath,
      jsonLd: page.jsonLd,
      // Пустой каталог индексировать нечего: пустая страница в выдаче вредит
      // и читателю, и домену. Глубокие страницы — только ради ссылок.
      ...(empty || !isIndexablePage(page.page) || page.indexable === false
        ? { noindex: true }
        : {}),
      ...(page.previousPath ? { previousPath: page.previousPath } : {}),
      ...(page.nextPath ? { nextPath: page.nextPath } : {}),
    }),
    body,
  );
}

function aboutBox(entry: CatalogEntry, employer: string): string {
  return (
    '<div class="cat-box"><h2>О вакансии</h2><dl class="cat-facts">' +
    (entry.salaryLabel ? `<dt>Зарплата</dt><dd>${escapeHtml(entry.salaryLabel)}</dd>` : '') +
    `<dt>Работодатель</dt><dd>${escapeHtml(employer)}</dd>` +
    `<dt>Где</dt><dd>${escapeHtml(placeLabel(entry))}</dd>` +
    `<dt>Опубликована</dt><dd>${escapeHtml(formatDate(entry.publishedAt))}</dd>` +
    `<dt>Проверена</dt><dd>${escapeHtml(formatDate(entry.lastSeenAt))}</dd>` +
    (entry.sourceName ? `<dt>Источник</dt><dd>${escapeHtml(entry.sourceName)}</dd>` : '') +
    (entry.sourceCount > 1
      ? `<dt>Площадок с этой вакансией</dt><dd>${entry.sourceCount}</dd>`
      : '') +
    '</dl>' +
    `<a class="ps-btn is-primary" rel="nofollow noopener" target="_blank" href="${escapeHtml(entry.sourceUrl)}">Открыть у работодателя</a>` +
    '</div>'
  );
}

export function renderVacancyDocument(detail: VacancyDetail): string {
  const { entry } = detail;
  const employer = employerLabel(entry.company);
  const title = `${entry.title} — ${employer} · openqareer`;
  const description = plainSummary(
    // The body goes through plainSummary on its own first: the generated
    // template preamble («Статус: Опубликовано…») is only dropped at its start.
    `${entry.title}, ${employer}, ${placeLabel(entry)}${entry.salaryLabel ? `, ${entry.salaryLabel}` : ''}. ${plainSummary(meaningfulText(detail.description, entry.title) || meaningfulText(entry.summary, entry.title), 400)}`,
    160,
  );

  const body =
    siteHeader() +
    '<main id="main" class="ps-wrap ps-page">' +
    crumbs([{ label: 'Вакансии', path: CATALOG_ROOT }]) +
    '<div class="cat-detail"><article>' +
    `<h1>${escapeHtml(entry.title)}</h1>` +
    metaLine(entry) +
    (entry.skills.length > 0
      ? `<ul class="cat-skills">${entry.skills.map((skill) => `<li>${escapeHtml(skill)}</li>`).join('')}</ul>`
      : '') +
    descriptionBlock(
      meaningfulText(detail.description, entry.title),
      meaningfulText(entry.summary, entry.title),
    ) +
    '<p class="cat-note">openqareer не кадровое агентство: вакансия собрана с открытого источника, ' +
    'отклик подаётся на сайте работодателя.</p>' +
    '</article><aside class="cat-side">' +
    aboutBox(entry, employer) +
    CTA_BOX +
    '</aside></div></main>' +
    siteFooter();

  return shell(
    head({
      title,
      description,
      canonicalPath: entry.path,
      jsonLd: detail.jsonLd,
      ogType: 'article',
      // Outside the indexable set: reachable and followed, not indexed.
      ...(detail.indexable ? {} : { noindex: true }),
    }),
    body,
  );
}
