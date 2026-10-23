/** Only explicit provider period metadata is accepted; unknown provider values stay unknown. */
export type VacancySalaryPeriod = 'hour' | 'month' | 'year';
export interface SalaryPeriodEvidence {
  readonly field: 'lever.salaryRange.interval';
  readonly value: string;
}

/** Lever documents these literal intervals in its developer compensation-band schema.
 * https://hire.lever.co/developer/documentation (interval).
 * Weekly/day/project and ambiguous fractional intervals are deliberately unsupported.
 */
export function leverSalaryPeriod(value: unknown): VacancySalaryPeriod | undefined {
  switch (value) {
    case 'per-hour-wage':
      return 'hour';
    case 'per-month-salary':
      return 'month';
    case 'per-year-salary':
      return 'year';
    default:
      return undefined;
  }
}
