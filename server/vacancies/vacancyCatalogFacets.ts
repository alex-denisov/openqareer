/**
 * Списки каталога по месту и роли (B209, срез 2b).
 *
 * Пример владельца дословно: `/vacancies/remote/frontend-developer` и
 * `/vacancies/moscow/programmist-1c`. Ищут именно такие страницы, а не корень
 * каталога, поэтому без них SEO по вакансиям остаётся половиной работы.
 *
 * ПОЧЕМУ РОЛЬ — СЕМЕЙСТВО, А НЕ ЗАГОЛОВОК. Слаг из точного заголовка дал бы
 * тысячи списков по одной вакансии в каждом. Группировка идёт **по самому
 * слагу**: он и есть каноническое английское имя роли, поэтому «Senior
 * Frontend Developer», «Frontend Developer» и «Разработчик интерфейсов»
 * попадают в один список, а адрес и группировка не могут разойтись.
 *
 * ПОЧЕМУ ЕСТЬ ПОРОГ. Страница с одной вакансией — тонкая страница: она портит
 * домен в выдаче и обманывает читателя, который пришёл за списком.
 */
import { normalizeCityLabel } from '../../shared/cityLabel';
import { latinCityName } from '../../shared/placeNames';
import { buildVacancySlug, listingPath, type CatalogListing } from '../../shared/vacancyCatalogRoutes';
import type { CatalogEntry } from './vacancyCatalogPage';

/** Меньше этого числа вакансий — страница не публикуется. */
export const MIN_LISTING_SIZE = 3;

/** Место «удалённо» — не город, но самая частая страница поиска. */
export const REMOTE_PLACE = 'remote';

export interface CatalogListingSummary {
  readonly place: string;
  readonly placeLabel: string;
  readonly role?: string;
  readonly roleLabel?: string;
  readonly path: string;
  readonly count: number;
}

/**
 * Шум уровня и формата работы: в имени роли ему не место, иначе «Senior
 * Frontend Developer» и «Frontend Developer» разъедутся по разным спискам.
 */
const TITLE_NOISE =
  /\b(senior|middle|junior|lead|principal|staff|intern|sr|jr|ведущий|старший|младший|главный|стаж[её]р|remote|удал[её]нно|гибрид|hybrid|onsite|full[- ]?time|part[- ]?time)\b/giu;

function placeOf(entry: CatalogEntry): { slug: string; label: string } | null {
  const city = normalizeCityLabel(entry.location?.split(',')[0]);
  const slug = city ? latinCityName(city) : undefined;
  if (slug && city) return { slug, label: city };
  return entry.isRemote ? { slug: REMOTE_PLACE, label: 'Удалённо' } : null;
}

function roleOf(entry: CatalogEntry): { slug: string; label: string } | null {
  const slug = buildVacancySlug(entry.title.replace(TITLE_NOISE, ' '));
  if (!slug) return null;
  const label = slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return { slug, label };
}

interface Bucket {
  readonly place: string;
  readonly placeLabel: string;
  readonly role?: string;
  readonly roleLabel?: string;
  count: number;
}

/**
 * Списки, которые продукт имеет право опубликовать. Порядок — от крупных к
 * мелким: крупные и полезнее читателю, и заметнее поисковику.
 */
export function catalogListings(entries: readonly CatalogEntry[]): CatalogListingSummary[] {
  const buckets = new Map<string, Bucket>();

  for (const entry of entries) {
    const place = placeOf(entry);
    if (!place) continue;
    const role = roleOf(entry);

    const placeId = `p:${place.slug}`;
    const placeBucket = buckets.get(placeId) ?? {
      place: place.slug,
      placeLabel: place.label,
      count: 0,
    };
    placeBucket.count += 1;
    buckets.set(placeId, placeBucket);

    if (!role) continue;
    const roleId = `r:${place.slug}:${role.slug}`;
    const roleBucket = buckets.get(roleId) ?? {
      place: place.slug,
      placeLabel: place.label,
      role: role.slug,
      roleLabel: role.label,
      count: 0,
    };
    roleBucket.count += 1;
    buckets.set(roleId, roleBucket);

  }

  const listings: CatalogListingSummary[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.count < MIN_LISTING_SIZE) continue;
    const path = listingPath(bucket.place, bucket.role);
    if (!path) continue;
    listings.push({
      place: bucket.place,
      placeLabel: bucket.placeLabel,
      ...(bucket.role ? { role: bucket.role, roleLabel: bucket.roleLabel } : {}),
      path,
      count: bucket.count,
    });
  }

  return listings.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

/** Вакансии одного списка. Пустой ответ — законный: список мог опустеть. */
export function listingEntries(
  entries: readonly CatalogEntry[],
  listing: CatalogListing,
): CatalogEntry[] {
  return entries.filter((entry) => {
    const place = placeOf(entry);
    if (!place || place.slug !== listing.place) return false;
    if (!listing.role) return true;
    const role = roleOf(entry);
    return role?.slug === listing.role;
  });
}
