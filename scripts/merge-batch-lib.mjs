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
export const MAX_PARALLEL_RUNS = 2;

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
  if (pr.touchesWorkflows) return 'changes .github/workflows (goes the single route)';
  const checks = (pr.statusCheckRollup ?? []).filter((c) => !NOT_LIGHT_RUN.has(checkName(c)));
  if (checks.length === 0) return 'no light run yet';
  const bad = checks.find((c) => !GREEN.has(checkState(c)));
  if (bad) return `light run not green (${checkName(bad)}: ${checkState(bad) || 'pending'})`;
  return null;
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
