#!/usr/bin/env node
// Batch merge for main — our stand-in for GitHub merge queue (personal repo).
// Run from .github/workflows/merge-batch.yml, or locally with --dry-run.
//
//   node scripts/merge-batch.mjs [--dry-run] [--trigger schedule|label|dispatch]
//
// 1. Ready PRs (merge-ready, green light run) are merged one by one onto main
//    in a local batch/<ts> branch; a conflicting PR is dropped with a comment.
// 2. One full run (verify-and-deploy, workflow_dispatch batch=true) checks the tip.
// 3. Green: each PR is brought up to date with main, its tree is compared with
//    the batch tree after that PR, "Full verify" is posted on the head and the
//    PR is squash-merged. A tree mismatch stops the merge and requeues the rest.
// 4. Red: halves are run (at most two at once) until red singles are found;
//    culprits lose the label and get a comment, green groups merge or requeue.
// 5. One deploy run on main (deploy_verified=true) ships the final tree.
// Rules live in merge-batch-lib.mjs. Actions done with GITHUB_TOKEN start no
// workflows, so the batch's update-branch and squash pushes run nothing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FULL_VERIFY,
  IN_BATCH_LABEL,
  READY_LABEL,
  cancelledOnlyRuns,
  inheritParentChecks,
  isOwnMainMerge,
  shouldNoticeStuck,
  stuckMarker,
  creditDecision,
  deferStacked,
  parseGhJson,
  parseLines,
  rejectReason,
  resolveRound,
  selectCandidates,
  shouldStart,
  statusDescription,
  waves,
} from './merge-batch-lib.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const trigger = args.includes('--trigger') ? args[args.indexOf('--trigger') + 1] : 'schedule';
// Dry-run only: treat these PRs as labelled merge-ready to exercise the batch build.
const assumeReady =
  DRY && args.includes('--assume-ready')
    ? new Set(args[args.indexOf('--assume-ready') + 1].split(',').map(Number))
    : new Set();
const WORKFLOW = 'verify-and-deploy.yml';
const RUN_TIMEOUT_MS = 60 * 60 * 1000;
const POLL_MS = 30 * 1000;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const log = (...m) => console.log('[merge-batch]', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}
// Batch branches are built in a throwaway worktree so the caller's checkout is untouched.
const WT = mkdtempSync(join(tmpdir(), 'merge-batch-'));
const git = (...a) => sh('git', ['-C', WT, ...a]);
const gh = (...a) => sh('gh', a);
const ghJson = (...a) => parseGhJson(gh(...a));
// A bare value from --jq (a sha) is plain text, not JSON.
const ghText = (...a) => gh(...a).trim();
const repo = () =>
  process.env.GITHUB_REPOSITORY || ghJson('repo', 'view', '--json', 'nameWithOwner').nameWithOwner;

/** A side effect, skipped and printed under --dry-run. */
function act(what, fn) {
  if (DRY) return log('dry-run, would:', what);
  log(what);
  return fn();
}

function listPrs() {
  const fields =
    'number,title,headRefName,headRefOid,labels,isDraft,mergeable,baseRefName,statusCheckRollup,isCrossRepository';
  const prs = ghJson(
    'pr',
    'list',
    '--state',
    'open',
    '--base',
    'main',
    '--limit',
    '50',
    '--json',
    fields,
  );
  return prs.map((raw) => {
    const pr = assumeReady.has(raw.number)
      ? {
          ...raw,
          labels: [...raw.labels, { name: READY_LABEL }],
          statusCheckRollup: raw.statusCheckRollup.map((c) => ({
            ...c,
            conclusion: c.conclusion || 'SUCCESS',
          })),
        }
      : raw;
    if (!(pr.labels ?? []).some((l) => l.name === READY_LABEL)) return pr;
    // One name per line: --paginate applies --jq page by page, so a JSON array
    // per page would not parse for a PR of more than 30 files.
    const files = parseLines(
      gh(
        'api',
        `repos/${repo()}/pulls/${pr.number}/files?per_page=100`,
        '--paginate',
        '--jq',
        '.[].filename',
      ),
    );
    const withFiles = {
      ...pr,
      touchesWorkflows: files.some((f) => f.startsWith('.github/workflows/')),
    };
    return rejectReason(withFiles) === null ? withFiles : resolveBotHead(withFiles);
  });
}

function headCommit(sha) {
  const c = ghJson(
    'api',
    `repos/${repo()}/commits/${sha}`,
    '--jq',
    '{author: .author.login, message: .commit.message, parents: [.parents[].sha], date: .commit.committer.date, tree: .commit.tree.sha}',
  );
  return c;
}

/**
 * The author name can be spoofed, so trust the merge only by content: the
 * second parent is on main and the tree is exactly the merge of its parents,
 * i.e. the commit adds nothing beyond main.
 */
function isPureMainMerge(commit) {
  const [head, mainSide] = commit.parents;
  try {
    git('fetch', '-q', 'origin', head, mainSide, 'main');
    git('merge-base', '--is-ancestor', mainSide, 'origin/main');
    return git('merge-tree', '--write-tree', head, mainSide) === commit.tree;
  } catch {
    return false;
  }
}

function lightChecksOf(sha) {
  return ghJson(
    'api',
    `repos/${repo()}/commits/${sha}/check-runs?per_page=100`,
    '--jq',
    '[.check_runs[] | {name, status: (.status | ascii_upcase), conclusion: ((.conclusion // "") | ascii_upcase), completedAt: .completed_at, startedAt: .started_at, detailsUrl: .details_url}]',
  );
}

/**
 * Head is our merge of main: its pull_request run waits for approval
 * (action_required, bot actor). Approve it, and meanwhile borrow the PR
 * head's green light run so the PR is not dropped from the queue.
 */
function resolveBotHead(pr) {
  try {
    const commit = headCommit(pr.headRefOid);
    const withDate = { ...pr, headDate: commit.date };
    if (pr.isCrossRepository || !isOwnMainMerge(commit) || !isPureMainMerge(commit))
      return withDate;
    approveWaitingRuns(pr);
    const out = inheritParentChecks(withDate, commit, lightChecksOf(commit.parents[0]));
    if (out.inheritedFrom)
      log(
        `#${pr.number}: head is our main merge; light run of ${out.inheritedFrom.slice(0, 8)} counts`,
      );
    return out;
  } catch (err) {
    log(`#${pr.number}: could not inspect head ${pr.headRefOid.slice(0, 8)}: ${err.message}`);
    return pr;
  }
}

function approveWaitingRuns(pr) {
  const ids = ghJson(
    'api',
    `repos/${repo()}/actions/runs?head_sha=${pr.headRefOid}&status=action_required`,
    '--jq',
    '[.workflow_runs[].id]',
  );
  for (const id of ids ?? [])
    act(`approve waiting run ${id} of #${pr.number}`, () => {
      try {
        gh('api', '-X', 'POST', `repos/${repo()}/actions/runs/${id}/approve`);
      } catch (err) {
        log(`#${pr.number}: approve ${id} failed: ${err.message}`);
      }
    });
}

/** One comment per head on a merge-ready PR the batcher has skipped for an hour. */
function noticeStuck(pr, reason) {
  if (!pr.headDate) return;
  const ageMin = (Date.now() - Date.parse(pr.headDate)) / 60000;
  const marker = stuckMarker(pr.headRefOid);
  const check = { reason, ageMin, alreadyNoticed: false };
  if (!shouldNoticeStuck(check)) return;
  const seen = ghText(
    'api',
    `repos/${repo()}/issues/${pr.number}/comments?per_page=100`,
    '--jq',
    `[.[].body | select(contains("${marker}"))] | length`,
  );
  if (!shouldNoticeStuck({ ...check, alreadyNoticed: seen !== '0' })) return;
  comment(
    pr,
    `Групповое слияние: PR с меткой merge-ready не берётся в группу больше ${Math.round(ageMin)} мин. Причина: ${reason}.\n${marker}`,
  );
}

/** main + each PR via --no-ff merge; conflicting PRs are dropped. */
function buildBranch(name, prs, baseSha) {
  git('checkout', '-q', '-B', name, baseSha);
  const members = [];
  const dropped = [];
  for (const pr of prs) {
    git('fetch', '-q', 'origin', `pull/${pr.number}/head`);
    try {
      git('merge', '-q', '--no-ff', '--no-edit', '-m', `batch: #${pr.number}`, 'FETCH_HEAD');
      members.push({
        ...pr,
        tree: git('rev-parse', 'HEAD^{tree}'),
        headAtBatch: git('rev-parse', 'FETCH_HEAD'),
      });
    } catch {
      git('merge', '--abort');
      dropped.push(pr);
    }
  }
  return { name, members, dropped, tip: git('rev-parse', 'HEAD') };
}

function isAncestor(a, b) {
  try {
    git('fetch', '-q', 'origin', a, b);
    git('merge-base', '--is-ancestor', a, b);
    return true;
  } catch {
    return false;
  }
}

function comment(pr, body) {
  act(`comment on #${pr.number}: ${body.split('\n')[0]}`, () =>
    gh('pr', 'comment', String(pr.number), '--body', body),
  );
}
/** Creates the label once; --force keeps an existing one as is apart from colour/description. */
function ensureLabel(name, description) {
  act(`ensure label ${name}`, () =>
    gh('label', 'create', name, '--force', '--color', 'BFD4F2', '--description', description),
  );
}
function setLabel(pr, label, on) {
  act(`${on ? 'add' : 'remove'} label ${label} on #${pr.number}`, () =>
    gh('pr', 'edit', String(pr.number), on ? '--add-label' : '--remove-label', label),
  );
}

async function dispatchRun(branch) {
  if (DRY) return { url: '(dry-run)', id: 0, green: true };
  git('push', '-q', '-f', 'origin', `${branch.name}:refs/heads/${branch.name}`);
  const since = Date.now() - 5000;
  gh('workflow', 'run', WORKFLOW, '--ref', branch.name, '-f', 'batch=true');
  let run = null;
  for (let i = 0; i < 20 && !run; i += 1) {
    await sleep(6000);
    const runs = ghJson(
      'run',
      'list',
      '--workflow',
      WORKFLOW,
      '--branch',
      branch.name,
      '--event',
      'workflow_dispatch',
      '--json',
      'databaseId,url,createdAt,headSha',
      '--limit',
      '5',
    );
    run = runs.find((r) => r.headSha === branch.tip && Date.parse(r.createdAt) >= since) ?? null;
  }
  if (!run) throw new Error(`no run started for ${branch.name}`);
  log(`${branch.name}: full run ${run.url}`);
  return { id: run.databaseId, url: run.url };
}

async function awaitRun(run) {
  if (DRY) return true;
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = ghJson('run', 'view', String(run.id), '--json', 'status,conclusion');
    if (r.status === 'completed') return r.conclusion === 'success';
    await sleep(POLL_MS);
  }
  return false;
}

/** Full-run groups, at most two at once. Returns [{ prs, green, url }]. */
async function runGroups(groups, baseSha, round) {
  const results = [];
  for (const [w, wave] of waves(groups).entries()) {
    const started = await Promise.all(
      wave.map(async (prs, j) => {
        const branch = buildBranch(`batch/${stamp}-r${round}-${w}${j}`, prs, baseSha);
        return { prs: branch.members, branch, run: await dispatchRun(branch) };
      }),
    );
    for (const s of started)
      results.push({ prs: s.prs, branch: s.branch, url: s.run.url, green: await awaitRun(s.run) });
  }
  return results;
}

const mainSha = () => (git('fetch', '-q', 'origin', 'main'), git('rev-parse', 'origin/main'));

async function headAfterUpdate(pr) {
  const cur = ghJson('api', `repos/${repo()}/pulls/${pr.number}`);
  const main = mainSha();
  const compare = ghJson(
    'api',
    `repos/${repo()}/compare/${main}...${cur.head.sha}`,
    '--jq',
    '{behind: .behind_by}',
  );
  if (compare.behind === 0) return cur.head.sha;
  // A local merge pushed with GITHUB_TOKEN starts no workflow run. The REST
  // update-branch made a bot "synchronize" event whose Verify run died at
  // startup ("workflow file issue") and hung a red cross on the PR.
  const pushed = pushMainInto(pr, cur);
  return pushed ?? (await apiUpdateBranch(pr, cur));
}

/** main merged into the PR head and pushed fast-forward; null if GitHub refuses the push. */
function pushMainInto(pr, cur) {
  git('fetch', '-q', 'origin', cur.head.sha, 'main');
  git('checkout', '-q', '--detach', cur.head.sha);
  try {
    git(
      'merge',
      '-q',
      '--no-ff',
      '--no-edit',
      '-m',
      `Merge branch 'main' into ${cur.head.ref}`,
      'origin/main',
    );
  } catch {
    git('merge', '--abort');
    throw Object.assign(new Error(`main does not merge into #${pr.number} cleanly`), {
      needsRebase: true,
    });
  }
  const sha = git('rev-parse', 'HEAD');
  try {
    // Not forced: a branch that moved since cur.head.sha rejects the push.
    git('push', '-q', 'origin', `${sha}:refs/heads/${cur.head.ref}`);
    return sha;
  } catch (err) {
    // E.g. main brought .github/workflows changes; GITHUB_TOKEN has no workflows scope.
    log(
      `#${pr.number}: push of the update refused (${err.message.split('\n')[0]}); using update-branch`,
    );
    return null;
  }
}

async function apiUpdateBranch(pr, cur) {
  try {
    gh(
      'api',
      '-X',
      'PUT',
      `repos/${repo()}/pulls/${pr.number}/update-branch`,
      '-f',
      `expected_head_sha=${cur.head.sha}`,
    );
  } catch (err) {
    // 422 merge conflict: usually a PR stacked on one just squash-merged.
    throw Object.assign(new Error(`update-branch failed: ${err.message.split('\n')[0]}`), {
      needsRebase: true,
    });
  }
  for (let i = 0; i < 20; i += 1) {
    await sleep(3000);
    const sha = ghText('api', `repos/${repo()}/pulls/${pr.number}`, '--jq', '.head.sha');
    if (sha !== cur.head.sha) return sha;
  }
  throw new Error(`update-branch of #${pr.number} did not land`);
}

/** Squash-merge members in order, each credited by tree equality. */
async function mergeGroup(members, run) {
  const merged = [];
  const tipTree = members.at(-1)?.tree ?? '';
  for (const [i, pr] of members.entries()) {
    if (DRY) {
      log(
        `dry-run, would: update #${pr.number}, require tree ${pr.tree.slice(0, 12)}, post ${FULL_VERIFY}, squash`,
      );
      merged.push(pr);
      continue;
    }
    try {
      const head = await headAfterUpdate(pr);
      const headTree = ghText('api', `repos/${repo()}/commits/${head}`, '--jq', '.commit.tree.sha');
      const d = creditDecision({ headTree, expectedTree: pr.tree });
      if (!d.credit) throw new Error(d.reason);
      gh(
        'api',
        '-X',
        'POST',
        `repos/${repo()}/statuses/${head}`,
        '-f',
        'state=success',
        '-f',
        `context=${FULL_VERIFY}`,
        '-f',
        `target_url=${run.url}`,
        '-f',
        `description=${statusDescription({ position: i + 1, size: members.length, tipTree })}`,
      );
      gh('pr', 'merge', String(pr.number), '--squash', '--match-head-commit', head);
      merged.push(pr);
      log(`#${pr.number} merged (${d.reason})`);
    } catch (err) {
      log(`#${pr.number} not merged: ${err.message}; the rest go back to the queue`);
      // The later members' batch trees include this PR, so they cannot be
      // credited without it; they are re-batched next tick. This PR leaves the
      // queue so it does not stall every following batch.
      if (err.needsRebase) {
        comment(
          pr,
          `Групповое слияние: ветка не обновляется на main без конфликта (часто это PR поверх уже слитого squash). Перебазируйте на main (git rebase --onto origin/main <старая база>) и поставьте метку ${READY_LABEL} снова.`,
        );
        setLabel(pr, READY_LABEL, false);
      }
      break;
    }
  }
  return merged;
}

async function main() {
  sh('git', ['worktree', 'add', '-q', '--detach', WT]);
  try {
    await runBatch();
  } finally {
    sh('git', ['worktree', 'remove', '--force', WT]);
    rmSync(WT, { recursive: true, force: true });
  }
}

/** A light run cancelled by concurrency and never repeated: start it again. */
function rerunCancelled(pr) {
  for (const id of cancelledOnlyRuns(pr))
    act(`re-run cancelled run ${id} of #${pr.number}`, () => {
      try {
        gh('run', 'rerun', id, '--repo', repo());
      } catch (err) {
        log(`#${pr.number}: re-run ${id} failed: ${err.message}`);
      }
    });
}

async function runBatch() {
  const prs = listPrs();
  for (const pr of prs) {
    const why = rejectReason(pr);
    if (why !== 'no merge-ready label') log(`#${pr.number} ${why ?? 'ready'} — ${pr.title}`);
    if (why?.includes('CANCELLED') && (pr.labels ?? []).some((l) => l.name === READY_LABEL))
      rerunCancelled(pr);
    if (why && (pr.labels ?? []).some((l) => l.name === READY_LABEL)) noticeStuck(pr, why);
  }
  const { take: candidates, deferred } = deferStacked(selectCandidates(prs), isAncestor);
  for (const { pr, on } of deferred) log(`#${pr.number} waits: stacked on #${on}`);
  if (!shouldStart(candidates, trigger))
    return log(`nothing to do (${candidates.length} ready, trigger ${trigger})`);

  const base = mainSha();
  const batch = buildBranch(`batch/${stamp}`, candidates, base);
  for (const pr of batch.dropped) {
    comment(
      pr,
      `Групповое слияние: PR не сливается с main и остальными PR группы без конфликта, исключён из группы. Обновите ветку на main (gh pr update-branch ${pr.number}).`,
    );
  }
  if (batch.members.length === 0) return log('every candidate conflicted');
  log(
    `batch ${batch.name}: ${batch.members.map((p) => `#${p.number}`).join(' ')} → tree ${batch.members.at(-1).tree.slice(0, 12)}`,
  );
  ensureLabel(IN_BATCH_LABEL, 'In a merge batch (scripts/merge-batch.mjs)');
  for (const pr of batch.members) setLabel(pr, IN_BATCH_LABEL, true);

  let outcome = { mergedAny: false, verifiedTip: '' };
  try {
    outcome = await bisectAndMerge(batch.members, base);
  } finally {
    finish(batch.members, outcome);
  }
}

/** Full runs round by round until every member is merged, blamed or requeued. */
async function bisectAndMerge(members, base) {
  let mergedAny = false;
  let verifiedTip = '';
  let groups = [members];
  for (let round = 0; groups.length > 0; round += 1) {
    const results = await runGroups(groups, base, round);
    const decision = resolveRound(results, base, DRY ? base : mainSha());
    log(
      `round ${round}:`,
      results
        .map(
          (r) => `[${r.prs.map((p) => p.number).join(',')}] ${r.green ? 'green' : 'red'} ${r.url}`,
        )
        .join('  '),
    );
    if (decision.merge.length > 0) {
      const run = results.find((r) => r.prs === decision.merge);
      const merged = await mergeGroup(decision.merge, run);
      mergedAny = merged.length > 0 || mergedAny;
      // Only a fully merged group leaves main on the tree its run verified.
      verifiedTip = merged.length === decision.merge.length ? decision.merge.at(-1).tree : '';
    }
    for (const pr of decision.culprits) {
      const run = results.find((r) => r.prs.length === 1 && r.prs[0].number === pr.number);
      comment(
        pr,
        `Групповое слияние: полный прогон этого PR поверх main красный — ${run?.url}. Метка ${READY_LABEL} снята; после исправления поставьте её снова.`,
      );
      setLabel(pr, READY_LABEL, false);
    }
    groups = DRY ? [] : decision.retest;
  }
  return { mergedAny, verifiedTip };
}

/** Labels off, one deploy for the whole batch, batch branches deleted. */
function finish(members, { mergedAny, verifiedTip }) {
  for (const pr of members) setLabel(pr, IN_BATCH_LABEL, false);
  if (mergedAny) {
    const mainTree = DRY ? verifiedTip : git('rev-parse', `${mainSha()}^{tree}`);
    // Deploy-only only when main is exactly the verified tip; a partial merge
    // left an untested intermediate tree, which gets every gate before deploy.
    const verified = verifiedTip !== '' && mainTree === verifiedTip;
    const inputs = verified ? ['-f', 'deploy_verified=true'] : [];
    act(`dispatch ${verified ? 'deploy-only' : 'full-gate'} run of main`, () =>
      gh('workflow', 'run', WORKFLOW, '--ref', 'main', ...inputs),
    );
  }
  if (DRY) return;
  const refs = git('ls-remote', '--heads', 'origin', `batch/${stamp}*`).split('\n').filter(Boolean);
  for (const line of refs) git('push', '-q', 'origin', `:${line.split('\t')[1]}`);
}

main().catch((err) => {
  console.error('[merge-batch] failed:', err.message);
  process.exit(1);
});
