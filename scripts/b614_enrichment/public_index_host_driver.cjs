"use strict";

const PUBLIC_INDEX_PROVIDER = "mcp__codex_apps__search_service_web_run";
const STAGES = ["search", "open", "find", "click"];
const CONTENT_STAGES = new Set(["open", "find", "click"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeBatchTag(batchId) {
  return typeof batchId === "string" ? batchId.slice(0, 12) : "unknown";
}

function extractText(result) {
  if (typeof result === "string") return result;
  if (result && Array.isArray(result.content)) {
    return result.content.map((part) => {
      if (part && part.type === "text" && typeof part.text === "string") return part.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  if (result && typeof result.raw_result_text === "string") return result.raw_result_text;
  return "";
}

function sourceBlocks(rawText) {
  return String(rawText || "").split(/-{80}/g);
}

function platformRouteStatus(rawText) {
  const rateLimitPatterns = [
    /\(\s*429\s*\)\s*too many requests/i,
    /failed to fetch[^\n]{0,400}\(?\s*429\s*\)?/i,
    /\b429\s+too many requests\b/i,
    /http(?:error| status)?[^\n]{0,80}\b429\b/i,
    /status(?: code)?\s*[:=]?\s*429\b/i,
  ];
  for (const block of sourceBlocks(rawText)) {
    if (!/\bSource:\s*(?:open|find|click)\s*\(/i.test(block)) continue;
    if (/robots\.txt|blocked by robots|disallowed by robots|\b401\b|\b403\b/i.test(block)) return "policy_denied";
    if (rateLimitPatterns.some((pattern) => pattern.test(block))) return "platform_restriction";
  }
  return null;
}

function providerRateLimitWithoutSource(rawText) {
  if (/\bSource:\s*(?:open|find|click)\s*\(/i.test(rawText)) return false;
  return /\b429\s+too many requests\b|\bHTTP(?: status)?\s*429\b|\(\s*429\s*\)\s*too many requests/i.test(rawText);
}

function statusFromProviderError(rawText) {
  const match = rawText.match(/(?:HTTP(?: status)?\s*|status(?: code)?\s*[:=]?\s*|\(\s*)(401|403|429)\b|\b(401|403|429)\s+(?:Unauthorized|Forbidden|Too Many Requests)\b/i);
  const value = match && (match[1] || match[2]);
  return value ? Number(value) : null;
}

function retryAfterMilliseconds(value, nowMs) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value * 1000);
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value.trim());
  if (Number.isFinite(numeric)) return Math.max(0, numeric * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

function providerRetryWindowMilliseconds(manifest, retryAfterMs) {
  const attempts = (manifest.requests || []).map((request) => Number(request.attempt) || 1);
  const maxAttempt = Math.max(1, ...attempts);
  const exponentialBaseSeconds = Math.min(3600, 30 * (2 ** Math.max(0, maxAttempt - 1)));
  const jitterCeilingMs = exponentialBaseSeconds * 1.2 * 1000;
  return Math.max(36000, retryAfterMs || 0, jitterCeilingMs);
}

function validateManifest(manifest, expectedStage, allowIndexedLinkedinContent) {
  assert(manifest && typeof manifest === "object", "exported manifest is not an object");
  assert(manifest.provider === PUBLIC_INDEX_PROVIDER, "manifest names an unsupported provider");
  assert(manifest.stage === expectedStage, "manifest stage changed after export");
  assert(typeof manifest.batch_id === "string" && /^[a-f0-9]{64}$/.test(manifest.batch_id), "manifest batch_id is invalid");
  assert(typeof manifest.manifest_sha256 === "string" && /^[a-f0-9]{64}$/.test(manifest.manifest_sha256), "manifest hash is invalid");
  assert(Array.isArray(manifest.request_ids) && manifest.request_ids.length >= 1 && manifest.request_ids.length <= 4,
    "manifest request count is outside the one-to-four limit");
  assert(new Set(manifest.request_ids).size === manifest.request_ids.length, "manifest has duplicate request IDs");
  assert(Array.isArray(manifest.requests)
    && manifest.requests.length === manifest.request_ids.length
    && manifest.requests.every((request, index) => request.request_id === manifest.request_ids[index]),
  "manifest request rows do not match the stable request ID list");
  const operation = expectedStage === "search" ? "system2_search_query" : expectedStage;
  assert(manifest.operation === operation && manifest.tool_args && Array.isArray(manifest.tool_args[operation]),
    "manifest operation arguments are missing");
  assert(manifest.tool_args[operation].length === manifest.request_ids.length,
    "manifest operation count does not match its request IDs");
  if (CONTENT_STAGES.has(expectedStage)) {
    assert(allowIndexedLinkedinContent === true, "page-content stages require explicit workstation opt-in");
    assert(manifest.indexed_linkedin_content_authorized === true,
      "manifest does not record indexed LinkedIn content authorization");
  }
}

function createB614PublicIndexHostDriver(adapters) {
  const required = [
    "preparePrivatePaths", "acquireLock", "releaseLock", "exportBatch", "exists",
    "readJson", "writeImmutableJson", "callSearchService", "importCapture", "writeReport", "newRunId",
    "readGlobalPause", "writeGlobalPause", "clearGlobalPause",
  ];
  for (const name of required) assert(typeof adapters?.[name] === "function", `missing host adapter: ${name}`);

  async function run({ statePath, evidenceRoot, maxBatches = 20, allowIndexedLinkedinContent = false,
    resumeAfterManualPause = false }) {
    assert(typeof statePath === "string" && statePath.startsWith("/"), "statePath must be absolute");
    assert(typeof evidenceRoot === "string" && evidenceRoot.startsWith("/"), "evidenceRoot must be absolute");
    assert(Number.isInteger(maxBatches) && maxBatches >= 1 && maxBatches <= 500,
      "maxBatches must be an integer between 1 and 500");

    const paths = await adapters.preparePrivatePaths(evidenceRoot);
    const runId = adapters.newRunId();
    await adapters.acquireLock(paths.lockPath, { run_id: runId, started_at: new Date().toISOString() });

    const summary = {
      run_id: runId,
      state_path: statePath,
      batch_count: 0,
      stage_counts: {},
      request_outcomes: {},
      candidate_outcomes: {},
      stop_reason: "queue_idle",
      report_path: null,
    };
    let manifestSequence = 0;
    const nowMs = typeof adapters.now === "function" ? adapters.now : () => Date.now();
    let canProcess = true;

    try {
      const globalPause = await adapters.readGlobalPause(paths.globalPausePath);
      if (globalPause && globalPause.kind === "search_service_cooldown") {
        if (Number(globalPause.paused_until_ms) > nowMs()) {
          summary.stop_reason = "search_service_cooldown_pause_active";
          summary.pause_until = new Date(Number(globalPause.paused_until_ms)).toISOString();
          canProcess = false;
        }
        await adapters.clearGlobalPause(paths.globalPausePath);
      } else if (globalPause && globalPause.kind === "platform_restriction") {
        if (!resumeAfterManualPause) {
          summary.stop_reason = "platform_restriction_requires_operator_resume";
          canProcess = false;
        }
        await adapters.clearGlobalPause(paths.globalPausePath);
      }

      outer: while (canProcess && summary.batch_count < maxBatches) {
        let exportedAny = false;
        for (const stage of STAGES) {
          if (CONTENT_STAGES.has(stage) && !allowIndexedLinkedinContent) {
            summary.stop_reason = "indexed_linkedin_content_opt_in_required";
            break outer;
          }

          manifestSequence += 1;
          const manifestPath = paths.pathFor(`manifest-${stage}-${runId}-${manifestSequence}.json`);
          const exported = await adapters.exportBatch({
            statePath,
            stage,
            manifestPath,
            allowIndexedLinkedinContent,
          });
          if (exported && exported.providerPaused) {
            const pausedUntilMs = Number(exported.pausedUntilMs);
            await adapters.writeGlobalPause(paths.globalPausePath, {
              kind: "search_service_cooldown",
              paused_at: new Date(nowMs()).toISOString(),
              paused_until_ms: pausedUntilMs,
              reason: "search_service_provider_state_cooldown",
            });
            summary.stop_reason = "search_service_cooldown_pause_active";
            if (Number.isFinite(pausedUntilMs)) summary.pause_until = new Date(pausedUntilMs).toISOString();
            break outer;
          }
          if (!exported || exported.eligible !== true) continue;

          exportedAny = true;
          const manifest = exported.manifest;
          validateManifest(manifest, stage, allowIndexedLinkedinContent);
          const capturePath = paths.pathFor(`capture-${manifest.batch_id}.json`);
          const attemptPath = paths.pathFor(`attempt-${manifest.batch_id}.json`);

          let captureSummary;
          let importResult;
          if (await adapters.exists(capturePath)) {
            const saved = await adapters.readJson(capturePath);
            captureSummary = {
              is_error: saved.is_error === true,
              provider_error_status: saved.provider_error_status || null,
              platform_status: platformRouteStatus(String(saved.raw_result_text || "")),
              provider_rate_limited: saved.provider_error_status === 429
                || (!saved.is_error && providerRateLimitWithoutSource(String(saved.raw_result_text || ""))),
            };
            importResult = await adapters.importCapture({ statePath, capturePath, evidenceRoot });
          } else {
            if (await adapters.exists(attemptPath)) {
              summary.stop_reason = "call_uncertain_wait_for_lease_expiry";
              break outer;
            }

            await adapters.writeImmutableJson(attemptPath, {
              batch_id: manifest.batch_id,
              manifest_sha256: manifest.manifest_sha256,
              stage,
              run_id: runId,
              attempted_at: new Date().toISOString(),
            });

            let providerResult;
            try {
              providerResult = await adapters.callSearchService(manifest.tool_args);
            } catch (error) {
              summary.stop_reason = "provider_call_uncertain_wait_for_lease_expiry";
              summary.last_error_type = error && error.name ? String(error.name) : "ProviderCallError";
              break outer;
            }

            const rawResultText = extractText(providerResult);
            const routeStatus = platformRouteStatus(rawResultText);
            const isProviderError = (providerResult?.isError === true && routeStatus === null)
              || (routeStatus === null && providerRateLimitWithoutSource(rawResultText));
            const providerStatus = isProviderError
              ? (statusFromProviderError(rawResultText) || (providerRateLimitWithoutSource(rawResultText) ? 429 : null))
              : null;
            const capture = {
              provider: manifest.provider,
              stage: manifest.stage,
              operation: manifest.operation,
              batch_id: manifest.batch_id,
              manifest_sha256: manifest.manifest_sha256,
              request_ids: manifest.request_ids,
              tool_args: manifest.tool_args,
              raw_result_text: rawResultText,
              is_error: isProviderError,
            };
            if (providerStatus !== null) capture.provider_error_status = providerStatus;
            const retryAfter = providerResult?.retry_after
              ?? providerResult?.structuredContent?.retry_after
              ?? providerResult?._meta?.retry_after;
            if (isProviderError && (typeof retryAfter === "string" || typeof retryAfter === "number")) {
              capture.retry_after = String(retryAfter);
            }

            await adapters.writeImmutableJson(capturePath, capture);
            importResult = await adapters.importCapture({ statePath, capturePath, evidenceRoot });
            captureSummary = {
              is_error: isProviderError,
              provider_error_status: providerStatus,
              platform_status: routeStatus,
              provider_rate_limited: providerStatus === 429,
            };
          }

          summary.batch_count += 1;
          summary.stage_counts[stage] = (summary.stage_counts[stage] || 0) + 1;
          const imported = importResult;
          if (imported && imported.request_outcomes) {
            for (const [status, count] of Object.entries(imported.request_outcomes)) {
              summary.request_outcomes[status] = (summary.request_outcomes[status] || 0) + count;
            }
          }
          if (imported && imported.candidate_outcomes) {
            for (const [status, count] of Object.entries(imported.candidate_outcomes)) {
              summary.candidate_outcomes[status] = (summary.candidate_outcomes[status] || 0) + count;
            }
          }

          if (captureSummary.provider_rate_limited || captureSummary.provider_error_status === 429) {
            const retryAfterMs = retryAfterMilliseconds(
              (await adapters.readJson(capturePath)).retry_after, nowMs(),
            );
            const pausedUntilMs = nowMs() + providerRetryWindowMilliseconds(manifest, retryAfterMs);
            await adapters.writeGlobalPause(paths.globalPausePath, {
              kind: "search_service_cooldown",
              batch_id: manifest.batch_id,
              paused_at: new Date(nowMs()).toISOString(),
              paused_until_ms: pausedUntilMs,
              reason: "search_service_http_429",
            });
            summary.stop_reason = "search_service_rate_limit_cooldown";
            summary.pause_until = new Date(pausedUntilMs).toISOString();
            break outer;
          }
          if (captureSummary.platform_status === "platform_restriction") {
            await adapters.writeGlobalPause(paths.globalPausePath, {
              kind: "platform_restriction",
              batch_id: manifest.batch_id,
              paused_at: new Date(nowMs()).toISOString(),
              reason: "exact_linkedin_route_http_429",
              requires_operator_resume: true,
            });
            summary.stop_reason = "platform_restriction_requires_operator_resume";
            break outer;
          }
          if (captureSummary.is_error) {
            summary.stop_reason = captureSummary.provider_error_status === 401 || captureSummary.provider_error_status === 403
              ? "provider_policy_denial_stop" : "provider_error_stop";
            break outer;
          }
          break;
        }

        if (!exportedAny) {
          summary.stop_reason = "queue_idle_no_eligible_requests";
          break;
        }
      }

      if (summary.batch_count >= maxBatches && summary.stop_reason === "queue_idle") {
        summary.stop_reason = "max_batches_reached_resume_from_state";
      }
    } finally {
      await adapters.releaseLock(paths.lockPath, runId);
    }

    const report = await adapters.writeReport({ statePath, outPath: paths.pathFor(`report-${runId}.json`) });
    summary.report_path = report.path;
    summary.public_index = report.public_index;
    return summary;
  }

  return { run };
}

function createB614FunctionsExecRuntime({ tools, worktree }) {
  assert(tools && typeof tools.exec_command === "function" && typeof tools.write_stdin === "function",
    "functions.exec tools are required");
  assert(typeof tools.mcp__codex_apps__search_service_web_run === "function",
    "the permitted Search Service provider is unavailable in this host");
  assert(typeof worktree === "string" && worktree.startsWith("/"), "worktree must be absolute");
  const cliPath = `${worktree.replace(/\/$/, "")}/scripts/b614_enrichment/cli.py`;

  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
  }

  async function command(cmd, maxOutputTokens = 2500) {
    let result = await tools.exec_command({
      cmd,
      workdir: worktree,
      yield_time_ms: 30000,
      max_output_tokens: maxOutputTokens,
    });
    while (result && result.session_id) {
      result = await tools.write_stdin({
        session_id: result.session_id,
        chars: "",
        yield_time_ms: 1000,
        max_output_tokens: maxOutputTokens,
      });
    }
    return result || { exit_code: 1, output: "" };
  }

  function parseLastJson(output, label) {
    const lines = String(output || "").trim().split("\n").reverse();
    for (const line of lines) {
      try { return JSON.parse(line); } catch { /* try earlier line */ }
    }
    throw new Error(`${label} did not return its expected JSON result`);
  }

  async function runCli(args, { quiet = false } = {}) {
    const cmd = `PYTHONDONTWRITEBYTECODE=1 python3 ${shellQuote(cliPath)} ${args.map(shellQuote).join(" ")}${quiet ? " >/dev/null" : ""}`;
    return command(cmd, quiet ? 500 : 3000);
  }

  async function privatePathCommand(script, args = []) {
    const cmd = `python3 -c ${shellQuote(script)} ${args.map(shellQuote).join(" ")}`;
    const result = await command(cmd, 1000);
    if (result.exit_code !== 0) throw new Error("private evidence filesystem operation failed");
    return String(result.output || "").trim();
  }

  function parseJsonText(output, label) {
    try { return JSON.parse(output); } catch { throw new Error(`${label} is not valid JSON`); }
  }

  const ensureDirsScript = String.raw`import os, pathlib, stat, sys
root=pathlib.Path(sys.argv[1]).expanduser()
if root.is_symlink(): raise SystemExit('evidence root is a symlink')
root=root.resolve(strict=True)
if not root.is_dir() or root.stat().st_mode & 0o077: raise SystemExit('evidence root must be a private directory (0700)')
run=root/'public-index-host'
if run.is_symlink(): raise SystemExit('host directory is a symlink')
if not run.exists(): run.mkdir(mode=0o700)
if not run.is_dir() or run.stat().st_mode & 0o077: raise SystemExit('host directory must be private (0700)')
print(str(run))`;

  const existsScript = String.raw`import os, pathlib, sys
p=pathlib.Path(sys.argv[1])
print('true' if p.is_file() and not p.is_symlink() else 'false')`;

  const readJsonScript = String.raw`import json, pathlib, sys
p=pathlib.Path(sys.argv[1])
if p.is_symlink() or not p.is_file(): raise SystemExit('not a regular file')
sys.stdout.write(p.read_text(encoding='utf-8'))`;

  const writeImmutableScript = String.raw`import hashlib, json, os, pathlib, sys
root=pathlib.Path(sys.argv[1]).expanduser().resolve(strict=True)
p=pathlib.Path(sys.argv[2]).expanduser()
payload=sys.argv[3].encode('utf-8')
if root.stat().st_mode & 0o077: raise SystemExit('evidence root must be private (0700)')
if p.is_symlink(): raise SystemExit('refusing a symlink output')
parent=p.parent.resolve(strict=True)
try: parent.relative_to(root)
except ValueError: raise SystemExit('output must remain under evidence root')
fd=os.open(str(p), os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
with os.fdopen(fd,'wb') as out:
 out.write(payload); out.flush(); os.fsync(out.fileno())
print(json.dumps({'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}))`;

  const acquireLockScript = String.raw`import json, os, pathlib, sys
p=pathlib.Path(sys.argv[1]); payload=sys.argv[2].encode('utf-8')
if p.is_symlink(): raise SystemExit('host lock is a symlink')
fd=os.open(str(p), os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
with os.fdopen(fd,'wb') as out: out.write(payload); out.flush(); os.fsync(out.fileno())`;

  const releaseLockScript = String.raw`import json, pathlib, sys
p=pathlib.Path(sys.argv[1]); run_id=sys.argv[2]
if not p.exists(): raise SystemExit(0)
if p.is_symlink(): raise SystemExit('host lock is a symlink')
lock=json.loads(p.read_text(encoding='utf-8'))
if lock.get('run_id') != run_id: raise SystemExit('host lock owner changed')
p.unlink()`;

  const writePauseScript = String.raw`import json, os, pathlib, sys, tempfile
p=pathlib.Path(sys.argv[1]); payload=sys.argv[2].encode('utf-8')
if p.is_symlink(): raise SystemExit('global pause is a symlink')
parent=p.parent.resolve(strict=True)
fd,tmp=tempfile.mkstemp(prefix='.global-pause-',dir=str(parent))
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'wb') as out: out.write(payload); out.flush(); os.fsync(out.fileno())
 os.replace(tmp,p)
finally:
 if os.path.exists(tmp): os.unlink(tmp)`;

  const clearPauseScript = String.raw`import pathlib, sys
p=pathlib.Path(sys.argv[1])
if p.is_symlink(): raise SystemExit('global pause is a symlink')
if p.exists(): p.unlink()`;

  const reportSummaryScript = String.raw`import json, pathlib, sys
r=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
print(json.dumps({'company_count':r.get('company_count'),'public_index':r.get('public_index',{})},ensure_ascii=False))`;

  let sequence = 0;
  const runtime = {
    async preparePrivatePaths(evidenceRoot) {
      const output = await privatePathCommand(ensureDirsScript, [evidenceRoot]);
      return {
        runDirectory: output,
        lockPath: `${output}/host-driver.lock`,
        globalPausePath: `${output}/global-pause.json`,
        pathFor: (name) => `${output}/${name}`,
      };
    },
    async acquireLock(lockPath, metadata) {
      await privatePathCommand(acquireLockScript, [lockPath, JSON.stringify(metadata)]);
    },
    async releaseLock(lockPath, runId) {
      await privatePathCommand(releaseLockScript, [lockPath, runId]);
    },
    async readGlobalPause(pausePath) {
      if (!(await runtime.exists(pausePath))) return null;
      return runtime.readJson(pausePath);
    },
    async writeGlobalPause(pausePath, data) {
      await privatePathCommand(writePauseScript, [pausePath, JSON.stringify(data)]);
    },
    async clearGlobalPause(pausePath) {
      await privatePathCommand(clearPauseScript, [pausePath]);
    },
    async exists(path) {
      return (await privatePathCommand(existsScript, [path])) === "true";
    },
    async readJson(path) {
      return parseJsonText(await privatePathCommand(readJsonScript, [path]), "saved capture");
    },
    async writeImmutableJson(path, data) {
      const output = await privatePathCommand(writeImmutableScript, [
        path.substring(0, path.lastIndexOf("/")), path, JSON.stringify(data),
      ]);
      return parseJsonText(output, "immutable file receipt");
    },
    async exportBatch({ statePath, stage, manifestPath, allowIndexedLinkedinContent }) {
      const args = ["public-index-export", "--state", statePath, "--stage", stage, "--limit", "4", "--out", manifestPath];
      if (CONTENT_STAGES.has(stage) && allowIndexedLinkedinContent) args.push("--allow-indexed-linkedin-content");
      const result = await runCli(args);
      if (result.exit_code !== 0) {
        const paused = /public_index_provider_cooldown_active:([0-9]+(?:\.[0-9]+)?)/i.exec(result.output || "");
        if (paused) return { eligible: false, providerPaused: true, pausedUntilMs: Number(paused[1]) * 1000 };
        const noEligible = new RegExp(`no public-index ${stage} requests are eligible`, "i").test(result.output || "");
        if (noEligible) return { eligible: false };
        throw new Error(`public-index ${stage} export failed with exit ${result.exit_code}`);
      }
      const status = parseLastJson(result.output, "public-index export");
      const manifest = await runtime.readJson(manifestPath);
      return { eligible: true, manifest, export_status: status };
    },
    callSearchService: (toolArgs) => tools.mcp__codex_apps__search_service_web_run(toolArgs),
    async importCapture({ statePath, capturePath, evidenceRoot }) {
      const result = await runCli(["public-index-import", "--state", statePath, "--capture", capturePath,
        "--evidence-root", evidenceRoot]);
      if (result.exit_code !== 0) throw new Error(`public-index capture import failed with exit ${result.exit_code}`);
      return parseLastJson(result.output, "public-index import");
    },
    async writeReport({ statePath, outPath }) {
      const cliResult = await runCli(["report", "--state", statePath, "--out", outPath], { quiet: true });
      if (cliResult.exit_code !== 0) throw new Error(`public-index report failed with exit ${cliResult.exit_code}`);
      const summary = await privatePathCommand(reportSummaryScript, [outPath]);
      const parsed = parseJsonText(summary, "public-index report summary");
      return { path: outPath, public_index: parsed.public_index };
    },
    newRunId() {
      sequence += 1;
      return `${Date.now()}-${sequence}-${Math.floor(Math.random() * 0x100000000).toString(16)}`;
    },
    pathFor(evidenceRoot, name) {
      return `${evidenceRoot.replace(/\/$/, "")}/${name}`;
    },
    now: () => Date.now(),
  };
  return runtime;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createB614PublicIndexHostDriver, createB614FunctionsExecRuntime };
}
