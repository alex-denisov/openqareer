/**
 * Модель публичного каталога вакансий (B209, срез 2).
 *
 * Чистый слой между пулом и HTML: он решает, какая вакансия вообще получает
 * публичный адрес, и собирает микроразметку. Здесь же держится главное
 * обещание продукта — **не выдумывать**: поле, которого площадка не назвала, в
 * `JobPosting` не появляется. Пустое `hiringOrganization` — это ложь в машинно
 * читаемом виде, которую поисковик растиражирует. `validThrough` — не поле
 * площадки, а наш собственный срок: дата снятия, если площадка её назвала,
 * иначе публикация + 30 дней; снятую раньше вакансию закрывает ответ `410`.
 * `JobPosting` получает только карточка из индексируемого набора
 * (`seo/catalogIndexing`).
 */
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import { PRIVATE_EMPLOYER, publicEmployerName } from '../../shared/privateEmployer';
import { isCountryName } from '../../shared/placeNames';
import {
  CATALOG_ROOT,
  catalogPagePath,
  listingPath,
  vacancyKey,
  vacancyPath,
} from '../../shared/vacancyCatalogRoutes';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { renderUnifiedVacancyView } from './renderVacancyTemplate';
import { renderDescriptionHtml } from './catalogMarkdown';
import { countryCodeOf } from '../domain/geoCoordinates';
import { countLabel } from './catalogCopy';
import { isIndexableCard, isIndexableListing, validThroughOf } from '../seo/catalogIndexing';

/** Сколько карточек на странице каталога. */
export const CATALOG_PAGE_SIZE = 24;

export interface CatalogEntry {
  readonly key: string;
  readonly path: string;
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly isRemote: boolean;
  readonly salaryLabel?: string;
  readonly summary: string;
  readonly skills: readonly string[];
  readonly sourceUrl: string;
  readonly publishedAt: string;
  readonly lastSeenAt: string;
  readonly sourceCount: number;
  /** Площадка, с которой ведёт ссылка, — по имени из реестра (B217). */
  readonly sourceName?: string;
}

export interface StructuredNode {
  readonly '@type': string;
  readonly [key: string]: unknown;
}

export interface StructuredGraph {
  readonly '@context': 'https://schema.org';
  readonly '@graph': readonly StructuredNode[];
}

export interface CatalogPage {
  /** Заголовок `h1`. У корня каталога — просто «Вакансии». */
  readonly heading: string;
  /** Заголовок документа и `og:title`. */
  readonly documentTitle: string;
  readonly description: string;
  /** false — страница отдаётся с `noindex, follow` (тонкий список, см. catalogIndexing). */
  readonly indexable?: boolean;
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly entries: readonly CatalogEntry[];
  readonly canonicalPath: string;
  readonly previousPath?: string;
  readonly nextPath?: string;
  readonly jsonLd: StructuredGraph;
}

export interface VacancyDetail {
  readonly entry: CatalogEntry;
  /**
   * Текст вакансии для страницы и для разметки — одно и то же значение.
   * Поисковик требует, чтобы разметка совпадала с видимым текстом, поэтому
   * два источника здесь были бы нарушением, а не удобством.
   */
  readonly description: string;
  readonly jsonLd: StructuredGraph;
  readonly vacancy?: UnifiedVacancy;
  /** False → the page is `noindex, follow` and carries no `JobPosting`. */
  readonly indexable: boolean;
}

function isoDate(value: string): string {
  return value.slice(0, 10);
}

const CURRENCY_LABEL: Readonly<Record<string, string>> = {
  RUR: '₽',
  RUB: '₽',
  USD: '$',
  EUR: '€',
  GBP: '£',
  KZT: '₸',
  BYN: 'Br',
  UAH: '₴',
};

function salaryLabel(cluster: VacancyCluster): string | undefined {
  const salary = cluster.salary;
  if (!salary || (salary.from === undefined && salary.to === undefined)) return undefined;
  const code = salary.currency?.toUpperCase() ?? '';
  const currency = code ? ` ${CURRENCY_LABEL[code] ?? code}` : '';
  const money = (value: number) => value.toLocaleString('ru-RU');
  if (salary.from !== undefined && salary.to !== undefined) {
    // «125 000 — 125 000» is one number.
    if (salary.from === salary.to) return `${money(salary.from)}${currency}`;
    return `${money(salary.from)} — ${money(salary.to)}${currency}`;
  }
  const single = salary.from ?? salary.to;
  const prefix = salary.from !== undefined ? 'от' : 'до';
  return `${prefix} ${money(single!)}${currency}`;
}

/**
 * Площадка режет длинные названия посередине скобки: «… Systems (Chemical».
 * Незакрытая скобка в title, h1 и разметке выглядит как сломанная страница,
 * поэтому её закрываем, не выдумывая обрезанный хвост.
 */
export function closeDanglingParentheses(title: string): string {
  const opened = (title.match(/\(/gu) ?? []).length;
  const closed = (title.match(/\)/gu) ?? []).length;
  return opened > closed ? `${title.trimEnd()}${')'.repeat(opened - closed)}` : title;
}

/** Ярлыки площадки приходят слагами «Senior-Backend-Engineer»; в разметке нужны слова. */
export function readableSkill(skill: string): string {
  return skill.replace(/(?<=\p{L})-(?=\p{Lu})/gu, ' ').trim();
}

/** Карточка каталога, или `null`, если правило адресов не даёт вакансии адрес. */
export function toCatalogEntry(cluster: VacancyCluster): CatalogEntry | null {
  const company = publicEmployerName(cluster.canonicalCompany, cluster.employerIsPerson);
  const path = vacancyPath({
    id: cluster.id,
    title: cluster.canonicalTitle,
    // Имя частного лица не ложится и в адрес (INC-023).
    company: company === PRIVATE_EMPLOYER ? '' : company,
  });
  if (!path) return null;

  return {
    key: vacancyKey(cluster.id),
    path,
    title: closeDanglingParentheses(cluster.canonicalTitle),
    company,
    ...(cluster.canonicalLocation ? { location: cluster.canonicalLocation } : {}),
    isRemote: cluster.isRemote,
    ...(salaryLabel(cluster) ? { salaryLabel: salaryLabel(cluster) } : {}),
    summary: cluster.descriptionSummary,
    skills: cluster.skills,
    sourceUrl: cluster.primaryUrl,
    publishedAt: cluster.firstObservedAt,
    lastSeenAt: cluster.lastSeenAt,
    sourceCount: cluster.sources.length,
    ...(primarySourceName(cluster) ? { sourceName: primarySourceName(cluster) } : {}),
  };
}

/**
 * Имя площадки, на которую ведёт ссылка карточки. Remotive отдаёт свой API
 * при условии ссылки на себя и упоминания источника словами (B217); читателю
 * это тоже честнее, чем безымянное «у работодателя».
 */
function primarySourceName(cluster: VacancyCluster): string | undefined {
  const primary = cluster.sources.find((source) => source.sourceUrl === cluster.primaryUrl);
  return (primary ?? cluster.sources[0])?.sourceName || undefined;
}

/** Каждая вакансия, у которой есть публичный адрес. Порядок — свежие первыми. */
export function catalogEntries(clusters: readonly VacancyCluster[]): CatalogEntry[] {
  return clusters
    .map(toCatalogEntry)
    .filter((entry): entry is CatalogEntry => entry !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title));
}

/**
 * Сводка списка, из которой строится его страница. Приходит из
 * `vacancyCatalogFacets` — там же решается, публикуется список вообще или нет.
 */
export interface ListingSummary {
  readonly place: string;
  readonly placeLabel: string;
  readonly role?: string;
  readonly roleLabel?: string;
  readonly path: string;
  readonly count: number;
}

function breadcrumbs(extra?: { name: string; path: string }): StructuredNode {
  const items = [
    { '@type': 'ListItem', position: 1, name: 'openqareer', item: `${SITE_ORIGIN}/` },
    { '@type': 'ListItem', position: 2, name: 'Вакансии', item: `${SITE_ORIGIN}${CATALOG_ROOT}` },
    ...(extra
      ? [
          {
            '@type': 'ListItem',
            position: 3,
            name: extra.name,
            item: `${SITE_ORIGIN}${extra.path}`,
          },
        ]
      : []),
  ];
  return { '@type': 'BreadcrumbList', itemListElement: items };
}

export function buildCatalogPage(
  clusters: readonly VacancyCluster[],
  requestedPage: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): CatalogPage {
  const entries = catalogEntries(clusters);
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  // Страница за пределами каталога — не пустой экран: читателя и краулера
  // возвращает первая страница, а канонический адрес называет её честно.
  const page = requestedPage >= 1 && requestedPage <= pageCount ? Math.trunc(requestedPage) : 1;
  const slice = entries.slice((page - 1) * pageSize, page * pageSize);

  return buildCatalogPageFromEntries(slice, page, entries.length, pageSize);
}

/** Build a page from a SQL/keyset slice without sorting or hydrating clusters. */
export function buildCatalogPageFromEntries(
  entries: readonly CatalogEntry[],
  requestedPage: number,
  total: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): CatalogPage {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = requestedPage >= 1 && requestedPage <= pageCount ? Math.trunc(requestedPage) : 1;
  return {
    heading: 'Вакансии',
    documentTitle:
      page > 1
        ? `Вакансии — страница ${page} · openqareer`
        : 'Вакансии и удалённая работа с сайтов работодателей · openqareer',
    description:
      total === 0
        ? 'Каталог вакансий openqareer: сейчас в нём нет ни одной записи с публичным адресом.'
        : `Свежие вакансии, в том числе удалённые: ${countLabel(total)} с сайтов ` +
          'работодателей и открытых площадок. У каждой — источник, дата и ссылка на отклик.',
    page,
    pageCount,
    total,
    entries,
    canonicalPath: catalogPagePath(page),
    ...(page > 1 ? { previousPath: catalogPagePath(page - 1) } : {}),
    ...(page < pageCount ? { nextPath: catalogPagePath(page + 1) } : {}),
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'ItemList',
          name: 'Вакансии в openqareer',
          numberOfItems: entries.length,
          itemListElement: entries.map((entry, index) => ({
            '@type': 'ListItem',
            position: (page - 1) * pageSize + index + 1,
            url: `${SITE_ORIGIN}${entry.path}`,
            name: entry.title,
          })),
        },
        breadcrumbs(),
      ],
    },
  };
}

/**
 * Google for Jobs `employmentType` enum from what the source passed: hh.ru ids
 * (`FULL`, `PART`, `PROJECT`) or ATS free text («Full-time», «Contract»).
 * Anything else is left out rather than guessed.
 */
const EMPLOYMENT_TYPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:full|full[\s_-]?time|полная занятость)$/iu, 'FULL_TIME'],
  [/^(?:part|part[\s_-]?time|частичная занятость)$/iu, 'PART_TIME'],
  [/^(?:project|contract|contractor|проектная работа)$/iu, 'CONTRACTOR'],
  [/^(?:temporary|temp)$/iu, 'TEMPORARY'],
  [/^(?:intern|internship|probation|стажировка)$/iu, 'INTERN'],
  [/^(?:volunteer)$/iu, 'VOLUNTEER'],
];

export function googleEmploymentType(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return EMPLOYMENT_TYPES.find(([pattern]) => pattern.test(trimmed))?.[1];
}

/** Where the job is, with the ISO country Google asks for (B535). */
function postingLocation(entry: CatalogEntry, isRemote: boolean): Record<string, unknown> {
  const country = countryCodeOf(entry.location);
  // A remote country restriction is not a physical city or office.
  const countryOnly =
    isCountryName(entry.location) ||
    (country !== undefined && entry.location?.trim().toUpperCase() === country);
  return {
    ...(entry.location && !(isRemote && countryOnly)
      ? {
          jobLocation: {
            '@type': 'Place',
            address: {
              '@type': 'PostalAddress',
              addressLocality: entry.location,
              ...(country ? { addressCountry: country } : {}),
            },
          },
        }
      : {}),
    ...(isRemote ? { jobLocationType: 'TELECOMMUTE' } : {}),
    // Google requires the allowed applicant country for remote postings.
    ...(isRemote && country
      ? { applicantLocationRequirements: { '@type': 'Country', name: country } }
      : {}),
  };
}

function jobPosting(
  cluster: VacancyCluster,
  entry: CatalogEntry,
  description: string,
  vacancy?: UnifiedVacancy,
): StructuredNode {
  const withdrawnAt = vacancy?.archivedAt;
  const employmentType = googleEmploymentType(vacancy?.employmentType);
  // Частное лицо — не организация, и его имени в разметке не место (INC-023).
  const company = entry.company === PRIVATE_EMPLOYER ? '' : entry.company.trim();
  const validThrough = validThroughOf(entry.publishedAt, withdrawnAt);

  return {
    '@type': 'JobPosting',
    title: entry.title,
    // Google reads HTML here; the raw template would leak markdown and emoji.
    description:
      renderDescriptionHtml(description) || renderDescriptionHtml(entry.summary) || entry.title,
    datePosted: isoDate(entry.publishedAt),
    ...(validThrough ? { validThrough } : {}),
    identifier: { '@type': 'PropertyValue', name: 'openqareer', value: entry.key },
    url: `${SITE_ORIGIN}${entry.path}`,
    // Языка вакансии мы не знаем: текст пришёл от работодателя и бывает любым.
    // На живом проде разметка объявляла `ru-RU` над английским описанием —
    // машинно читаемая неправда, поэтому поля здесь просто нет.
    // Отклик подаётся на площадке работодателя, а не здесь. Сказать обратное —
    // обещать кандидату действие, которого продукт не делает.
    directApply: false,
    ...(company ? { hiringOrganization: { '@type': 'Organization', name: company } } : {}),
    ...postingLocation(entry, cluster.isRemote),
    ...(employmentType ? { employmentType } : {}),
    ...(entry.skills.length > 0 ? { skills: entry.skills.map(readableSkill).join(', ') } : {}),
    // VacancySalary has no source-backed pay period. Google baseSalary needs
    // the actual amount per HOUR/DAY/WEEK/MONTH/YEAR; currency and magnitude
    // cannot establish it. Keep the source range in the visible card only.
  };
}

/**
 * Карточка вакансии с микроразметкой, или `null`, если адреса у неё нет.
 *
 * `fullDescription` — полный текст исходной вакансии: кластер несёт только
 * первые 300 знаков, и без него в разметку уходил обрывок на полуслове.
 */
export function buildVacancyDetail(
  cluster: VacancyCluster,
  fullDescription?: string,
  vacancy?: UnifiedVacancy,
  now: Date = new Date(),
): VacancyDetail | null {
  const entry = toCatalogEntry(cluster);
  if (!entry) return null;
  const description = vacancy
    ? renderUnifiedVacancyView(vacancy)
    : fullDescription?.trim() || entry.summary;
  const indexable = isIndexableCard(entry, now);
  const crumbs = breadcrumbs({ name: entry.title, path: entry.path });

  return {
    entry,
    description,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': indexable ? [jobPosting(cluster, entry, description, vacancy), crumbs] : [crumbs],
    },
    ...(vacancy ? { vacancy } : {}),
    indexable,
  };
}

/**
 * Заголовок списка. Место названо через тире, а не предлогом: «в Москве» и «в
 * Берлине» требуют склонения, а склонять чужие названия по правилу — тот же
 * сорт выдумки, что и транслит. Тире читается одинаково для любого города.
 */
function listingHeading(summary: ListingSummary): string {
  const remote = summary.place === 'remote';
  if (summary.roleLabel) {
    return remote
      ? `${summary.roleLabel} — удалённые вакансии`
      : `${summary.roleLabel} — вакансии, ${summary.placeLabel}`;
  }
  return remote ? 'Удалённые вакансии и удалённая работа' : `Вакансии — ${summary.placeLabel}`;
}

/** Число вакансий в title первой страницы — сниппет отвечает «сколько» до клика. */
function listingTitle(heading: string, page: number, total: number): string {
  return page > 1
    ? `${heading} — страница ${page} · openqareer`
    : `${heading}: ${countLabel(total)} · openqareer`;
}

/** Страница списка по месту и роли (B209, срез 2b). */
export function buildListingPage(
  clusters: readonly VacancyCluster[],
  summary: ListingSummary,
  requestedPage: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): CatalogPage {
  const entries = catalogEntries(clusters);
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = requestedPage >= 1 && requestedPage <= pageCount ? Math.trunc(requestedPage) : 1;
  const slice = entries.slice((page - 1) * pageSize, page * pageSize);

  return buildListingPageFromEntries(slice, summary, page, entries.length, pageSize);
}

/** Build a filtered page from the materialized catalog projection. */
export function buildListingPageFromEntries(
  entries: readonly CatalogEntry[],
  summary: ListingSummary,
  requestedPage: number,
  total: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): CatalogPage {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = requestedPage >= 1 && requestedPage <= pageCount ? Math.trunc(requestedPage) : 1;
  const heading = listingHeading(summary);
  const canonicalPath = listingPath(summary.place, summary.role, page) ?? summary.path;
  return {
    heading,
    documentTitle: listingTitle(heading, page, total),
    description:
      `${heading}: ${countLabel(total)}. ` +
      'У каждой вакансии — работодатель, источник и дата публикации. Отклик подаётся на сайте работодателя.',
    indexable: isIndexableListing(total, Boolean(summary.role)),
    page,
    pageCount,
    total,
    entries,
    canonicalPath,
    ...(page > 1
      ? { previousPath: listingPath(summary.place, summary.role, page - 1) ?? summary.path }
      : {}),
    ...(page < pageCount
      ? { nextPath: listingPath(summary.place, summary.role, page + 1) ?? summary.path }
      : {}),
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'ItemList',
          name: heading,
          numberOfItems: entries.length,
          itemListElement: entries.map((entry, index) => ({
            '@type': 'ListItem',
            position: (page - 1) * pageSize + index + 1,
            url: `${SITE_ORIGIN}${entry.path}`,
            name: entry.title,
          })),
        },
        breadcrumbs({ name: heading, path: summary.path }),
      ],
    },
  };
}
