import type { DatabaseSync } from 'node:sqlite';
import { SALARY_COUNTRY_CITIES, type CountryCatalog } from '../../shared/salaryCountryCities';
import { countryPoolPay } from './countryPoolPay';

/**
 * B351 06b «Где искать» and SEO P2 pay: active catalog entries of the country's
 * known cities, counted over the (status, place_slug) index.
 */
export function countryCatalogFrom(database: DatabaseSync, code: string): CountryCatalog | null {
  const slugs = Object.keys(SALARY_COUNTRY_CITIES[code] ?? {});
  if (!slugs.length) return null;
  const rows = database
    .prepare(
      `SELECT place_slug AS slug, max(place_label) AS label, count(*) AS count
         FROM catalog_entries
        WHERE status = 'active' AND path <> '' AND place_slug IN (${slugs.map(() => '?').join(',')})
        GROUP BY place_slug`,
    )
    .all(...slugs) as { slug: string; label: string; count: number }[];
  const readAt = new Date().toISOString();
  const labels = database
    .prepare(
      `SELECT salary_label AS label, source_name AS source
         FROM catalog_entries
        WHERE status = 'active' AND path <> '' AND salary_label IS NOT NULL AND salary_label <> ''
          AND place_slug IN (${slugs.map(() => '?').join(',')})
        LIMIT 20000`,
    )
    .all(...slugs) as { label: string; source: string | null }[];
  const pay = countryPoolPay(
    labels.map((row) => row.label),
    readAt,
    labels.map((row) => row.source ?? ''),
  );
  const value: CountryCatalog = { cities: rows, readAt, ...(pay ? { pay } : {}) };
  return value;
}
