/**
 * B569: the vacancy table of a catalog list (mockup 08): one card, a header
 * row, rows with title / employer · source · date / salary, the inline
 * «Какие из N подойдут вам?» row, and the pager. Rows are plain HTML; folding
 * to the first rows is done by public/assets/oq-vacancy-search-1.js, so a
 * reader without scripts (and a crawler) gets all 24 rows.
 */
import { employerLabel } from '../../shared/employerLabel';
import { publicEmployerName } from '../../shared/privateEmployer';
import { escapeHtml } from './catalogHtml';
import { formatRuDate } from './catalogCopy';
import { CATALOG_PAGE_SIZE, type CatalogEntry, type CatalogPage } from './vacancyCatalogPage';

export const ARROW =
  '<svg class="lv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const DAY_MS = 86_400_000;
const FRESH_DAYS = 14;

function plural(value: number, one: string, few: string, many: string): string {
  const tens = value % 100;
  const ones = value % 10;
  if (tens >= 11 && tens <= 14) return many;
  return ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many;
}

/** «сегодня», «вчера», «3 дня назад»; older than two weeks — the date itself. */
export function relativeDay(iso: string, now: Date): string {
  const published = Date.parse(iso);
  if (!Number.isFinite(published)) return '';
  const days = Math.max(0, Math.floor((now.getTime() - published) / DAY_MS));
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days <= FRESH_DAYS) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return formatRuDate(iso);
}

function jobRow(entry: CatalogEntry, now: Date): string {
  const salary = entry.salaryLabel
    ? `<span class="lv-s">${escapeHtml(entry.salaryLabel.replace(/\s—\s/u, '–'))}</span>`
    : '<span class="lv-s lv-none">зарплата не указана</span>';
  const when = relativeDay(entry.publishedAt, now);
  const source = [entry.sourceName, when].filter(Boolean).join(' · ');
  const employer = employerLabel(publicEmployerName(entry.company));
  return (
    `<div class="lv-job"><span class="lv-t"><a href="${escapeHtml(entry.path)}">${escapeHtml(entry.title)}</a></span>` +
    salary +
    `<span class="lv-m"><span>${escapeHtml(employer)}</span>` +
    (source ? `<span class="lv-src">${escapeHtml(source)}</span>` : '') +
    '</span>' +
    (entry.isRemote
      ? '<span class="lv-tags"><span class="lv-chip">удалённо</span></span>'
      : '<span></span>') +
    '</div>'
  );
}

function lockRow(total: number): string {
  return (
    `<div class="lv-lock"><p><b>Какие из ${total.toLocaleString('ru-RU')} подходят вам?</b> ` +
    'Процент совпадения и чего не хватает — после загрузки резюме, бесплатно.</p>' +
    '<a class="ps-btn" href="/signup?from=catalog">Загрузить резюме</a></div>'
  );
}

/** The inline sign-up row sits after the fifth vacancy, as in the mockup. */
const LOCK_AFTER = 5;

export function jobsCard(page: CatalogPage, now: Date): string {
  const first = (page.page - 1) * CATALOG_PAGE_SIZE + 1;
  const last = first + page.entries.length - 1;
  const rows = page.entries.map((entry) => jobRow(entry, now));
  const body =
    rows.length > LOCK_AFTER
      ? [...rows.slice(0, LOCK_AFTER), lockRow(page.total), ...rows.slice(LOCK_AFTER)]
      : [...rows, lockRow(page.total)];
  return (
    '<div class="lv-card lv-jobs" data-fold="6" data-fold-m="4" data-fold-label="Показать ещё вакансии">' +
    `<div class="lv-card-h lv-keep"><span>Сначала новые · ${first.toLocaleString('ru-RU')}–${last.toLocaleString('ru-RU')} из ${page.total.toLocaleString('ru-RU')}</span>` +
    '<span>Источник и дата у каждой вакансии</span></div>' +
    body.join('') +
    '</div>'
  );
}

export function pager(page: CatalogPage): string {
  if (page.pageCount <= 1) return '';
  const remaining = page.total - page.page * CATALOG_PAGE_SIZE;
  const step = Math.min(CATALOG_PAGE_SIZE, Math.max(remaining, 0));
  const previous = page.previousPath
    ? `<a class="ps-btn" rel="prev" href="${escapeHtml(page.previousPath)}">← Предыдущие</a>`
    : '';
  const next = page.nextPath
    ? `<a class="ps-btn" rel="next" href="${escapeHtml(page.nextPath)}">Следующие ${step} ${ARROW}</a>`
    : '';
  return (
    '<nav class="lv-pager" aria-label="Страницы каталога">' +
    previous +
    `<span>Страница ${page.page} из ${page.pageCount}</span>` +
    next +
    '</nav>'
  );
}
