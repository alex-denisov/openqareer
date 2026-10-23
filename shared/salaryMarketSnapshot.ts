export const MIN_SALARY_MARKET_SAMPLE = 5;
export const MAX_SALARY_MARKET_GROUPS = 12;
export const SALARY_MARKET_ROLE_LIMIT = 100;
export const SALARY_MARKET_INDEX_LIMIT = SALARY_MARKET_ROLE_LIMIT;

/** B351: one deduplicated catalog cluster is one observation; no source-row weighting.
 * Roles use unambiguous B267 ontology aliases. Unknown raw titles remain separate,
 * explicitly unclassified and noindex. Classification happens before the top100
 * publication cap. Skill frequency includes rows without extracted skills.
 * Grade slices use explicit published title markers only; IC is never Junior.
 * This remains a catalog sample, not a census or representative-market claim.
 */
export interface SalaryMarketSnapshot {
  readonly role: string;
  readonly roleLabel: string;
  readonly updatedAt: string;
  readonly windowDays: 90;
  readonly sampleSize: number;
  readonly skills: readonly {
    readonly name: string;
    readonly count: number;
    readonly frequency: number;
  }[];
  readonly salary: SalaryMarketDistribution;
  readonly quarterlyTrend: 'unavailable';
  readonly grades: 'unavailable' | 'published_title_evidence';
  readonly profession?: SalaryMarketProfession;
  readonly gradeSlices?: readonly SalaryMarketGradeSlice[];
  readonly source: 'deduplicated_public_catalog';
}

/** Explicit comparable salary evidence only. No currency conversion or inferred periods.
 * Amount is a reported point, not an inferred midpoint of an open-ended range.
 */
export interface SalaryObservation {
  readonly clusterId: string;
  readonly amount: number;
  readonly currency: string;
  readonly period: 'hour' | 'month' | 'year';
  readonly gross: boolean;
}

export interface SalaryPercentiles {
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
}
export interface SalaryMarketExclusions {
  readonly missingPeriod: number;
  readonly missingCurrency: number;
  readonly openRange: number;
  readonly invalidRange: number;
  readonly belowMinimumSample: number;
  readonly outsidePublishedGroups?: number;
}
export interface SalaryMarketGroup {
  readonly currency: string;
  readonly period: 'hour' | 'month' | 'year';
  readonly taxBasis: 'gross' | 'net' | 'unknown';
  readonly sampleSize: number;
  readonly lower: SalaryPercentiles;
  readonly upper: SalaryPercentiles;
}
/** Separate nearest-rank percentiles of lower/upper bounds of closed advertised ranges.
 * Each group has >=5 unique clusters and a single currency/explicit period/tax basis.
 * These are published offer ranges, not actual salaries or candidate outcomes.
 * Open ranges and groups below the publication minimum have exclusion counts.
 */
export type SalaryMarketDistribution =
  | {
      readonly status: 'available';
      readonly methodology: 'published_range_bounds';
      readonly groups: readonly SalaryMarketGroup[];
      readonly excluded: SalaryMarketExclusions;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'missing_explicit_salary_period' | 'no_comparable_ranges';
      readonly excluded: SalaryMarketExclusions;
    };

export interface SalaryMarketIndexEntry {
  readonly role: string;
  readonly roleLabel: string;
  readonly profession?: SalaryMarketProfession;
  readonly sampleSize: number;
  readonly updatedAt: string;
  readonly indexable: boolean;
}

export function salarySnapshotIndexable(snapshot: SalaryMarketSnapshot | null): boolean {
  return (
    snapshot !== null &&
    snapshot.profession?.kind === 'b267' &&
    snapshot.sampleSize >= MIN_SALARY_MARKET_SAMPLE &&
    snapshot.salary.status === 'available' &&
    snapshot.salary.groups.some((group) => group.sampleSize >= MIN_SALARY_MARKET_SAMPLE)
  );
}

export type SalaryMarketGrade = 'junior' | 'middle' | 'senior' | 'lead' | 'unknown';
export type SalaryMarketProfession =
  | { readonly kind: 'b267'; readonly roleId: string; readonly matchedAlias?: string }
  | { readonly kind: 'unclassified_title' };
export interface SalaryMarketGradeSlice {
  readonly grade: SalaryMarketGrade;
  readonly sampleSize: number;
  readonly skills: SalaryMarketSnapshot['skills'];
  readonly salary: SalaryMarketDistribution;
  readonly evidence: { readonly field: 'title'; readonly markers: readonly string[] };
}
