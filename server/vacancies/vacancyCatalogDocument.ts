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
import type { CatalogEntry, CatalogPage, StructuredGraph, VacancyDetail } from './vacancyCatalogPage';

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
const CATALOG_STYLE = `:root{color-scheme:dark;--bg-dark:oklch(15% 0.015 255);--surface:oklch(20% 0.018 255/0.9);--surface-raised:oklch(24% 0.02 255/0.94);--line:oklch(93% 0.015 255/0.13);--primary-accent:oklch(79% 0.14 255);--text-main:oklch(95% 0.008 255);--text-muted:oklch(72% 0.025 255);--font-main:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box}
body.catalog-body{margin:0;background:var(--bg-dark);color:var(--text-main);font-family:var(--font-main);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:var(--primary-accent);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible{outline:2px solid var(--primary-accent);outline-offset:2px;border-radius:4px}
.catalog-header,.catalog-footer,.catalog-main{max-width:60rem;margin:0 auto;padding:1rem 1.25rem}
.catalog-header{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line)}
.catalog-brand{font-weight:650;letter-spacing:-0.01em;color:var(--text-main)}
.catalog-nav{display:flex;gap:1rem}
.catalog-main{padding-block:2rem 3rem}
.catalog-main h1{font-size:clamp(1.6rem,4vw,2.2rem);line-height:1.2;margin:0 0 .5rem}
.catalog-lead,.catalog-empty{color:var(--text-muted);margin:0 0 1.5rem}
.catalog-list{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
.catalog-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:1rem 1.1rem}
.catalog-card h2{font-size:1.05rem;margin:0 0 .35rem;line-height:1.35}
.catalog-card-meta{color:var(--text-muted);font-size:.9rem;margin:0 0 .5rem}
.catalog-card-summary,.catalog-detail-summary{margin:0;color:var(--text-muted)}
.catalog-detail-summary{color:var(--text-main);margin-block:1rem}
.catalog-pagination{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1.5rem;color:var(--text-muted);flex-wrap:wrap}
.catalog-breadcrumbs{color:var(--text-muted);font-size:.9rem;margin-bottom:.75rem}
.catalog-skills{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem;padding:0;margin:1rem 0}
.catalog-skills li{background:var(--surface-raised);border:1px solid var(--line);border-radius:999px;padding:.2rem .7rem;font-size:.85rem;color:var(--text-muted)}
.catalog-provenance{color:var(--text-muted);font-size:.9rem}
.catalog-apply{margin:1.5rem 0 0}
.catalog-apply a{display:inline-block;background:var(--primary-accent);color:oklch(15% 0.015 255);font-weight:600;padding:.65rem 1.2rem;border-radius:12px}
.catalog-apply a:hover{text-decoration:none;filter:brightness(1.08)}
.catalog-footer{border-top:1px solid var(--line);color:var(--text-muted);font-size:.85rem}
.catalog-related{margin-top:2rem;border-top:1px solid var(--line);padding-top:1.25rem}
.catalog-related h2{font-size:1rem;margin:0 0 .75rem}
.catalog-related ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.5rem}
.catalog-related li{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:.3rem .8rem;font-size:.9rem}
.catalog-related span{color:var(--text-muted)}
@media (max-width:520px){.catalog-header{flex-direction:column;align-items:flex-start}}`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

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

function head(options: {
  title: string;
  description: string;
  canonicalPath: string;
  jsonLd: StructuredGraph;
  noindex?: boolean;
  previousPath?: string;
  nextPath?: string;
}): string {
  return [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="theme-color" content="#090d12">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<meta name="description" content="${escapeHtml(options.description)}">`,
    `<link rel="canonical" href="${SITE_ORIGIN}${escapeHtml(options.canonicalPath)}">`,
    options.noindex ? '<meta name="robots" content="noindex, follow">' : '',
    options.previousPath ? `<link rel="prev" href="${SITE_ORIGIN}${escapeHtml(options.previousPath)}">` : '',
    options.nextPath ? `<link rel="next" href="${SITE_ORIGIN}${escapeHtml(options.nextPath)}">` : '',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="openqareer">',
    `<meta property="og:title" content="${escapeHtml(options.title)}">`,
    `<meta property="og:description" content="${escapeHtml(options.description)}">`,
    `<meta property="og:url" content="${SITE_ORIGIN}${escapeHtml(options.canonicalPath)}">`,
    `<link rel="stylesheet" href="${CATALOG_STYLESHEET_PATH}">`,
    jsonLdScript(options.jsonLd),
  ]
    .filter(Boolean)
    .join('');
}

function shell(headHtml: string, bodyHtml: string): string {
  return `<!doctype html><html lang="ru"><head>${headHtml}</head><body class="catalog-body">${bodyHtml}</body></html>`;
}

function siteHeader(): string {
  return (
    '<header class="catalog-header">' +
    `<a class="catalog-brand" href="/">openqareer</a>` +
    '<nav class="catalog-nav">' +
    `<a href="${CATALOG_ROOT}">Вакансии</a>` +
    '<a href="/login">Войти</a>' +
    '</nav></header>'
  );
}

function siteFooter(): string {
  return (
    '<footer class="catalog-footer">' +
    '<p>Вакансии собраны с открытых площадок и досок работодателей. ' +
    'Отклик подаётся на площадке работодателя. openqareer не кадровое агентство ' +
    'и не обещает интервью, оффер или трудоустройство.</p>' +
    '<p><a href="/legal/terms">Пользовательское соглашение</a> · ' +
    '<a href="/legal/privacy">Персональные данные</a></p>' +
    '</footer>'
  );
}

function placeLabel(entry: CatalogEntry): string {
  if (entry.isRemote && !entry.location) return 'Удалённо';
  if (entry.isRemote && entry.location) return `Удалённо · ${entry.location}`;
  return entry.location ?? 'Место не указано';
}

function entryCard(entry: CatalogEntry): string {
  return (
    '<li class="catalog-card">' +
    `<h2><a href="${escapeHtml(entry.path)}">${escapeHtml(entry.title)}</a></h2>` +
    `<p class="catalog-card-meta">${escapeHtml(employerLabel(entry.company))} · ${escapeHtml(placeLabel(entry))}` +
    (entry.salaryLabel ? ` · ${escapeHtml(entry.salaryLabel)}` : '') +
    '</p>' +
    `<p class="catalog-card-summary">${escapeHtml(entry.summary.slice(0, 240))}</p>` +
    '</li>'
  );
}

export interface RelatedLink {
  readonly path: string;
  readonly label: string;
  readonly count: number;
}

/**
 * Внутренние ссылки на списки. Без них краулер доходит до страницы списка
 * только через карту сайта, а читатель — никогда: у каталога не было бы ни
 * одного способа сузить выборку.
 */
function relatedLinks(links: readonly RelatedLink[]): string {
  if (links.length === 0) return '';
  return (
    '<nav class="catalog-related"><h2>Подборки</h2><ul>' +
    links
      .map(
        (link) =>
          `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}</a> <span>${link.count}</span></li>`,
      )
      .join('') +
    '</ul></nav>'
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
  return `<nav class="catalog-pagination">${previous}<span>Страница ${page.page} из ${page.pageCount}</span>${next}</nav>`;
}

/**
 * Ответ на адрес вакансии, которой в пуле больше нет.
 *
 * Читатель пришёл по ссылке и должен узнать, что произошло, а не гадать, почему
 * вместо вакансии список. Поисковику этот адрес индексировать нечего — отсюда
 * `noindex` поверх кода `410`.
 */
export function renderGoneDocument(page: CatalogPage): string {
  const body =
    siteHeader() +
    '<main class="catalog-main">' +
    '<h1>Этой вакансии больше нет</h1>' +
    '<p class="catalog-lead">Запись пропала из пула: площадка сняла её или перестала ' +
    'отдавать. Мы не держим карточку, которую нечем подтвердить. Ниже — то, что в пуле есть сейчас.</p>' +
    (page.entries.length > 0
      ? `<ul class="catalog-list">${page.entries.map(entryCard).join('')}</ul>`
      : '') +
    '</main>' +
    siteFooter();

  return shell(
    head({
      title: 'Вакансия снята · openqareer',
      description:
        'Эта вакансия пропала из пула: площадка сняла её или перестала отдавать. ' +
        'Каталог openqareer показывает только записи, которые наблюдались.',
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
export function renderCatalogDocument(page: CatalogPage, related: readonly RelatedLink[] = []): string {
  const empty = page.total === 0;
  const title = page.documentTitle;
  const description = page.description;

  const body =
    siteHeader() +
    '<main class="catalog-main">' +
    (page.canonicalPath === CATALOG_ROOT
      ? ''
      : `<nav class="catalog-breadcrumbs"><a href="/">openqareer</a> · <a href="${CATALOG_ROOT}">Вакансии</a></nav>`) +
    `<h1>${escapeHtml(page.heading)}</h1>` +
    (empty
      ? '<p class="catalog-empty">Каталог пока пуст: ни одной вакансии с публичным адресом ' +
        'в пуле сейчас нет. Это состояние данных, а не ошибка страницы.</p>'
      : `<p class="catalog-lead">Всего ${page.total} вакансий. ` +
        'Каждая карточка ведёт на первоисточник — отклик подаётся там.</p>' +
        `<ul class="catalog-list">${page.entries.map(entryCard).join('')}</ul>` +
        pagination(page)) +
    relatedLinks(related) +
    '</main>' +
    siteFooter();

  return shell(
    head({
      title,
      description,
      canonicalPath: page.canonicalPath,
      jsonLd: page.jsonLd,
      // Пустой каталог индексировать нечего: пустая страница в выдаче вредит
      // и читателю, и домену.
      ...(empty ? { noindex: true } : {}),
      ...(page.previousPath ? { previousPath: page.previousPath } : {}),
      ...(page.nextPath ? { nextPath: page.nextPath } : {}),
    }),
    body,
  );
}

export function renderVacancyDocument(detail: VacancyDetail): string {
  const { entry } = detail;
  const employer = employerLabel(entry.company);
  const title = `${entry.title} — ${employer} · openqareer`;
  const description = `${entry.title}, ${employer}, ${placeLabel(entry)}. Источник и дата наблюдения указаны на странице.`;

  const body =
    siteHeader() +
    '<main class="catalog-main catalog-detail">' +
    '<nav class="catalog-breadcrumbs"><a href="/">openqareer</a> · ' +
    `<a href="${CATALOG_ROOT}">Вакансии</a></nav>` +
    `<h1>${escapeHtml(entry.title)}</h1>` +
    `<p class="catalog-card-meta">${escapeHtml(employer)} · ${escapeHtml(placeLabel(entry))}` +
    (entry.salaryLabel ? ` · ${escapeHtml(entry.salaryLabel)}` : '') +
    '</p>' +
    `<p class="catalog-detail-summary">${escapeHtml(detail.description)}</p>` +
    (entry.skills.length > 0
      ? `<ul class="catalog-skills">${entry.skills.map((skill) => `<li>${escapeHtml(skill)}</li>`).join('')}</ul>`
      : '') +
    '<p class="catalog-provenance">' +
    `Наблюдалась ${escapeHtml(entry.lastSeenAt.slice(0, 10))}, впервые ${escapeHtml(entry.publishedAt.slice(0, 10))}` +
    (entry.sourceCount > 1 ? `, найдена на ${entry.sourceCount} площадках` : '') +
    '.</p>' +
    `<p class="catalog-apply"><a class="site-btn is-primary" rel="nofollow noopener" target="_blank" href="${escapeHtml(entry.sourceUrl)}">Открыть у работодателя</a></p>` +
    '</main>' +
    siteFooter();

  return shell(
    head({
      title,
      description,
      canonicalPath: entry.path,
      jsonLd: detail.jsonLd,
    }),
    body,
  );
}
