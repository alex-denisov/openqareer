/**
 * Модель публичного каталога вакансий (B209, срез 2).
 *
 * Чистый слой между пулом и HTML: он решает, какая вакансия вообще получает
 * публичный адрес, и собирает микроразметку. Здесь же держится главное
 * обещание продукта — **не выдумывать**: поле, которого площадка не назвала, в
 * `JobPosting` не появляется. Пустое `hiringOrganization` или придуманный
 * `validThrough` — это ложь в машинно читаемом виде, которую поисковик
 * растиражирует.
 */
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import {
  CATALOG_ROOT,
  catalogPagePath,
  vacancyKey,
  vacancyPath,
} from '../../shared/vacancyCatalogRoutes';
import type { VacancyCluster } from '../domain/unifiedVacancy';

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
  readonly jsonLd: StructuredGraph;
}

function isoDate(value: string): string {
  return value.slice(0, 10);
}

function salaryLabel(cluster: VacancyCluster): string | undefined {
  const salary = cluster.salary;
  if (!salary || (salary.from === undefined && salary.to === undefined)) return undefined;
  const currency = salary.currency ? ` ${salary.currency}` : '';
  if (salary.from !== undefined && salary.to !== undefined) {
    return `${salary.from.toLocaleString('ru-RU')} — ${salary.to.toLocaleString('ru-RU')}${currency}`;
  }
  const single = salary.from ?? salary.to;
  const prefix = salary.from !== undefined ? 'от' : 'до';
  return `${prefix} ${single!.toLocaleString('ru-RU')}${currency}`;
}

/** Карточка каталога, или `null`, если правило адресов не даёт вакансии адрес. */
export function toCatalogEntry(cluster: VacancyCluster): CatalogEntry | null {
  const path = vacancyPath({
    id: cluster.id,
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany,
  });
  if (!path) return null;

  return {
    key: vacancyKey(cluster.id),
    path,
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany,
    ...(cluster.canonicalLocation ? { location: cluster.canonicalLocation } : {}),
    isRemote: cluster.isRemote,
    ...(salaryLabel(cluster) ? { salaryLabel: salaryLabel(cluster) } : {}),
    summary: cluster.descriptionSummary,
    skills: cluster.skills,
    sourceUrl: cluster.primaryUrl,
    publishedAt: cluster.firstObservedAt,
    lastSeenAt: cluster.lastSeenAt,
    sourceCount: cluster.sources.length,
  };
}

/** Каждая вакансия, у которой есть публичный адрес. Порядок — свежие первыми. */
export function catalogEntries(clusters: readonly VacancyCluster[]): CatalogEntry[] {
  return clusters
    .map(toCatalogEntry)
    .filter((entry): entry is CatalogEntry => entry !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title));
}

function breadcrumbs(extra?: { name: string; path: string }): StructuredNode {
  const items = [
    { '@type': 'ListItem', position: 1, name: 'openqareer', item: `${SITE_ORIGIN}/` },
    { '@type': 'ListItem', position: 2, name: 'Вакансии', item: `${SITE_ORIGIN}${CATALOG_ROOT}` },
    ...(extra
      ? [{ '@type': 'ListItem', position: 3, name: extra.name, item: `${SITE_ORIGIN}${extra.path}` }]
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

  return {
    page,
    pageCount,
    total: entries.length,
    entries: slice,
    canonicalPath: catalogPagePath(page),
    ...(page > 1 ? { previousPath: catalogPagePath(page - 1) } : {}),
    ...(page < pageCount ? { nextPath: catalogPagePath(page + 1) } : {}),
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'ItemList',
          name: 'Вакансии в openqareer',
          numberOfItems: slice.length,
          itemListElement: slice.map((entry, index) => ({
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

function jobPosting(cluster: VacancyCluster, entry: CatalogEntry): StructuredNode {
  const salary = cluster.salary;
  const hasSalary = salary && (salary.from !== undefined || salary.to !== undefined);
  const company = cluster.canonicalCompany.trim();

  return {
    '@type': 'JobPosting',
    title: entry.title,
    description: entry.summary,
    datePosted: isoDate(entry.publishedAt),
    identifier: { '@type': 'PropertyValue', name: 'openqareer', value: entry.key },
    url: `${SITE_ORIGIN}${entry.path}`,
    inLanguage: 'ru-RU',
    // Отклик подаётся на площадке работодателя, а не здесь. Сказать обратное —
    // обещать кандидату действие, которого продукт не делает.
    directApply: false,
    ...(company ? { hiringOrganization: { '@type': 'Organization', name: company } } : {}),
    ...(entry.location
      ? {
          jobLocation: {
            '@type': 'Place',
            address: { '@type': 'PostalAddress', addressLocality: entry.location },
          },
        }
      : {}),
    ...(cluster.isRemote ? { jobLocationType: 'TELECOMMUTE' } : {}),
    ...(entry.skills.length > 0 ? { skills: entry.skills.join(', ') } : {}),
    ...(hasSalary
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            ...(salary.currency ? { currency: salary.currency } : {}),
            value: {
              '@type': 'QuantitativeValue',
              ...(salary.from !== undefined ? { minValue: salary.from } : {}),
              ...(salary.to !== undefined ? { maxValue: salary.to } : {}),
              unitText: 'MONTH',
            },
          },
        }
      : {}),
  };
}

/** Карточка вакансии с микроразметкой, или `null`, если адреса у неё нет. */
export function buildVacancyDetail(cluster: VacancyCluster): VacancyDetail | null {
  const entry = toCatalogEntry(cluster);
  if (!entry) return null;

  return {
    entry,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        jobPosting(cluster, entry),
        breadcrumbs({ name: entry.title, path: entry.path }),
      ],
    },
  };
}
