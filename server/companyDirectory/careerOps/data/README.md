# Career Ops employer board candidates

This snapshot combines all 588 board rows from the [Career Ops employer
registry](https://github.com/career-ops-hq/career-ops/tree/4eb444d0ba5fa75569c11ec503e2c0a864cf41fd/employers)
at commit `4eb444d0ba5fa75569c11ec503e2c0a864cf41fd`. It preserves the
upstream rows unchanged, including canonical careers URL, ATS, exact board ID,
regional instance, Workday host, employer domain when available, and
contribution provenance. The only transformation is concatenating the board
files in path order into one NDJSON file.

Employer registry by the Career Ops contributors, database maker Santiago
Fernández de Valderrama. See [contribution credits](CONTRIBUTIONS.md) and the
[CC BY 4.0 license](LICENSE).

Use these rows as leads for the company-directory profile verification
process. A canonical board URL identifies the provider instance. Keep
Greenhouse and Lever regions distinct and preserve Ashby and Workday ID case.
The employer domain and board association require evidence from the employer
or provider. Once the full company profile is verified, use the existing
company directory and placement workflow. The scheduler can pick up rows from
`company_placement`, so this file stays outside that table until review.
