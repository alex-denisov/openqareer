/** B569: names and figures shared by the parts of a catalog list page. */
import { cityGenitive, cityPrepositional, roleDative, roleGenitive } from './catalogListingForms';
import { escapeHtml } from './catalogHtml';
import { russianRoleLabel } from './vacancyCatalogSearch';
import type { CatalogPage } from './vacancyCatalogPage';

/** HTML-safe: the sign comes from a source label. */
export const money = (value: number, sign = '₽') =>
  escapeHtml(`${value.toLocaleString('ru-RU')} ${sign}`.trim());

export function dataDate(page: CatalogPage): string {
  const latest = page.entries
    .map((entry) => entry.lastSeenAt.slice(0, 10))
    .sort()
    .pop();
  const [year, month, day] = (latest ?? new Date().toISOString().slice(0, 10)).split('-');
  return `${day}.${month}.${year}`;
}

export interface Names {
  readonly roleName?: string;
  readonly roleGen?: string;
  readonly roleDat?: string;
  readonly placeName?: string;
  readonly placeGen?: string;
  readonly placePrep?: string;
}

export function namesOf(page: CatalogPage): Names {
  const listing = page.listing;
  if (!listing) return {};
  return {
    placeName: listing.placeLabel,
    ...(cityGenitive(listing.place) ? { placeGen: cityGenitive(listing.place) } : {}),
    ...(cityPrepositional(listing.place) ? { placePrep: cityPrepositional(listing.place) } : {}),
    ...(listing.role
      ? {
          roleName: russianRoleLabel(listing.role, listing.roleLabel ?? listing.role),
          ...(roleGenitive(listing.role) ? { roleGen: roleGenitive(listing.role) } : {}),
          ...(roleDative(listing.role) ? { roleDat: roleDative(listing.role) } : {}),
        }
      : {}),
  };
}
