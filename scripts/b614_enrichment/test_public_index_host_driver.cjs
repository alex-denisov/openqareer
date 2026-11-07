"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createB614PublicIndexHostDriver } = require("./public_index_host_driver.cjs");

function fixture() {
  const files = new Map();
  const calls = [];
  const imports = [];
  const exports = [];
  const verifications = [];
  let globalPause = null;
  let currentTime = 1_900_000_000_000;
  const manifest = {
    schema_version: 1,
    provider: "mcp__codex_apps__search_service_web_run",
    stage: "search",
    operation: "system2_search_query",
    batch_id: "a".repeat(64),
    manifest_sha256: "b".repeat(64),
    plan_sha256: "c".repeat(64),
    request_ids: ["d".repeat(64)],
    requests: [{ request_id: "d".repeat(64), company_key: "sample", company_name: "Sample Systems" }],
    tool_args: {
      system2_search_query: [{ q: 'site:linkedin.com/company "Sample Systems"', domains: ["linkedin.com"] }],
      response_length: "long",
    },
    indexed_linkedin_content_authorized: false,
  };
  const adapters = {
    preparePrivatePaths: async () => ({
      lockPath: "/private/root/public-index-host/host-driver.lock",
      globalPausePath: "/private/root/public-index-host/global-pause.json",
      pathFor: (name) => `/private/root/public-index-host/${name}`,
    }),
    acquireLock: async (_path, lock) => { adapters.lock = lock; },
    releaseLock: async (_path, runId) => { adapters.releasedRunId = runId; },
    exportBatch: async ({ stage, manifestPath, allowIndexedLinkedinContent }) => {
      exports.push({ stage, manifestPath, allowIndexedLinkedinContent });
      if (stage === "search") return { eligible: true, manifest };
      return { eligible: false };
    },
    exists: async (path) => files.has(path),
    readJson: async (path) => files.get(path),
    writeImmutableJson: async (path, content) => {
      if (files.has(path)) throw new Error("immutable artifact overwrite");
      files.set(path, content);
    },
    callSearchService: async (args) => { calls.push(args); return { content: [{ type: "text", text: "ok" }] }; },
    importCapture: async ({ capturePath }) => {
      const capture = files.get(capturePath);
      imports.push(capture);
      return { request_outcomes: { indexed_ref: 1 } };
    },
    writeReport: async ({ outPath }) => ({ path: outPath, public_index: { request_count: 1 } }),
    readGlobalPause: async () => globalPause,
    writeGlobalPause: async (_path, value) => { globalPause = value; },
    clearGlobalPause: async () => { globalPause = null; },
    verifyManifest: async ({ manifest }) => {
      verifications.push(manifest);
      return { verified: true, batch_id: manifest.batch_id, manifest_sha256: manifest.manifest_sha256, stage: manifest.stage };
    },
    newRunId: () => "run-001",
    now: () => currentTime,
  };
  return { adapters, files, calls, imports, exports, verifications, manifest,
    get globalPause() { return globalPause; }, set currentTime(value) { currentTime = value; } };
}

test("host driver distinguishes unbound parenthesized route 429 and persists a manual pause", async () => {
  const f = fixture();
  const clickManifest = {
    ...f.manifest,
    stage: "click",
    operation: "click",
    batch_id: "f".repeat(64),
    manifest_sha256: "e".repeat(64),
    requests: [{ ...f.manifest.requests[0], find_result_ref: "turn_expected_find0", employee_link_id: 11 }],
    indexed_linkedin_content_authorized: true,
    tool_args: { click: [{ ref_id: "turn_expected_find0", id: 11 }], response_length: "long" },
  };
  f.adapters.exportBatch = async ({ stage, manifestPath }) => {
    f.exports.push({ stage, manifestPath });
    return stage === "click" ? { eligible: true, manifest: clickManifest } : { eligible: false };
  };
  f.adapters.callSearchService = async (args) => {
    f.calls.push(args);
    return {
      isError: false,
      content: [{ type: "text", text: "www.linkedin.com (https://www.linkedin.com/signup/cold-join?x=y)\nSource: click({\"ref_id\":\"turn_stale_find0\",\"id\":11}); (429) Too Many Requests" }],
    };
  };
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const result = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root",
    maxBatches: 8, allowIndexedLinkedinContent: true });
  assert.deepEqual(f.calls, [clickManifest.tool_args]);
  assert.equal(f.imports.length, 1);
  assert.equal(f.imports[0].is_error, false);
  assert.deepEqual(f.imports[0].request_ids, f.manifest.request_ids);
  assert.equal(result.stop_reason, "unbound_platform_429_operator_resume");
  assert.equal(result.batch_count, 1);
  assert.equal(result.request_outcomes.indexed_ref, 1);
  assert.equal(f.globalPause.kind, "unbound_platform_429");
  assert.equal(f.globalPause.requires_operator_resume, true);
  assert.equal(f.adapters.releasedRunId, "run-001");
  const exportsBeforeResume = f.exports.length;
  const pausedResume = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root",
    maxBatches: 8, allowIndexedLinkedinContent: true });
  assert.equal(pausedResume.stop_reason, "unbound_platform_429_requires_operator_resume");
  assert.equal(f.globalPause.kind, "unbound_platform_429");
  assert.equal(f.exports.length, exportsBeforeResume);
  assert.equal(f.calls.length, 1);

  f.adapters.exportBatch = async () => ({ eligible: false });
  const manualResume = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root",
    maxBatches: 8, allowIndexedLinkedinContent: true, resumeAfterManualPause: true });
  assert.equal(manualResume.stop_reason, "queue_idle_no_eligible_requests");
  assert.equal(f.globalPause, null);
  assert.equal(f.calls.length, 1);
});

test("host driver distinguishes a 429 bound to a requested route", async () => {
  const f = fixture();
  const clickManifest = {
    ...f.manifest,
    stage: "click",
    operation: "click",
    batch_id: "f".repeat(64),
    manifest_sha256: "e".repeat(64),
    requests: [{ ...f.manifest.requests[0], find_result_ref: "turn_expected_find0", employee_link_id: 11 }],
    indexed_linkedin_content_authorized: true,
    tool_args: { click: [{ ref_id: "turn_expected_find0", id: 11 }], response_length: "long" },
  };
  f.adapters.exportBatch = async ({ stage }) => stage === "click"
    ? { eligible: true, manifest: clickManifest } : { eligible: false };
  f.adapters.callSearchService = async () => ({
    isError: false,
    content: [{ type: "text", text: "Source: click({\"ref_id\":\"turn_expected_find0\",\"id\":11}); (429) Too Many Requests" }],
  });
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const result = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root",
    maxBatches: 1, allowIndexedLinkedinContent: true });
  assert.equal(result.stop_reason, "platform_restriction_requires_operator_resume");
  assert.equal(f.globalPause.kind, "platform_restriction");
});

test("open 429 with the requested ref but another company route is unbound", async () => {
  const f = fixture();
  const openManifest = {
    ...f.manifest,
    stage: "open",
    operation: "open",
    batch_id: "1".repeat(64),
    manifest_sha256: "2".repeat(64),
    requests: [{ ...f.manifest.requests[0], source_ref: "turn_expected_search0",
      source_url: "https://www.linkedin.com/company/sample/" }],
    indexed_linkedin_content_authorized: true,
    tool_args: { open: [{ ref_id: "turn_expected_search0" }], response_length: "long" },
  };
  f.adapters.exportBatch = async ({ stage }) => stage === "open"
    ? { eligible: true, manifest: openManifest } : { eligible: false };
  f.adapters.callSearchService = async () => ({
    isError: true,
    content: [{ type: "text", text: "Other Company | LinkedIn (https://www.linkedin.com/company/other/)\nSource: open({\"ref_id\":\"turn_expected_search0\"}); (429) Too Many Requests" }],
  });
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const result = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root",
    maxBatches: 1, allowIndexedLinkedinContent: true });
  assert.equal(result.stop_reason, "unbound_platform_429_operator_resume");
  assert.equal(f.globalPause.kind, "unbound_platform_429");
  assert.equal(f.imports[0].is_error, false);
});

test("Search Service 429 stores a timed global pause and never retries before it expires", async () => {
  const f = fixture();
  f.adapters.callSearchService = async (args) => {
    f.calls.push(args);
    return { isError: true, retry_after: "60", content: [{ type: "text", text: "HTTP 429 Too Many Requests" }] };
  };
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const first = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root", maxBatches: 2 });
  assert.equal(first.stop_reason, "search_service_rate_limit_cooldown");
  assert.equal(first.pause_until, new Date(1_900_000_060_000).toISOString());
  assert.equal(f.globalPause.kind, "search_service_cooldown");
  assert.equal(f.imports[0].is_error, true);
  assert.equal(f.imports[0].provider_error_status, 429);

  const exportedBeforeCooldown = f.exports.length;
  const beforeCooldown = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root", maxBatches: 2 });
  assert.equal(beforeCooldown.stop_reason, "search_service_cooldown_pause_active");
  assert.equal(f.globalPause.kind, "search_service_cooldown");
  assert.equal(f.exports.length, exportedBeforeCooldown);
  assert.equal(f.calls.length, 1);
  const stillPaused = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root", maxBatches: 2 });
  assert.equal(stillPaused.stop_reason, "search_service_cooldown_pause_active");
  assert.equal(f.globalPause.kind, "search_service_cooldown");
  assert.equal(f.exports.length, exportedBeforeCooldown);
});

test("host driver imports a saved immutable capture on resume without another provider call", async () => {
  const f = fixture();
  const capturePath = `/private/root/public-index-host/capture-${f.manifest.batch_id}.json`;
  f.files.set(capturePath, {
    provider: f.manifest.provider,
    stage: "search",
    raw_result_text: "saved response",
    is_error: false,
  });
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const result = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root", maxBatches: 1 });
  assert.equal(f.calls.length, 0);
  assert.equal(f.imports.length, 1);
  assert.equal(result.stop_reason, "max_batches_reached_resume_from_state");
  assert.equal(result.batch_count, 1);
});

test("uncertain call markers prevent a duplicate provider call after interruption", async () => {
  const f = fixture();
  const attemptPath = `/private/root/public-index-host/attempt-${f.manifest.batch_id}.json`;
  f.files.set(attemptPath, { batch_id: f.manifest.batch_id });
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const result = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root", maxBatches: 1 });
  assert.equal(f.calls.length, 0);
  assert.equal(f.imports.length, 0);
  assert.equal(result.stop_reason, "call_uncertain_wait_for_lease_expiry");
});

test("search-only mode does not export open/find/click", async () => {
  const f = fixture();
  f.adapters.exportBatch = async ({ stage }) => {
    f.exports.push({ stage });
    if (stage === "search") return { eligible: false };
    if (stage === "open") return { eligible: true, manifest: { ...f.manifest, stage: "open" } };
    return { eligible: false };
  };
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const result = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root", maxBatches: 1 });
  assert.equal(f.calls.length, 0);
  assert.equal(result.stop_reason, "search_only_scope_complete");
  assert.deepEqual(f.exports.map((item) => item.stage), ["search"]);
});

test("content-enabled work drains click then find/open before requesting more search refs", async () => {
  const f = fixture();
  const clickManifest = {
    ...f.manifest,
    stage: "click",
    operation: "click",
    batch_id: "f".repeat(64),
    manifest_sha256: "e".repeat(64),
    indexed_linkedin_content_authorized: true,
    tool_args: { click: [{ ref_id: "turn300view0", id: 11 }], response_length: "long" },
  };
  f.adapters.exportBatch = async ({ stage, manifestPath }) => {
    f.exports.push({ stage, manifestPath });
    return stage === "click" ? { eligible: true, manifest: clickManifest } : { eligible: false };
  };
  const driver = createB614PublicIndexHostDriver(f.adapters);
  const result = await driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root",
    maxBatches: 1, allowIndexedLinkedinContent: true });
  assert.equal(result.stop_reason, "max_batches_reached_resume_from_state");
  assert.deepEqual(f.exports.map((item) => item.stage), ["click"]);
  assert.deepEqual(f.calls, [clickManifest.tool_args]);
});

test("pre-call manifest verification failure blocks provider use and attempt writes", async () => {
  const f = fixture();
  f.adapters.verifyManifest = async () => ({ verified: true, batch_id: "wrong", manifest_sha256: "wrong", stage: "search" });
  const driver = createB614PublicIndexHostDriver(f.adapters);
  await assert.rejects(
    () => driver.run({ statePath: "/private/root/state.sqlite", evidenceRoot: "/private/root", maxBatches: 1 }),
    /pre-call manifest verification/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal([...f.files.keys()].some((path) => path.includes("attempt-")), false);
  assert.equal(f.adapters.releasedRunId, "run-001");
});
