/** Only explicit provider period metadata is accepted; unknown provider values stay unknown. */
export type VacancySalaryPeriod = 'hour' | 'month' | 'year';
export interface SalaryPeriodEvidence {
  readonly field: 'lever.salaryRange.interval' | 'himalayas.salaryPeriod' | 'hh.compensation.mode';
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

/** hh.ru page state names the salary period in `compensation.mode`
 * (live `hh.ru/search/vacancy` page, 26.10.2026; the official API documents the
 * same `salary_range.mode`). `frequency` is how often pay is made, not the period
 * of the amount, and never substitutes for it. Only MONTH is accepted: for HOUR
 * the page also carries `perModeFrom`, and which of the two amounts is hourly is
 * not established. SHIFT and FLY_IN_FLY_OUT have no hour/month/year cohort.
 */
export function hhSalaryPeriod(value: unknown): VacancySalaryPeriod | undefined {
  return value === 'MONTH' ? 'month' : undefined;
}

/** The period a stored evidence pair proves, or `undefined` for any other pair. */
export function periodOfEvidence(evidence: unknown): VacancySalaryPeriod | undefined {
  if (evidence === null || typeof evidence !== 'object') return undefined;
  const { field, value } = evidence as { field?: unknown; value?: unknown };
  switch (field) {
    case 'lever.salaryRange.interval':
      return leverSalaryPeriod(value);
    case 'himalayas.salaryPeriod':
      return himalayasSalaryPeriod(value);
    case 'hh.compensation.mode':
      return hhSalaryPeriod(value);
    default:
      return undefined;
  }
}
