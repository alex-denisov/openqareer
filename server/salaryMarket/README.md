# B351 public profession, posted-grade and salary snapshots

The maintenance process classifies raw published catalog titles into B267 role
IDs with the existing `rulesParse` dictionary, then aggregates a rolling 90-day
sample. An ontology alias must be unambiguous; generic single-word aliases must
also be a canonical role name. The dictionary's first collision is not treated
as classification evidence. Function-only matches do not invent a profession.
Unmatched/ambiguous titles stay separate per normalized raw title, have an
`unclassified_title` label and are excluded from search indexing.

Classification materializes only 500 source rows in JS at a time; its compact
projection lives in temporary SQLite tables. Only after classification does SQL
select at most 100 published groups: recognized professions first, then sample
size descending, then stable slug. All eligible deduplicated clusters in each
selected profession remain in its denominator. This is a catalog sample, not a
census or a claim of market representativeness. The bounded result has at most
100 roles, five posted-grade slices per role, 15 skills per slice and 12 salary
cohorts per slice. A source row contributes once to the aggregate and once to its
own grade slice, never twice within one denominator.

The canonical public slug derives from the ontology English role title, while
`profession.roleId` retains the B267 ID. Grade evidence is separate: only explicit
Junior/Middle/Senior/Lead markers in the original published title are used, before
catalog title cleanup. IC is never Junior. Lead Generation, Middle East, Senior
Director and conflicting grade markers remain unconfirmed. Grade evidence stores
`field: title` and up to eight actual marker examples; it describes the posting,
not the actual seniority of a person or a general qualification assessment.
Unconfirmed rows have their own unknown slice, with its own denominator.

The web-facing readers perform primary-key lookups only: one role snapshot or
a prepared directory limited to 100 roles. The directory and role rows publish
in one transaction. Grade filters select already prepared slices; no catalog scan
or live classification belongs in HTTP. Scratch tables are released after success
and failure. No candidate-owned resume, account, session or private outcome data
is read by this pipeline.

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

Quarterly trend and candidate outcomes remain unavailable: no historical or
candidate-outcome evidence has been added. A standalone point helper rejects
mixed period/currency/tax basis or
duplicate cluster IDs. Salary snapshot tests cover actual provider-to-persisted-
catalog roundtrips and verify canonical profession IDs and posted-grade denominators.

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
foundation. Full US-14.6 acceptance additionally requires production observation evidence,
public SSR/UI and owner acceptance, as well as any historical/trend claims and
other story criteria that remain unsupported. Implementing this pipeline alone
does not prove those external outcomes.
