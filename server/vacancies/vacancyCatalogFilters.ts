/**
 * Фильтры каталога (B209, срез 2b).
 *
 * ПОЧЕМУ ССЫЛКИ, А НЕ ВИДЖЕТ. Каталог собирается на сервере и живёт вне
 * приложения: скрипта на странице нет вовсе — боевой CSP разрешает только свой
 * файл стиля. Сузить выборку читатель может лишь переходом, и тот же переход —
 * единственный путь краулера к странице списка. Фильтр на скрипте не увидели
 * бы ни поисковик, ни читатель без JavaScript.
 *
 * ПОЧЕМУ ГРУППАМИ. До этого среза страница печатала один плоский список
 * «Подборки», где «Берлин» стоял рядом с «Frontend Developer — Берлин»:
 * читатель не видел, что из этого место, а что роль. Группы называют, по чему
 * идёт сужение, и на странице места первым делом предлагают роли **этого**
 * места, а на странице роли — ту же роль в других местах.
 *
 * Порог публикации и счёт берутся из `catalogListings`: страница списка и
 * ссылка на неё обязаны появляться и исчезать вместе.
 */
import type { CatalogListing } from '../../shared/vacancyCatalogRoutes';
import { catalogListings, type CatalogListingSummary } from './vacancyCatalogFacets';
import type { CatalogEntry } from './vacancyCatalogPage';

/** Сколько ссылок печатать в одной группе: список фильтров — не карта сайта. */
const GROUP_LIMIT = 12;

export type CatalogFilterKind = 'places' | 'roles' | 'same-role';

export interface CatalogFilterLink {
  readonly path: string;
  readonly label: string;
  readonly count: number;
}

export interface CatalogFilterGroup {
  readonly kind: CatalogFilterKind;
  readonly title: string;
  readonly links: readonly CatalogFilterLink[];
}

/**
 * SQL-backed catalog reads already have these summaries grouped by the
 * materialized projection. Keep the presentation rules in one place without
 * rebuilding every CatalogEntry merely to print navigation links.
 */
export function catalogFilterGroupsFromListings(
  listings: readonly CatalogListingSummary[],
  current?: Pick<CatalogListing, 'place' | 'role'>,
): CatalogFilterGroup[] {
  const places = listings.filter((listing) => !listing.role);
  const roles = listings.filter((listing) => listing.role);
  const placeLabel = current?.place
    ? places.find((listing) => listing.place === current.place)?.placeLabel
    : undefined;
  const split: Split = { places, roles, ...(placeLabel ? { placeLabel } : {}) };

  if (current?.place && current.role) {
    return roleGroups(split, { place: current.place, role: current.role });
  }
  if (current?.place) return placeGroups(split, current.place);

  return [
    ...group(
      'places',
      'Места',
      places.map((listing) => link(listing, listing.placeLabel)),
    ),
    ...group(
      'roles',
      'Роли',
      roles.map((listing) => link(listing, `${listing.roleLabel} — ${listing.placeLabel}`)),
    ),
  ];
}

function link(listing: CatalogListingSummary, label: string): CatalogFilterLink {
  return { path: listing.path, label, count: listing.count };
}

function group(
  kind: CatalogFilterKind,
  title: string,
  links: readonly CatalogFilterLink[],
): CatalogFilterGroup[] {
  // Заголовка без ссылок не бывает: пустая группа обещает выбор, которого нет.
  return links.length > 0 ? [{ kind, title, links: links.slice(0, GROUP_LIMIT) }] : [];
}

interface Split {
  readonly places: readonly CatalogListingSummary[];
  readonly roles: readonly CatalogListingSummary[];
  readonly placeLabel?: string;
}

/** Страница роли: та же роль в других местах и другие роли этого места. */
function roleGroups(split: Split, current: { place: string; role: string }): CatalogFilterGroup[] {
  const sameRole = split.roles.filter(
    (listing) => listing.role === current.role && listing.place !== current.place,
  );
  const otherRoles = split.roles.filter(
    (listing) => listing.place === current.place && listing.role !== current.role,
  );
  return [
    ...group(
      'same-role',
      'Та же роль в других местах',
      sameRole.map((listing) => link(listing, listing.placeLabel)),
    ),
    ...group(
      'roles',
      split.placeLabel ? `Другие роли — ${split.placeLabel}` : 'Другие роли',
      otherRoles.map((listing) => link(listing, listing.roleLabel ?? listing.place)),
    ),
  ];
}

/** Страница места: сначала роли этого места, потом другие места. */
function placeGroups(split: Split, place: string): CatalogFilterGroup[] {
  return [
    ...group(
      'roles',
      split.placeLabel ? `Роли — ${split.placeLabel}` : 'Роли',
      split.roles
        .filter((listing) => listing.place === place)
        .map((listing) => link(listing, listing.roleLabel ?? listing.place)),
    ),
    ...group(
      'places',
      'Другие места',
      split.places
        .filter((listing) => listing.place !== place)
        .map((listing) => link(listing, listing.placeLabel)),
    ),
  ];
}

/**
 * Группы фильтров для страницы каталога.
 *
 * `current` — список, на котором читатель стоит сейчас: ссылка на саму себя
 * фильтром не является и в группы не попадает.
 */
export function catalogFilterGroups(
  entries: readonly CatalogEntry[],
  current?: Pick<CatalogListing, 'place' | 'role'>,
): CatalogFilterGroup[] {
  return catalogFilterGroupsFromListings(catalogListings(entries), current);
}
