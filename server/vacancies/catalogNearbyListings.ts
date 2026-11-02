/**
 * A listing below the publication threshold (03.11) still answers 200 when it
 * has a vacancy: it carries a short note and these links instead of a 410.
 */
import { listingPath } from '../../shared/vacancyCatalogRoutes';
import {
  preferredRoleTitle,
  roleLabelFromTitle,
  type CatalogListingSummary,
} from './vacancyCatalogFacets';
import type { CatalogEntryRow } from './vacancyCatalogProjection';

export interface NearbyListing {
  readonly path: string;
  readonly label: string;
  readonly count: number;
}

const NEARBY_LIMIT = 6;
const PER_GROUP = 3;

function nearbyLabel(listing: CatalogListingSummary): string {
  return listing.roleLabel ? `${listing.roleLabel}, ${listing.placeLabel}` : listing.placeLabel;
}

/**
 * The listing's own place first, then the same role elsewhere, other roles in
 * the same place, and the largest places. `listings` is sorted by count.
 */
export function nearbyListings(
  listings: readonly CatalogListingSummary[],
  current: { readonly place: string; readonly role?: string },
): NearbyListing[] {
  const own = (listing: CatalogListingSummary) =>
    listing.place === current.place && listing.role === current.role;
  const groups = [
    listings.filter((listing) => current.role && listing.place === current.place && !listing.role),
    current.role
      ? listings
          .filter((listing) => listing.role === current.role && listing.place !== current.place)
          .slice(0, PER_GROUP)
      : [],
    listings
      .filter((listing) => listing.place === current.place && listing.role && !own(listing))
      .slice(0, PER_GROUP),
    listings.filter((listing) => !listing.role && listing.place !== current.place),
  ];
  const seen = new Set<string>();
  return groups
    .flat()
    .filter((listing) => !own(listing) && !seen.has(listing.path) && seen.add(listing.path))
    .slice(0, NEARBY_LIMIT)
    .map((listing) => ({ path: listing.path, label: nearbyLabel(listing), count: listing.count }));
}

/** A summary for a listing too small to be in the published list. */
export function smallListingSummary(
  current: { readonly place: string; readonly role?: string },
  entries: readonly CatalogEntryRow[],
  total: number,
): CatalogListingSummary | undefined {
  const first = entries[0];
  const path = listingPath(current.place, current.role);
  if (!first?.placeLabel || !path) return undefined;
  const title = entries.map((entry) => entry.title).reduce(preferredRoleTitle);
  return {
    place: current.place,
    placeLabel: first.placeLabel,
    ...(current.role ? { role: current.role, roleLabel: roleLabelFromTitle(title) } : {}),
    path,
    count: total,
  };
}
