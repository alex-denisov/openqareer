import type { VacancyCluster } from '../domain/unifiedVacancy';
import { catalogPlaceOf, catalogRoleOf } from './vacancyCatalogFacets';
import { toCatalogEntry, type CatalogEntry } from './vacancyCatalogPage';

/**
 * A row that is safe to serve from the materialized public catalog.
 *
 * `clusterId` is deliberately kept beside the public fields: a detail request
 * may still fetch one cluster (and one full vacancy) after the list itself has
 * stayed entirely inside the narrow projection.
 */
export interface CatalogEntryRow extends CatalogEntry {
  readonly clusterId: string;
  readonly status: VacancyCluster['status'];
  readonly placeSlug?: string;
  readonly placeLabel?: string;
  readonly roleSlug?: string;
  readonly roleLabel?: string;
}

/** Convert a persisted cluster into the fields used by public catalog pages. */
export function catalogEntryRowOfCluster(cluster: VacancyCluster): CatalogEntryRow | null {
  const entry = toCatalogEntry(cluster);
  if (!entry) return null;
  const place = catalogPlaceOf(entry);
  const role = catalogRoleOf(entry);
  return {
    ...entry,
    clusterId: cluster.id,
    status: cluster.status,
    ...(place ? { placeSlug: place.slug, placeLabel: place.label } : {}),
    ...(role ? { roleSlug: role.slug, roleLabel: role.label } : {}),
  };
}

/** A cursor is the complete ordering key, never an OFFSET disguised as a page. */
export interface CatalogCursor {
  readonly publishedMs: number;
  readonly key: string;
}

export interface CatalogEntriesQuery {
  readonly limit: number;
  readonly after?: CatalogCursor;
  readonly place?: string;
  readonly role?: string;
}

export interface CatalogEntriesPage {
  readonly items: readonly CatalogEntryRow[];
  readonly total: number;
  readonly nextCursor?: CatalogCursor;
}

/** Opaque URL-safe representation used by public `?after=` links. */
export function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCatalogCursor(raw: unknown): CatalogCursor | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.publishedMs !== 'number' ||
      !Number.isSafeInteger(candidate.publishedMs) ||
      candidate.publishedMs < 0 ||
      typeof candidate.key !== 'string' ||
      candidate.key.length === 0 ||
      candidate.key.length > 128
    ) {
      return undefined;
    }
    return { publishedMs: candidate.publishedMs, key: candidate.key };
  } catch {
    return undefined;
  }
}
