import type { DatabaseSync } from 'node:sqlite';
import {
  MIN_CITY_SALARY_SAMPLE,
  type SalaryCityMarket,
  type SalaryCityRow,
  type SalaryMidpointGroup,
} from '../../shared/salaryMarketSnapshot';
import { periodOfEvidence } from '../../shared/vacancySalaryPeriod';
import { catalogPlaceOf, REMOTE_PLACE } from '../vacancies/vacancyCatalogFacets';
import type { CatalogEntry } from '../vacancies/vacancyCatalogPage';

const MAX_PUBLISHED_CITIES = 40;

export interface SalaryPlace {
  readonly slug: string;
  readonly label: string;
}
/** The catalog's own place, so a city row links to the same `/vacancies/<place>` page. */
export function salaryCityOf(location: string | null, isRemote: boolean): SalaryPlace | undefined {
  const place = catalogPlaceOf({ location: location ?? undefined, isRemote } as CatalogEntry);
  return place ?? undefined;
}

interface Midpoint {
  readonly currency: string;
  readonly taxBasis: SalaryMidpointGroup['taxBasis'];
  readonly midpoint: number;
}

/** Only closed monthly ranges with a provider-proven period; the midpoint of «от — до». */
export function monthlyMidpointOf(json: string | null): Midpoint | undefined {
  let salary: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json ?? 'null');
    if (parsed === null || typeof parsed !== 'object') return undefined;
    salary = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const period = periodOfEvidence(salary.periodEvidence);
  if (period !== 'month' || salary.period !== 'month') return undefined;
  const { from, to, currency } = salary;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/u.test(currency)) return undefined;
  if (typeof from !== 'number' || typeof to !== 'number') return undefined;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to < from) return undefined;
  return {
    currency,
    taxBasis: salary.gross === true ? 'gross' : salary.gross === false ? 'net' : 'unknown',
    midpoint: (from + to) / 2,
  };
}

export interface CityCounter {
  record(
    role: string,
    place: SalaryPlace | undefined,
    clusterId: string,
    json: string | null,
  ): void;
  assemble(role: string): SalaryCityMarket;
}

/** Disk-backed scratch so a large role never holds every midpoint in the heap. */
export function prepareSalaryCityScratch(database: DatabaseSync): CityCounter {
  database.exec(`CREATE TEMP TABLE salary_market_city_ranges (
    role TEXT NOT NULL, city TEXT NOT NULL, cluster_id TEXT NOT NULL, currency TEXT NOT NULL,
    tax_basis TEXT NOT NULL, midpoint REAL NOT NULL, PRIMARY KEY (role, city, cluster_id)
  ) WITHOUT ROWID;
  CREATE INDEX temp.salary_market_city_mid ON salary_market_city_ranges(role, city, currency, tax_basis, midpoint)`);
  const insert = database.prepare(
    'INSERT OR IGNORE INTO salary_market_city_ranges VALUES (?, ?, ?, ?, ?, ?)',
  );
  const vacancies = new Map<string, Map<string, number>>();
  const labels = new Map<string, string>();
  const ranged = new Map<string, number>();
  return {
    record(role, place, clusterId, json) {
      if (!place) return;
      const cityId = place.slug;
      if (!labels.has(cityId)) labels.set(cityId, place.label);
      const cities = vacancies.get(role) ?? new Map<string, number>();
      cities.set(cityId, (cities.get(cityId) ?? 0) + 1);
      vacancies.set(role, cities);
      const point = monthlyMidpointOf(json);
      if (!point) return;
      ranged.set(role, (ranged.get(role) ?? 0) + 1);
      insert.run(role, cityId, clusterId, point.currency, point.taxBasis, point.midpoint);
    },
    assemble(role) {
      return assembleCities(
        database,
        role,
        vacancies.get(role) ?? new Map(),
        labels,
        ranged.get(role) ?? 0,
      );
    },
  };
}

interface GroupRow {
  readonly city: string;
  readonly currency: string;
  readonly taxBasis: SalaryMidpointGroup['taxBasis'];
  readonly sampleSize: number;
}

function midpointGroup(database: DatabaseSync, role: string, row: GroupRow): SalaryMidpointGroup {
  const query = database.prepare(`SELECT midpoint FROM salary_market_city_ranges
    WHERE role = ? AND city = ? AND currency = ? AND tax_basis = ?
    ORDER BY midpoint LIMIT 1 OFFSET ?`);
  const rank = (fraction: number) =>
    (
      query.get(
        role,
        row.city,
        row.currency,
        row.taxBasis,
        Math.ceil(fraction * row.sampleSize) - 1,
      ) as { midpoint: number }
    ).midpoint;
  return {
    currency: row.currency,
    period: 'month',
    taxBasis: row.taxBasis,
    sampleSize: row.sampleSize,
    p25: rank(0.25),
    p50: rank(0.5),
    p75: rank(0.75),
  };
}

/** Per place the single largest currency/tax cohort with at least 30 ranges; nothing mixed. */
function assembleCities(
  database: DatabaseSync,
  role: string,
  vacancies: ReadonlyMap<string, number>,
  labels: ReadonlyMap<string, string>,
  rangedTotal: number,
): SalaryCityMarket {
  const rows = database
    .prepare(
      `SELECT city, currency, tax_basis AS taxBasis, count(*) AS sampleSize
      FROM salary_market_city_ranges WHERE role = ? GROUP BY city, currency, tax_basis
      ORDER BY city, sampleSize DESC, currency, tax_basis`,
    )
    .all(role) as unknown as GroupRow[];
  const largest = new Map<string, GroupRow>();
  for (const row of rows) if (!largest.has(row.city)) largest.set(row.city, row);
  const places: SalaryCityRow[] = [];
  for (const [city, row] of largest) {
    if (row.sampleSize < MIN_CITY_SALARY_SAMPLE) continue;
    places.push({
      city: labels.get(city) ?? city,
      placeSlug: city,
      vacancyCount: vacancies.get(city) ?? row.sampleSize,
      salary: midpointGroup(database, role, row),
    });
  }
  const remote = places.find((place) => place.placeSlug === REMOTE_PLACE);
  const cities = places
    .filter((place) => place.placeSlug !== REMOTE_PLACE)
    .sort((a, b) => b.vacancyCount - a.vacancyCount)
    .slice(0, MAX_PUBLISHED_CITIES);
  return {
    method: 'closed_monthly_range_midpoint_v1',
    minSample: MIN_CITY_SALARY_SAMPLE,
    rangedTotal,
    publishedSample: cities.reduce((sum, city) => sum + city.salary.sampleSize, 0),
    cities,
    ...(remote ? { remote } : {}),
  };
}
