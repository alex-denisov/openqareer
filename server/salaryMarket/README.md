# B351 public market snapshot foundation

The maintenance process computes a rolling 90-day snapshot of the deduplicated
public catalog, one `cluster_id` per observation. It counts each skill once per
cluster; vacancies without extracted skills remain in the denominator. Top 15
skills, catalog sample size and calculation timestamp are real derived values.
This is a catalog sample, not the complete pool or a representative population.
JSON is materialized in keyset batches of 500; skill counters stay in SQLite.
The web-facing reader performs a role primary-key lookup only.

Salary distribution is unavailable in this slice: `VacancySalary` has no explicit
period. Existing B546 midpoint estimates omit period and tax-basis grouping and
are not reused. Junior/Middle/Senior/Lead, quarterly trend and candidate outcomes
are unavailable; no grade or historical data is inferred. A standalone helper
computes nearest-rank percentiles for explicit point observations with unique
cluster IDs and identical currency, period and gross/net basis. It is not fed
by the current catalog and does not make a production salary claim.

## Next evidence-preserving salary slice

1. Add optional typed period and provider field provenance to `VacancySalary`.
   Preserve them through `clusterProjectionOf` and deduplication; conflicting
   observations must not inherit an arbitrary representative's tax/period basis.
2. Lever already feeds `job.salaryRange` into `rangeSalary` in
   `server/vacancies/atsBoardAdapters.ts`; that helper currently discards interval.
   The [official Postings API](https://github.com/lever/postings-api/blob/master/README.md)
   documents `salaryRange.currency`, `interval`, `min`, `max`. Preserve explicit
   interval values on the next normal sync. Gross/net is not documented there;
   keep its absence explicit and exclude it from groups requiring known tax basis.
3. The [official HH API](https://api.hh.ru/openapi/redoc) documents
   `salary_range.mode` and `salary_range_frequency`. Mode is the salary period;
   payout frequency must not substitute for it. The current `hhVacancySearch`
   schema keeps only legacy `salary`; current `hhSearchState` compensation reader
   does not preserve mode. No existing fixture establishes that the current
   HTML-state source supplies mode, so its availability must be verified from
   an authorized saved response before adding a mapping. Do not re-enable a
   prohibited API or infer monthly pay from magnitude.
4. Add a compact observation projection keyed by deduplicated cluster identity,
   salary currency, period and tax basis, plus explicit provenance/observed time.
   Refresh it in bounded maintenance steps on normal sync; legacy rows remain
   unknown until re-observed. Aggregate comparable groups separately and retain
   their own sample sizes. Do not mix or convert currencies or periods.

No live crawling, provider account action, HTTP route or UI is part of this
foundation. Full B351 acceptance additionally requires actual comparable salary
observations, filters, public SSR/UI and verified owner acceptance.
