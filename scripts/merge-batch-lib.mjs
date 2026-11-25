// Pure decisions for scripts/merge-batch.mjs: which PRs join a batch, how a
// red batch is bisected and when a batch result may be credited to a PR.
// No I/O here, so every rule is covered by merge-batch-lib.test.mjs.

export const READY_LABEL = 'merge-ready';
export const IN_BATCH_LABEL = 'in-batch';
export const FULL_VERIFY = 'Full verify';
// Not part of the light run: the required status itself and the batcher's own
// job, which runs on the merge-ready label event (.github/workflows/merge-batch.yml).
export const NOT_LIGHT_RUN = new Set([FULL_VERIFY, 'Merge batch']);
export const MAX_BATCH = 8;
// Ready PRs looked at to fill a batch when some of them conflict.
export const MAX_POOL = 24;
export const MAX_PARALLEL_RUNS = 2;
// GitHub lists at most this many files of a PR.
export const MAX_LISTED_FILES = 3000;
export const MERGE_ATTEMPTS = 4;

const GREEN = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

const labelNames = (pr) => (pr.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
const checkName = (c) => c.context ?? c.name ?? '';
const checkState = (c) => (c.conclusion || c.state || c.status || '').toUpperCase();

/** Why a PR cannot join a batch, or null when it can. */
export function rejectReason(pr) {
  const labels = labelNames(pr);
  if (!labels.includes(READY_LABEL)) return 'no merge-ready label';
  if (labels.includes(IN_BATCH_LABEL)) return 'already in a batch';
  if (pr.isDraft) return 'draft';
  if (pr.baseRefName && pr.baseRefName !== 'main') return 'base is not main';
  if (pr.mergeable === 'CONFLICTING') return 'conflicts with main';
  if (pr.readError) return `could not be read (${pr.readError})`;
  // Past the limit the API cuts the list, so a workflow change could stay unseen.
  if ((pr.changedFiles ?? 0) >= MAX_LISTED_FILES) return `too many files (${pr.changedFiles})`;
  if (pr.touchesWorkflows) return 'changes .github/workflows (goes the single route)';
  const checks = effectiveChecks(
    (pr.statusCheckRollup ?? []).filter((c) => !NOT_LIGHT_RUN.has(checkName(c))),
  );
  if (checks.length === 0) return 'no light run yet';
  const bad = checks.find((c) => !GREEN.has(checkState(c)));
  if (bad) return `light run not green (${checkName(bad)}: ${checkState(bad) || 'pending'})`;
  return null;
}

const checkKey = (c) => `${c.workflowName ?? ''}/${checkName(c)}`;
const finishedAt = (c) => c.completedAt || c.startedAt || '';
const isCancelled = (c) => checkState(c) === 'CANCELLED';
const runId = (c) => Number(/\/actions\/runs\/(\d+)/.exec(c.detailsUrl ?? '')?.[1] ?? 0);
// gh prints completedAt "0001-01-01T00:00:00Z" for a check that still runs.
const isPending = (c) =>
  !c.conclusion && !c.state && (c.status ? c.status !== 'COMPLETED' : !c.completedAt);

/**
 * Cancelled checks of a run that a later run of the same workflow replaced with
 * a green Verify. Their names may be gone from the later run (another shard
 * count, an unexpanded matrix), so nothing there would ever outvote them.
 */
function isSuperseded(check, checks) {
  return (
    isCancelled(check) &&
    runId(check) > 0 &&
    checks.some(
      (c) =>
        c.workflowName === check.workflowName &&
        runId(c) > runId(check) &&
        checkName(c) === 'Verify' &&
        checkState(c) === 'SUCCESS',
    )
  );
}

/**
 * One entry per check. A head often has two runs of the same job: the label
 * event arrives with synchronize and concurrency cancels one of them. A
 * cancelled run counts only when no other run of that job exists; otherwise
 * the newest non-cancelled run (pending ones included) decides.
 */
export function effectiveChecks(checks) {
  const groups = new Map();
  const current = checks.filter((c) => !isSuperseded(c, checks));
  for (const c of current) groups.set(checkKey(c), [...(groups.get(checkKey(c)) ?? []), c]);
  return [...groups.values()].map((runs) => {
    const live = runs.filter((c) => !isCancelled(c));
    const pool = live.length > 0 ? live : runs;
    const pending = pool.find(isPending);
    if (pending) return pending;
    return [...pool].sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)))[0];
  });
}

// Red only because another job of the run was cancelled.
const AGGREGATES = new Set(['Verify', 'Deploy production']);

/**
 * Run ids to re-run: checks whose only runs on this head were cancelled. None
 * when a gate really failed: fail-fast cancelled its sibling shards, and a
 * re-run would only repeat the failure on every tick.
 */
export function cancelledOnlyRuns(pr) {
  const checks = (pr.statusCheckRollup ?? []).filter((c) => !NOT_LIGHT_RUN.has(checkName(c)));
  const effective = effectiveChecks(checks);
  const failed = effective.some(
    (c) => checkState(c) === 'FAILURE' && !AGGREGATES.has(checkName(c)),
  );
  if (failed) return [];
  const ids = effective
    .filter(isCancelled)
    .map((c) => /\/actions\/runs\/(\d+)/.exec(c.detailsUrl ?? '')?.[1])
    .filter(Boolean);
  return [...new Set(ids)];
}

/** Ready PRs, oldest first, capped at MAX_BATCH. */
export function selectCandidates(prs, max = MAX_BATCH) {
  const ready = prs.filter((pr) => rejectReason(pr) === null);
  return [...ready].sort((a, b) => a.number - b.number).slice(0, max);
}

/**
 * A batch starts with two or more ready PRs. A single PR starts at once only
 * when its own label event woke the batcher, which keeps today's single route
 * "label → full run → merge"; a scheduled tick waits for company.
 */
export function shouldStart(candidates, trigger) {
  if (candidates.length >= 2) return true;
  return candidates.length === 1 && (trigger === 'label' || trigger === 'dispatch');
}

/** Two halves; the first gets the extra PR. Order is preserved. */
export function split(prs) {
  const mid = Math.ceil(prs.length / 2);
  return [prs.slice(0, mid), prs.slice(mid)].filter((half) => half.length > 0);
}

/**
 * One bisection round. results: [{ prs, green }] in queue order, each run on
 * `baseSha`. Only one green group may merge, and only while main is still
 * `baseSha` (a later group was tested on a main that no longer exists).
 * Red singles are culprits; red groups are split for the next round; other
 * greens go back to the queue and are re-tested on the new main.
 */
export function resolveRound(results, baseSha, currentMainSha) {
  let merge = [];
  const culprits = [];
  const requeue = [];
  const retest = [];
  for (const { prs, green } of results) {
    if (green && merge.length === 0 && baseSha === currentMainSha) merge = prs;
    else if (green) requeue.push(...prs);
    else if (prs.length === 1) culprits.push(prs[0]);
    else retest.push(...split(prs));
  }
  return { merge, culprits, requeue, retest };
}

/** Groups of at most `limit` runs, so no more than two full runs overlap. */
export function waves(groups, limit = MAX_PARALLEL_RUNS) {
  const out = [];
  for (let i = 0; i < groups.length; i += limit) out.push(groups.slice(i, i + limit));
  return out;
}

/**
 * The batch result is credited to a PR only when the PR head, brought up to
 * date with main, has exactly the tree the batch branch had after that PR's
 * merge. Equal trees mean identical files, so nothing untested reaches main.
 */
export function creditDecision({ headTree, expectedTree }) {
  if (!headTree || !expectedTree) return { credit: false, reason: 'tree unknown' };
  if (headTree !== expectedTree) {
    return {
      credit: false,
      reason: `tree ${headTree.slice(0, 12)} ≠ batch ${expectedTree.slice(0, 12)}`,
    };
  }
  return { credit: true, reason: 'tree equals the batch tree' };
}

/** GitHub's transient refusals of `gh pr merge`; a moved head or a tree mismatch is not one. */
export function isRetryableMergeError(message) {
  return (
    /gh pr merge/.test(message ?? '') && /Base branch was modified|is not mergeable/i.test(message)
  );
}

/**
 * Runs `attempt` up to MERGE_ATTEMPTS times. Any refused `gh pr merge`, the last
 * one included, may have merged after all: an uncounted merge would leave main
 * without its deploy. A failed `isMerged` read counts as "unknown", not as an error.
 */
export async function retryMerge({ attempt, isMerged, wait, note }) {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt();
    } catch (err) {
      if (!/gh pr merge/.test(err.message)) throw err;
      const last = n >= MERGE_ATTEMPTS || !isRetryableMergeError(err.message);
      note(`merge attempt ${n} refused: ${err.message.split('\n')[1] ?? err.message}`);
      await wait(n);
      try {
        if (await isMerged()) return 'merged despite the refusal';
      } catch (readErr) {
        note(`merged state unknown: ${readErr.message.split('\n')[0]}`);
      }
      if (last) throw err;
    }
  }
}

export function statusDescription({ position, size, tipTree }) {
  return position === size
    ? `Batch of ${size}: this tree was fully verified`
    : `Batch of ${size}, step ${position}: batch tip ${tipTree.slice(0, 12)} verified; this tree is not deployed alone`;
}

/** gh output that must be JSON; a bare string (e.g. a sha from --jq) is a caller bug. */
export function parseGhJson(out) {
  const text = (out ?? '').trim();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`gh returned non-JSON (${text.slice(0, 40)}); read scalar --jq output as text`);
  }
}

/** Scalar gh output, one value per line; pages of --paginate simply follow each other. */
export function parseLines(out) {
  return (out ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Stacked PRs: a PR whose head contains another candidate's head is deferred.
 * Once the lower PR is squash-merged, the upper branch no longer updates onto
 * main without a rebase, so it waits for the next batch instead of stalling
 * this one. isAncestor(a, b) says whether commit a is an ancestor of b.
 */
export function deferStacked(candidates, isAncestor) {
  const take = [];
  const deferred = [];
  for (const pr of candidates) {
    const lower = candidates.find(
      (o) =>
        o.number !== pr.number &&
        o.headRefOid !== pr.headRefOid &&
        isAncestor(o.headRefOid, pr.headRefOid),
    );
    if (lower) deferred.push({ pr, on: lower.number });
    else take.push(pr);
  }
  return { take, deferred };
}

export const BOT_LOGIN = 'github-actions[bot]';
export const STUCK_AFTER_MIN = 60;

/** The batcher's own merge of main into a PR head (pushMainInto / update-branch). */
export function isOwnMainMerge(commit) {
  return (
    commit?.author === BOT_LOGIN &&
    (commit.parents ?? []).length === 2 &&
    /^Merge (branch 'main'|remote-tracking branch 'origin\/main'|[0-9a-f]{7,40}) into /.test(
      commit.message ?? '',
    )
  );
}

/**
 * A bot merge head gets no light run of its own (the pull_request run waits
 * for approval as action_required). It may borrow the green light run of its
 * first parent, the PR's own head: the merge is clean by construction and the
 * batch's full run checks the merged tree anyway.
 */
export function inheritParentChecks(pr, commit, parentChecks) {
  if (rejectReason(pr) === null || !isOwnMainMerge(commit)) return pr;
  const borrowed = { ...pr, statusCheckRollup: parentChecks };
  return rejectReason(borrowed) === null ? { ...borrowed, inheritedFrom: commit.parents[0] } : pr;
}

/** A merge-ready PR skipped this long gets one comment per head, so no PR waits silently. */
export function shouldNoticeStuck({ reason, ageMin, alreadyNoticed }) {
  if (!reason || alreadyNoticed) return false;
  if (reason === 'no merge-ready label' || reason === 'already in a batch') return false;
  return ageMin >= STUCK_AFTER_MIN;
}

export const stuckMarker = (sha) => `<!-- merge-batch-skip:${sha} -->`;
