# B351 public market snapshot foundation

The maintenance process computes a rolling 90-day snapshot of the deduplicated
public catalog, one `cluster_id` per observation. It counts each skill once per
cluster; vacancies without extracted skills remain in the denominator. Top 15
skills, catalog sample size and calculation timestamp are real derived values.
This is a catalog sample, not the complete pool or a representative population.
JSON is materialized in keyset batches of 500; skill counters stay in SQLite.
The web-facing readers perform primary-key lookups only: one role snapshot or
a prepared directory limited to 100 roles. The directory and role rows publish
in one transaction, with indexable roles first, then sample size descending.

Salary distributions use only closed ranges with explicit provider period evidence.
Each currency, period and gross/net/unknown tax basis has a separate group with a
publication minimum of five clusters. The result contains separate nearest-rank
percentiles for lower and upper published bounds; no midpoint, exchange conversion
or inferred period is used. Missing period/currency, open/invalid ranges and groups
below the minimum have explicit exclusion counts. These are advertised ranges,
not actual candidate salaries; the minimum does not establish representativeness.

Lever's documented `salaryRange.interval` is preserved by the adapter through the
compact cluster input and persisted cluster JSON on each normal sync. Only exact
`per-hour-wage`, `per-month-salary`, `per-year-salary` map to typed periods.
Unsupported or absent intervals remain unknown. Lever does not document gross/net
basis here, so those observations have an explicit unknown tax basis. The job
reads only salary JSON from the existing catalog-to-cluster join; no migration or
historical backfill assigns periods to legacy data. Until normal source sync has
observed enough comparable records, the salary result remains unavailable.

Junior/Middle/Senior/Lead, quarterly trend and candidate outcomes remain unavailable.
A standalone point helper additionally rejects mixed period/currency/tax basis or
duplicate cluster IDs. Salary snapshot tests cover actual provider-to-persisted-
catalog roundtrips and use role slugs directly from the catalog projection.

## Provider evidence and remaining work

1. `VacancySalary` now carries optional typed period and provider field provenance.
   Whole salary objects are preserved through `clusterProjectionOf` and deduplication;
   amounts and tax/period basis are never assembled from different observations.
2. Lever feeds `job.salaryRange` into the salary helper in
   `server/vacancies/atsBoardAdapters.ts`; the Lever-specific helper now preserves interval.
   The [official Postings API](https://github.com/lever/postings-api/blob/master/README.md)
   documents `salaryRange.currency`, `interval`, `min`, `max`. The next normal sync preserves explicit
   interval values without a separate crawl. Gross/net is not documented there;
   keep its absence explicit and exclude it from groups requiring known tax basis.
3. The [official HH API](https://api.hh.ru/openapi/redoc) documents
   `salary_range.mode` and `salary_range_frequency`. Mode is the salary period;
   payout frequency must not substitute for it. The current `hhVacancySearch`
   schema keeps only legacy `salary`; current `hhSearchState` compensation reader
   does not preserve mode. No existing fixture establishes that the current
   HTML-state source supplies mode, so its availability must be verified from
   an authorized saved response before adding a mapping. Do not re-enable a
   prohibited API or infer monthly pay from magnitude.
4. The maintenance job now uses a temporary compact observation table keyed by
   role and deduplicated cluster identity, indexed by currency, period, tax basis
   and published bound. It releases scratch tables after success or failure.
   Legacy rows remain unknown until re-observed. Production observation counts
   must be checked after a normal sync; fixture counts are not provider evidence.

No live crawling, provider account action, HTTP route or UI is part of this
foundation. Full B351 acceptance additionally requires observed comparable salary samples,
filters, public SSR/UI and verified owner acceptance.
