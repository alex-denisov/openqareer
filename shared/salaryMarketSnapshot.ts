/** B351: one deduplicated catalog cluster is one observation; no source-row weighting.
 * Skill frequency uses all active catalog clusters published within the last 90 days
 * for the role, including clusters without extracted skills. This is a catalog sample,
 * not a census of the complete vacancy pool. Grade/trend require evidence not yet stored.
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
  readonly salary: {
    readonly status: 'unavailable';
    readonly reason: 'missing_explicit_salary_period';
  };
  readonly quarterlyTrend: 'unavailable';
  readonly grades: 'unavailable';
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
