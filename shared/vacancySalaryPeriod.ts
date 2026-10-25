/** Only explicit provider period metadata is accepted; unknown provider values stay unknown. */
export type VacancySalaryPeriod = 'hour' | 'month' | 'year';
export interface SalaryPeriodEvidence {
  readonly field: 'lever.salaryRange.interval' | 'himalayas.salaryPeriod';
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

/** Himalayas documents minSalary/maxSalary in the stated salaryPeriod.
 * https://himalayas.app/docs/openapi.json (Job.salaryPeriod).
 * Do not apply the provider's legacy annual default when the response omits it.
 * Weekly/fortnightly cannot enter the supported hour/month/year cohorts.
 */
export function himalayasSalaryPeriod(value: unknown): VacancySalaryPeriod | undefined {
  switch (value) {
    case 'hourly':
      return 'hour';
    case 'monthly':
      return 'month';
    case 'annual':
      return 'year';
    default:
      return undefined;
  }
}
