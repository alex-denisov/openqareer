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

Himalayas' explicit `salaryPeriod` is also preserved with its original value:
`hourly`, `monthly`, `annual` map to hour, month, year respectively. The adapter
uses no default for an absent field; weekly, fortnightly and unknown values stay
unsupported. The aggregator validates each provider's own field/value pair and
rejects a stored period that disagrees with its evidence. The next ordinary
scheduled source refresh updates existing rows and cluster projections; no
historical backfill assigns periods. Publication still requires five comparable
deduplicated clusters after the normal snapshot recomputation.

Quarterly skill comparisons use only real, persisted observations of the same
methodology. The first observation per role and UTC week is immutable; history
and current snapshots publish atomically. Retention is bounded to the current
100 canonical roles, 16 weeks and five independent grade samples. A baseline
must be 90–97 days old and both denominators at least five. Changes are observed
skill frequencies in percentage points, not market-wide demand or candidate
outcomes. A skill absent from the baseline Top15 is unknown, not zero. No old
observations are seeded: a new production installation honestly starts with
insufficient history. Candidate outcomes remain unavailable.

A standalone salary point helper rejects mixed period/currency/tax basis or
duplicate cluster IDs. Tests cover provider-to-persisted-catalog roundtrips,
canonical profession IDs, posted-grade denominators, history immutability,
transaction rollback and the complete public document delivery budget.

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

The public directory `/salaries` and profession pages `/salaries/:role` render
prepared snapshots with native GET filters for grade, salary cohort and skill
pagination. HTTP performs bounded primary-key reads, never source scans or
provider requests. Only evidenced canonical professions with sufficient samples
enter the sitemap. Missing salary/history evidence remains explicit; unavailable
roles and failures are noindex. The template preserves the existing public
chrome and contains no fake sample data.

No live crawling or provider account action was used to create this change.
Full US-14.6 acceptance still requires production observation evidence, elapsed
real history for a quarterly comparison and owner visual acceptance. Local
fixtures and checks do not prove those external outcomes.

## Explicit source geography cohorts

The global published role selection remains capped at 100 before geographic
aggregation. Each prepared role can carry four location slices: `remote`,
`europe`, `uae`, and `cis`. Each slice has its own denominator, Top15 skills,
comparable salary groups and up to five posted-grade slices. One cluster can
appear in remote and a country scope, but never twice inside one scope.

Country membership requires one unambiguous country name/code token in the
stored catalog location. The country-only GeoNames lookup never guesses from
a city. Raw postal/country collisions such as DE, CA, IL and Georgia remain
ambiguous unless an explicit full country resolves the ambiguity. Multi-country,
missing, city-only, oversized and unrecognized locations remain in the global
sample without acquiring an invented country. Company-office fallbacks,
currency, language and source platform are never country evidence.

Europe and CIS reuse OpenQareer's existing candidate-market policy, not legal
membership in a political organization. Russia remains its separate market;
UAE means the exact country AE, not all MENA. Remote uses the stored remote flag
independently; it never promises permission to work from any country. Aggregate
geography evidence reports explicit, unknown and ambiguous country counts;
remote count overlaps those counts. Unknown geography is not a claim of zero
vacancies in a market.

Weekly regional observations use distinct internal cohort keys containing
`geography-explicit-country-v1`. Global history and its existing methodology
version are unchanged. At most 100 canonical roles expand to 500 identities,
each retaining at most sixteen weekly observations. First actual observation
metadata survives weekly retention. No global observation becomes a regional
baseline, and an empty regional scope cannot seed a historical point. Regional
history capture, latest snapshots and directory publication share one rollback
boundary. The existing HTTP path still reads one prepared role key; location
and then grade selection belongs to the public renderer integration.
