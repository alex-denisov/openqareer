/**
 * B569: the catalog search box suggests only cities and roles that really have
 * a public list. The index is built from the already-materialized listings
 * (place x role counts), never from the vacancy pool, and is cached by the
 * identity of that array, which the engine refreshes with maintenance.
 */
import type { CatalogListingSummary } from './vacancyCatalogFacets';

/** [slug, label, count]; a role also carries its biggest city's slug. */
export type SearchEntry = readonly [string, string, number, string?];

export interface CatalogSearchIndex {
  readonly cities: readonly SearchEntry[];
  readonly roles: readonly SearchEntry[];
}

const MAX_ROLES = 1500;
const CYRILLIC = /[А-ЯЁа-яё]/u;

/** Russian names for the most common roles that sources publish only in English. */
const RU_ROLE: Readonly<Record<string, string>> = {
  accountant: 'Бухгалтер',
  'chief-accountant': 'Главный бухгалтер',
  'sales-manager': 'Менеджер по продажам',
  'project-manager': 'Менеджер проектов',
  'product-manager': 'Менеджер продукта',
  'marketing-manager': 'Менеджер по маркетингу',
  'hr-manager': 'HR-менеджер',
  lawyer: 'Юрист',
  designer: 'Дизайнер',
  'data-analyst': 'Аналитик данных',
  'business-analyst': 'Бизнес-аналитик',
  'system-administrator': 'Системный администратор',
  translator: 'Переводчик',
  'customer-support': 'Специалист поддержки',
};

/** Role name as shown to a Russian reader; the published label when it is already Russian. */
export function russianRoleLabel(slug: string, label: string): string {
  return CYRILLIC.test(label) ? label : (RU_ROLE[slug] ?? label);
}

export function buildSearchIndex(listings: readonly CatalogListingSummary[]): CatalogSearchIndex {
  const cities: SearchEntry[] = [];
  const roles = new Map<string, { label: string; count: number; top: string; topCount: number }>();
  for (const listing of listings) {
    if (!listing.role) {
      cities.push([listing.place, listing.placeLabel, listing.count]);
      continue;
    }
    const label = russianRoleLabel(listing.role, listing.roleLabel ?? listing.role);
    const known = roles.get(listing.role);
    const biggest = known && known.topCount >= listing.count;
    roles.set(listing.role, {
      label: known?.label ?? label,
      count: (known?.count ?? 0) + listing.count,
      top: biggest ? known.top : listing.place,
      topCount: biggest ? known.topCount : listing.count,
    });
  }
  return {
    cities: cities.sort((a, b) => a[1].localeCompare(b[1], 'ru')),
    roles: [...roles.entries()]
      .map(([slug, value]): SearchEntry => [slug, value.label, value.count, value.top])
      .sort((a, b) => b[2] - a[2])
      .slice(0, MAX_ROLES),
  };
}

let cached: { source: readonly CatalogListingSummary[]; index: CatalogSearchIndex } | undefined;

export function searchIndexFor(listings: readonly CatalogListingSummary[]): CatalogSearchIndex {
  if (cached?.source !== listings) cached = { source: listings, index: buildSearchIndex(listings) };
  return cached.index;
}
