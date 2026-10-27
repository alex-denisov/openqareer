/**
 * B569: body of a catalog list page, laid out like mockup 08: crumbs, head
 * with facts and search, the vacancy table with the side column, three link
 * cards and the questions. Every number is counted from the list itself; a
 * figure the data cannot support (median with too few ranges, a city form not
 * in the tables) is left out instead of invented.
 */
import { CATALOG_ROOT, listingPath } from '../../shared/vacancyCatalogRoutes';
import { interviewProfession, interviewProfessionPath } from '../../shared/interviewQuestions';
import { salaryRolePath } from '../../shared/salaryMarketPublic';
import { countLabel } from './catalogCopy';
import { escapeHtml } from './catalogHtml';
import { ARROW, jobsCard, pager } from './catalogListingJobs';
import type { SalaryStats } from './catalogSalaryStats';
import type { CatalogFilterGroup } from './vacancyCatalogFilters';
import type { CatalogPage } from './vacancyCatalogPage';
import { listingFaq } from './catalogListingFaq';
import { dataDate, money, namesOf, type Names } from './catalogListingNames';

export interface ListingExtras {
  readonly stats?: SalaryStats;
  readonly now?: Date;
}

function heading(page: CatalogPage, names: Names): string {
  const { roleGen, placePrep } = names;
  if (page.listing?.role && roleGen && placePrep) return `Вакансии ${roleGen} в ${placePrep}`;
  return page.heading;
}

function crumbs(page: CatalogPage, names: Names): string {
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const sep = '<span aria-hidden="true">/</span>';
  const listing = page.listing;
  const trail = [link('/', 'Главная')];
  if (!listing) {
    trail.push(`<span>Вакансии</span>`);
  } else {
    trail.push(link(CATALOG_ROOT, 'Вакансии'));
    const placePath = listingPath(listing.place) ?? CATALOG_ROOT;
    trail.push(
      listing.role
        ? link(placePath, listing.placeLabel)
        : `<span>${escapeHtml(listing.placeLabel)}</span>`,
    );
    if (listing.role) trail.push(`<span>${escapeHtml(names.roleName ?? listing.role)}</span>`);
  }
  return `<nav class="ps-wrap lv-crumbs" aria-label="Хлебные крошки">${trail.join(sep)}</nav>`;
}

function factsLine(page: CatalogPage, names: Names, stats?: SalaryStats): string {
  const count = `<span><b>${page.total.toLocaleString('ru-RU')}</b> ${countLabel(page.total).split(/\s/u).pop()}</span>`;
  const salaried =
    stats && stats.withSalary > 0
      ? `<span><b>${stats.withSalary.toLocaleString('ru-RU')}</b> с зарплатой` +
        (stats.withRange > 0
          ? `, из них ${stats.withRange.toLocaleString('ru-RU')} с вилкой «от — до»`
          : '') +
        '</span>'
      : '';
  const median =
    stats?.median !== undefined
      ? `<span>медиана вилок <b>${money(stats.median, stats.sign)}</b></span>`
      : '';
  const role = page.listing?.role;
  const alertText = `Присылать новые вакансии${names.roleGen ? ` ${names.roleGen}` : ''}`;
  const alertHref = `/signup?from=catalog&amp;alert=${role ? encodeURIComponent(role) : '1'}`;
  return (
    `<div class="lv-facts">${count}${salaried}${median}<span>данные на <b>${dataDate(page)}</b></span>` +
    `<a class="lv-alert" href="${alertHref}">${escapeHtml(alertText)}</a></div>`
  );
}

/** Role and city boxes; the script suggests real lists from the search index. */
function searchForm(page: CatalogPage, names: Names): string {
  const box = (kind: 'role' | 'city', label: string, hint: string, list: string) => {
    const value = kind === 'role' ? names.roleName : names.placeName;
    const slug = kind === 'role' ? page.listing?.role : page.listing?.place;
    const filled = value
      ? ` value="${escapeHtml(value)}"${slug ? ` data-slug="${escapeHtml(slug)}"` : ''}`
      : ` placeholder="${hint}"`;
    return (
      `<div class="cat-fld"><label for="cat-${kind}">${label}</label>` +
      `<input class="cat-in" id="cat-${kind}" data-cat-${kind}${filled} role="combobox" ` +
      `aria-autocomplete="list" aria-expanded="false" aria-controls="cat-${kind}-l" autocomplete="off">` +
      `<ul class="cat-ac" id="cat-${kind}-l" role="listbox" aria-label="${list}" hidden></ul></div>`
    );
  };
  return (
    '<form class="cat-search" role="search" action="/vacancies" data-cat-search>' +
    box('role', 'Должность', 'Например, бухгалтер', 'Должности') +
    box('city', 'Город', 'Например, Москва', 'Города') +
    '<button class="ps-btn is-lg" type="submit">Найти</button></form>'
  );
}

function answer(page: CatalogPage, names: Names, stats?: SalaryStats): string {
  const where = names.roleGen && names.placePrep ? ` ${names.roleGen} в ${names.placePrep}` : '';
  const ranges =
    stats && stats.withRange > 0
      ? `, у ${stats.withRange.toLocaleString('ru-RU')} указана вилка «от — до»`
      : '';
  const spread =
    stats?.median !== undefined && stats.low !== undefined && stats.high !== undefined
      ? ` Медиана — ${money(stats.median, stats.sign)}, половина вакансий — от ${stats.low.toLocaleString('ru-RU')} до ${money(stats.high, stats.sign)}.`
      : '';
  return (
    `<p class="lv-answer lv-hm"><b>Коротко:</b> на ${dataDate(page)} в открытом каталоге ` +
    `${countLabel(page.total)}${where}${ranges}.${spread}</p>`
  );
}

function salaryCard(page: CatalogPage, names: Names, stats?: SalaryStats): string {
  if (stats?.median === undefined || stats.low === undefined || stats.high === undefined) return '';
  const role = page.listing?.role;
  const href = (role && stats?.salaryPage ? salaryRolePath(role) : undefined) ?? '/salaries';
  const title = names.placeGen
    ? `Зарплаты в вакансиях ${names.placeGen}`
    : 'Зарплаты в этих вакансиях';
  return (
    `<div class="lv-card lv-hm"><h2>${escapeHtml(title)}</h2><div class="lv-sal"><b>${money(stats.median, stats.sign)}</b>` +
    `<span>медиана · половина вакансий ${stats.low.toLocaleString('ru-RU')}–${money(stats.high, stats.sign)}</span>` +
    `<span class="lv-small">По ${stats.withRange.toLocaleString('ru-RU')} вакансиям с вилкой «от — до». ` +
    `У остальных зарплата указана одним числом или не указана. ${dataDate(page)}</span></div>` +
    `<a class="lv-link" href="${escapeHtml(href)}">Зарплаты по городам ${ARROW}</a></div>`
  );
}

function alertCard(page: CatalogPage, names: Names): string {
  const role = page.listing?.role;
  const lead = names.roleGen
    ? `openqareer соберёт свежие вакансии ${names.roleGen} и подготовит резюме под каждую.`
    : 'openqareer соберёт свежие вакансии и подготовит резюме под каждую.';
  return (
    '<div class="lv-card lv-dark lv-hm"><b>Новые вакансии каждый день</b>' +
    `<p>${escapeHtml(lead)}</p><a class="ps-btn" href="/signup?from=catalog&amp;alert=${role ? encodeURIComponent(role) : '1'}">Получать новые вакансии</a></div>`
  );
}

const FACET_LIMIT = 6;

function facetTitle(group: CatalogFilterGroup, names: Names): string {
  if (group.kind === 'same-role') return `${names.roleName ?? 'Эта роль'} в других городах`;
  if (group.kind === 'roles' && names.roleName && names.placePrep) {
    return `Другие вакансии в ${names.placePrep}`;
  }
  return group.title;
}

function facetCards(groups: readonly CatalogFilterGroup[], names: Names): string {
  return groups
    .filter((group) => group.links.length > 0)
    .map((group) => {
      const items = group.links
        .slice(0, FACET_LIMIT)
        .map(
          (link) =>
            `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.label)}<span>${link.count.toLocaleString('ru-RU')}</span></a></li>`,
        )
        .join('');
      return (
        `<div class="lv-card lv-side-like"><h2>${escapeHtml(facetTitle(group, names))}</h2>` +
        `<ul class="lv-facet" data-fold-m="4" data-fold-label="Все">${items}</ul></div>`
      );
    })
    .join('');
}

function prepCard(page: CatalogPage, names: Names, stats?: SalaryStats): string {
  const role = page.listing?.role;
  const link = (href: string, text: string) =>
    `<a class="lv-link" href="${escapeHtml(href)}">${escapeHtml(text)} ${ARROW}</a>`;
  const profession = role ? interviewProfession(role) : undefined;
  const genitive = names.roleGen;
  const links = [
    link('/tools/resume', genitive ? `Резюме ${genitive} по шаблону` : 'Резюме по шаблону'),
    link(
      profession ? interviewProfessionPath(profession.slug) : '/tools/interview-questions',
      genitive ? `Вопросы на собеседовании ${genitive}` : 'Вопросы на собеседовании',
    ),
    link(
      (role && stats?.salaryPage ? salaryRolePath(role) : undefined) ?? '/salaries',
      genitive && stats?.salaryPage ? `Зарплаты ${genitive} по городам` : 'Зарплаты по профессиям',
    ),
  ];
  return `<div class="lv-card lv-side-like lv-hm"><h2>Подготовьтесь к отклику</h2><div class="lv-prep">${links.join('')}</div></div>`;
}

export function renderListingMain(
  page: CatalogPage,
  filters: readonly CatalogFilterGroup[],
  extras: ListingExtras = {},
): string {
  const names = namesOf(page);
  const now = extras.now ?? new Date();
  const role = page.listing?.role;
  return (
    crumbs(page, names) +
    '<section class="lv-phero"><div class="ps-wrap"><div class="cat-vh"><div>' +
    `<h1>${escapeHtml(heading(page, names))}</h1>${factsLine(page, names, extras.stats)}</div>` +
    `<a class="ps-btn is-primary is-lg" href="/signup?from=catalog${role ? `&amp;role=${encodeURIComponent(role)}` : ''}">Подобрать под моё резюме</a></div>` +
    `${searchForm(page, names)}</div></section>` +
    '<div class="ps-wrap lv-grid"><div>' +
    jobsCard(page, now) +
    answer(page, names, extras.stats) +
    '<div class="lv-sticky"><a class="ps-btn is-primary is-lg" href="/signup?from=catalog">Показать мой процент совпадения · бесплатно</a></div>' +
    pager(page) +
    `</div><aside class="lv-side">${salaryCard(page, names, extras.stats)}${alertCard(page, names)}</aside></div>` +
    `<section class="lv-sec"><div class="ps-wrap lv-facets">${facetCards(filters, names)}${prepCard(page, names, extras.stats)}</div></section>` +
    listingFaq(page, names, extras.stats)
  );
}
