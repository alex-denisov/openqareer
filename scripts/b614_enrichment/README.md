# B614 company enrichment CLI

This is a Python 3.10+ standard-library pipeline for private company registry enrichment. It keeps source observations, queue state, proposals, reviewer decisions, and full-row apply backups outside the checkout. The default path is dry-run. It never inserts/deletes companies or changes source, ATS, or status fields.

LinkedIn is an imported-evidence provider only. `enqueue --from-baseline` creates `awaiting_import` LinkedIn jobs; `claim` excludes them, and `corporate-fetch` blocks LinkedIn and known redirectors at every hop. A robots/access denial is terminal `policy_denied`; a 429 is `cooldown_pending` with `Retry-After` plus exponential jitter. Evidence records source-page access separately from a LinkedIn destination’s availability.

## Private state and current evidence

Initialize from a full, private 16-column snapshot. The sanitized seven-field projection is not accepted for apply state:

```sh
python3 scripts/b614_enrichment/cli.py init \
  --state "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/state.sqlite" \
  --baseline "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/shard1/full-apply-baseline-20261107.json"
```

Enqueue the stable tasks, or import an existing primary-evidence patch packet. The `--evidence-root` is a private directory; raw evidence paths must remain under it, be regular non-symlink files, and stay below the 25 MB per-file bound.

```sh
python3 scripts/b614_enrichment/cli.py enqueue --state "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/state.sqlite" --from-baseline
python3 scripts/b614_enrichment/cli.py import-packet \
  --state "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/state.sqlite" \
  --packet "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/shard0/field-patches-001-025-v5.json" \
  --evidence-root "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume"
python3 scripts/b614_enrichment/cli.py report --state "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/state.sqlite" \
  --out "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/coverage.json"
```

The importer accepts `{updates:[...]}` and the current research packet shape `{patches:[...]}`. A proposal keeps exact `expected` and new values, the evidence record, evidence hash, identity confidence, deterministic validation result, and a stable candidate ID. `approved:true` from an input packet is ignored. If a proposed value already equals the initialized current value, replay is counted as unchanged even when the packet's expected-old value is stale; a different proposed value with a stale expected-old value remains a conflict. A missing source status is not rewritten to HTTP 200: imported source content must be explicitly marked as observed, with the destination state recorded independently. Ambiguous identity or taxonomy goes to the exception table. Only packet shapes normalized by this CLI are treated as evidence; unknown or split field formats remain exceptions with an adapter-gap reason, never as `unavailable`, resolved, or fully processed. Supported saved-source paths include `raw_file` primary-source captures, `source_file` plus `line` JSONL records, and the paired LinkedIn legacy captures documented below. A careers source line without its general-portal scope observation remains an adapter-gap exception; this version does not join separate destination-check packets.

## LinkedIn legacy capture binding

A legacy LinkedIn ID candidate that names `raw_find_file` and `raw_click_file` is accepted only when the private captures contain the paired raw evidence. The find capture must tie the company row's primary page reference and URL to one source block with the matching citation, employer title and heading, and an employee CTA link marker. The click capture must contain the exact `click({ref_id, id})` call for that result and link marker; its same result block must expose one LinkedIn employee target with a single numeric `facetCurrentCompany`. Candidate packet identity, URL, rendered-link arrays, and status fields are leads only. The raw captures remain under the private evidence root and are hashed into the proposal.

A signup redirect proves href metadata only. It does not show employee-list or jobs content is available. A wrapped 429 in the exact click result stays deferred as destination cooldown; source-page evidence remains separate. Missing CTA, invocation, target, or unique ID is recorded as an exception rather than repaired from another block in the batch.

## Queue and retry operations

Task input is a JSON array (or `{ "tasks": [...] }`) with `company_key`, `task_kind`, `provider`, and optional exact `source_url`. IDs are SHA-256 hashes of those stable fields; they do not depend on row offsets. Repeated enqueue is idempotent. Jobs are leased, and expired leases are recovered by ID after restart. Use the same expected task file for exact completion reconciliation:

```sh
python3 scripts/b614_enrichment/cli.py claim --state STATE.sqlite --limit 100 --lease-seconds 600
python3 scripts/b614_enrichment/cli.py record --state STATE.sqlite --job-id JOB_ID --lease-token TOKEN --status completed --result '{"reason":"source_checked"}'
python3 scripts/b614_enrichment/cli.py reconcile --state STATE.sqlite --tasks tasks.json
```

Only the public corporate HTTPS adapter is executable. It pins a DNS-validated public IP, permits port 443 only, validates every redirect, caps response bytes, caches compact metadata and hashes, and applies persistent per-host spacing. The optional kill-switch is a file path: if it exists, no work starts; if created while a run is in flight, active leases expire for later resume.

```sh
python3 scripts/b614_enrichment/cli.py corporate-fetch --state STATE.sqlite --limit 40 --concurrency 4 --min-host-interval 2 --kill-switch /private/tmp/b614-stop
```

## Review, export, and apply

Only deterministic `valid_pending_review` candidates can be approved. Review input must carry the exact candidate hash. Approvals are separate, immutable audit records.

```sh
python3 scripts/b614_enrichment/cli.py approve-batch --state STATE.sqlite --manifest approvals.json --reviewer registry-reviewer
python3 scripts/b614_enrichment/cli.py export-approved --state STATE.sqlite --out "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/approved-20261107.json"
python3 scripts/b614_enrichment/cli.py apply --state STATE.sqlite --db /path/to/company-directory.sqlite --backup-dir "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/before-images"
```

The last command is a dry-run. A write requires the exact exported manifest plus both independent hashes:

```sh
python3 scripts/b614_enrichment/cli.py apply --state STATE.sqlite \
  --db /path/to/company-directory.sqlite \
  --backup-dir "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/before-images" \
  --manifest "$HOME/.openqareer/research/company-registry-enrichment-20261106/resume/b614/approved-20261107.json" \
  --apply --confirm-baseline-sha BASELINE_SHA --confirm-manifest-sha MANIFEST_SHA
```

Apply verifies the full 16-column table and row set inside `BEGIN IMMEDIATE`, checks every expected old value, updates only reviewed profile fields and `updated_at`, validates exact per-row non-target invariants, and rolls back on any mismatch. It writes a mode-0600 before-image and an audit record. State and output paths must be mode-0700 private directories outside this Git worktree; exported/before-image artifacts are immutable and refuse overwrite.

## Synthetic capacity check

This does not research companies or send network requests. It drives the real SQLite queue, duplicate enqueue, expired-lease resume, exact ID reconciliation, and source-cache lookup against generated-only fixtures:

```sh
python3 scripts/b614_enrichment/cli.py benchmark --jobs 30000
python3 -m unittest discover -s scripts/b614_enrichment -p 'test_*.py' -v
```

The deterministic checks do not prove every imported page is authoritative. Reviewer inspection of exact primary URLs, context, and raw-source hashes remains required; there is no live LinkedIn adapter or claim that the registry’s LinkedIn IDs can be auto-completed from this CLI.
