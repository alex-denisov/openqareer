# B614 company enrichment CLI

This is a Python 3.10+ standard-library pipeline for private company registry enrichment. It keeps source observations, queue state, proposals, reviewer decisions, and full-row apply backups outside the checkout. The default path is dry-run. It never inserts/deletes companies or changes source, ATS, or status fields.

LinkedIn IDs are created only from imported, provider-bound evidence; `enqueue --from-baseline` creates `awaiting_import` jobs and `claim` excludes them. The corporate HTTPS worker is disabled until per-request host pacing includes reviewed jitter. Saved observations record source-page access separately from destination availability; a 429 keeps destination access in cooldown, while an exact published employee href may still support an unapproved ID candidate.

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

The importer accepts `{updates:[...]}` and the current research packet shape `{patches:[...]}`. A proposal keeps exact `expected` and new values, the evidence record, evidence hash, identity confidence, deterministic validation result, and a stable candidate ID. `approved:true` from an input packet is ignored. If a proposed value already equals the initialized current value, replay is counted as unchanged even when the packet's expected-old value is stale; a different proposed value with a stale expected-old value remains a conflict. A missing source status is not rewritten to HTTP 200: imported source content must be explicitly marked as observed, with the destination state recorded independently. Ambiguous identity or taxonomy goes to the exception table. Only packet shapes normalized by this CLI are treated as evidence; unknown or split field formats remain exceptions with an adapter-gap reason, never as `unavailable`, resolved, or fully processed. Supported saved-source paths include `raw_file` primary-source captures, `source_file` plus `line` JSONL records, paired LinkedIn legacy captures, and the optional careers destination-check capture documented below.

## LinkedIn legacy capture binding

A legacy LinkedIn ID candidate that names `raw_find_file` and `raw_click_file` is accepted only when the private captures contain the paired raw evidence. The find capture must tie the company row's primary page reference and URL to one source block with the matching citation, employer title and heading, and an employee CTA link marker. The click capture must contain the exact `click({ref_id, id})` call for that result and link marker; its same result block must expose one LinkedIn employee target with a single numeric `facetCurrentCompany`. Candidate packet identity, URL, rendered-link arrays, and status fields are leads only. The raw captures remain under the private evidence root and are hashed into the proposal.

A signup redirect proves href metadata only. It does not show employee-list or jobs content is available. A wrapped 429 in the exact click result stays deferred as destination cooldown; source-page evidence remains separate. Missing CTA, invocation, target, or unique ID is recorded as an exception rather than repaired from another block in the batch.

## Public-index acquisition bridge

The CLI includes a checkpointed bridge for the permitted `mcp__codex_apps__search_service_web_run` public-index tool. It batches at most four stable request IDs per operation, stores each exact exported manifest in SQLite, and accepts a capture only when its provider, operation, request IDs, tool arguments, and manifest hash match that export. Before each provider call, the workstation runner asks Python to recompute its canonical JSON hash and verify the manifest against the active SQLite export, including the exact per-stage tool arguments. The workstation host runner performs one provider call for the batch and saves its full text response; Python does not issue HTTP requests to LinkedIn. Search references are leads. A candidate is created only after the saved open/find/click chain ties the company page, employee CTA marker, exact click invocation, and one numeric employee-facet target together. Same-slug localized LinkedIn hosts are collapsed, preferring `www.linkedin.com` and the root company route over jobs routes. Ambiguous slugs, invalid refs, missing CTAs, and non-unique facets stay unresolved. Search and provider-ref recovery are bounded to three attempts; a mismatched `Source: open` ref returns to search by the same stable query. Search Service 401/403 is terminal. A Search Service HTTP 429 writes a durable global cooldown and retries only after its cooldown expires. An exact LinkedIn route 401/403/429 is terminal; a single employee-facet href from an exact 429 click result can support an unapproved ID candidate while destination access remains cooldown-pending. If a 429 `Source:` ref does not match any ref in the active manifest, the result is recorded as `unbound_platform_429`; affected requests become call-uncertain, and only a fresh search by stable query can recover them. The host pauses after either kind of platform 429 until an operator explicitly resumes it; no denied or uncertain ref/click is re-exported. No employee-list content is claimed. Open/find/click exports require `--allow-indexed-linkedin-content`, recorded in the hashed manifest. This standalone workstation tool requires a host that exposes the permitted Search Service provider; Codex availability does not establish availability in the OpenQareer web app or production worker. Do not bundle it into the web app artifact.

Import the saved public-index root search envelopes against the exact private acquisition plan, then let the host runner consume the exported manifests and save immutable captures under the private evidence root:

```sh
python3 scripts/b614_enrichment/cli.py public-index-import-root-batches \
  --state STATE.sqlite \
  --plan PRIVATE_RESUME_DIR/acquisition-plan.json \
  --batches-dir PRIVATE_RESUME_DIR/public-index-root-batches \
  --evidence-root PRIVATE_RESUME_DIR

python3 scripts/b614_enrichment/cli.py public-index-export \
  --state STATE.sqlite --stage search --limit 4 --out PRIVATE_RESUME_DIR/next-manifest.json
# Call the permitted Search Service operation named in next-manifest.json.tool_args.
# Save its complete response in a capture JSON beside the manifest, then import it:
python3 scripts/b614_enrichment/cli.py public-index-import \
  --state STATE.sqlite --capture PRIVATE_RESUME_DIR/next-capture.json \
  --evidence-root PRIVATE_RESUME_DIR

# Page-content operations require this explicit per-export permission:
python3 scripts/b614_enrichment/cli.py public-index-export \
  --state STATE.sqlite --stage open --limit 4 --allow-indexed-linkedin-content \
  --out PRIVATE_RESUME_DIR/next-open-manifest.json
```

After each import, export the next eligible stage (`search`, `open`, `find`, or `click`) until the report shows no eligible requests. A capture envelope must include `provider`, `stage`, `operation`, `batch_id`, `manifest_sha256`, exact `request_ids`, exact `tool_args`, `raw_result_text`, and `is_error`; include `provider_error_status` and `retry_after` only when the provider reports them. Save the complete response text, including citation markers and `Source:` invocation blocks. Keep plans, manifests, captures, SQLite state, and reports outside the checkout in a mode-0700 private evidence directory. Do not fabricate a capture or reuse a response from a different request batch. The resulting candidates remain unapproved and require separate review.

### Run or resume the workstation host driver

Run this callback inside `functions.exec` in a host where the Search Service tool is actually available. The private SQLite state, exact baseline-matched plan, and evidence directory must already be initialized. Set `WORKTREE`, `STATE`, and `EVIDENCE_ROOT` to the existing checkout and private files, then paste this callback:

```js
// @exec: {"yield_time_ms": 120000}
const WORKTREE = "/path/to/openqareer-worktree";
const STATE = "/private/path/state.sqlite";
const EVIDENCE_ROOT = "/private/path/resume";

const source = await tools.exec_command({
  cmd: "cat scripts/b614_enrichment/public_index_host_driver.cjs",
  workdir: WORKTREE,
  max_output_tokens: 7000,
});
if (source.exit_code !== 0) throw new Error("Could not load the workstation host driver");

const factories = new Function(
  `${source.output}\nreturn { createB614PublicIndexHostDriver, createB614FunctionsExecRuntime };`,
)();
const runtime = factories.createB614FunctionsExecRuntime({ tools, worktree: WORKTREE });
const driver = factories.createB614PublicIndexHostDriver(runtime);
const result = await driver.run({
  statePath: STATE,
  evidenceRoot: EVIDENCE_ROOT,
  maxBatches: 20,
  allowIndexedLinkedinContent: true,
});
text(JSON.stringify(result));
```

Each callback run processes at most `maxBatches` tool calls; each call handles up to four requests. With content opt-in, the runner prioritizes click, find, open, then search so it uses live page refs before requesting more refs. Without opt-in it runs search only. Run it again to resume from SQLite. The driver stores one immutable capture per batch before importing it, and stores an attempt marker before each provider call. If a callback ends after a call starts but before its response is saved, the next run stops on that uncertain batch instead of duplicating the call. When the lease expires, the CLI marks uncertain open/find/click work and schedules a fresh search using the same stable query; it does not replay that exact old ref or click. Captures, manifests, pause state, locks, and reports stay under the private evidence directory, and the callback prints only aggregate outcomes.

A Search Service HTTP 429 stops the current callback and records a global cooldown in both the CLI state and the private host state. Re-run after the reported `pause_until`. A platform-route 429 stops the callback and stores a manual-resume pause. After reviewing the captured response, an operator can resume other eligible requests with `resumeAfterManualPause: true`; the exact denied request remains terminal in SQLite and is never clicked again. If a callback is interrupted while holding `public-index-host/host-driver.lock`, verify that no host run is still active before removing that stale lock. The state and immutable captures remain the checkpoint.

The host driver is a workstation-only operator tool, not part of the Vite/Fastify app artifact. The repository's `main` release workflow deploys the app; it does not install the workstation runtime. A PR follows the repository review path, but approval or merge does not install this tool. Keep it in a reviewed source-control branch and execute it only from a pinned workstation checkout with the approved provider.

Offline checks for the host driver and CLI:

```sh
node --check scripts/b614_enrichment/public_index_host_driver.cjs
node --test scripts/b614_enrichment/test_public_index_host_driver.cjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/b614_enrichment -p 'test_*.py' -v
```

## Careers source and destination binding

For legacy `careers_url` patches that cite `source_file` plus a 1-based `line`, pass the matching private destination-check capture with `--destination-checks`. The source line must bind the baseline company key, the packet's exact source URL, the employer page title, and exactly one `careers_links.url` equal to the proposed value. The destination record is selected by normalized HTTPS host and path plus company-key membership when supplied; its record index and hashes are stored with the proposal.

A successful matching destination probe supports `general_jobs_portal` only when the published employer link, returned page, and non-narrow entry route agree. It does not assert a worldwide vacancy inventory. A locale-prefixed page remains an exception unless the captured page title or an exact outgoing link explicitly identifies global roles. Cross-host or changed-path redirects, missing/ambiguous destination rows, 403, 404, and 429 remain separate access states or exceptions. No HTTP 200 is inferred from a published link.

```sh
python3 scripts/b614_enrichment/cli.py import-packet \
  --state STATE.sqlite \
  --packet careers-patches.json \
  --evidence-root PRIVATE_RESUME_DIR \
  --destination-checks PRIVATE_RESUME_DIR/shard2-field-destination-checks.json
```

## Queue and retry operations

Task input is a JSON array (or `{ "tasks": [...] }`) with `company_key`, `task_kind`, `provider`, and optional exact `source_url`. IDs are SHA-256 hashes of those stable fields; they do not depend on row offsets. Repeated enqueue is idempotent. Jobs are leased, and expired leases are recovered by ID after restart. Use the same expected task file for exact completion reconciliation:

```sh
python3 scripts/b614_enrichment/cli.py claim --state STATE.sqlite --limit 100 --lease-seconds 600
python3 scripts/b614_enrichment/cli.py record --state STATE.sqlite --job-id JOB_ID --lease-token TOKEN --status completed --result '{"reason":"source_checked"}'
python3 scripts/b614_enrichment/cli.py reconcile --state STATE.sqlite --tasks tasks.json
```

The `corporate-fetch` command is intentionally disabled. It fails before leasing jobs or making a request until per-request host pacing includes reviewed jitter. The offline cache and report commands remain available.

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

The deterministic checks do not prove every imported page is authoritative. Reviewer inspection of exact primary URLs, context, and raw-source hashes remains required. The public-index bridge does not raw-scrape LinkedIn, bypass access controls, or claim registry ID completion; corporate source fetching also remains disabled pending reviewed jittered pacing.
