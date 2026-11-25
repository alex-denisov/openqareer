import { describe, expect, it } from 'vitest';
import {
  cancelledOnlyRuns,
  creditDecision,
  effectiveChecks,
  inheritParentChecks,
  isOwnMainMerge,
  isRetryableMergeError,
  retryMerge,
  shouldNoticeStuck,
  deferStacked,
  parseGhJson,
  parseLines,
  rejectReason,
  resolveRound,
  selectCandidates,
  shouldStart,
  split,
  statusDescription,
  waves,
} from './merge-batch-lib.mjs';

const green = [
  { name: 'Plan gates', conclusion: 'SUCCESS' },
  { name: 'Unit', conclusion: 'SKIPPED' },
];
const pr = (number, over = {}) => ({
  number,
  labels: [{ name: 'merge-ready' }],
  isDraft: false,
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  statusCheckRollup: green,
  ...over,
});

describe('rejectReason', () => {
  it('accepts a labelled PR with a green light run', () => {
    expect(rejectReason(pr(1))).toBeNull();
  });
  it.each(['Merge batch: IN_PROGRESS', 'Merge batch: FAILURE'])(
    'ignores the batcher job (%s)',
    (_) => {
      const own = {
        name: 'Merge batch',
        conclusion: _.includes('FAILURE') ? 'FAILURE' : '',
        status: 'IN_PROGRESS',
      };
      expect(rejectReason(pr(1, { statusCheckRollup: [...green, own] }))).toBeNull();
    },
  );
  it('skips an unreadable PR with the reason (B804)', () => {
    expect(rejectReason(pr(1, { readError: 'boom' }))).toBe('could not be read (boom)');
  });
  it('fails closed when GitHub cannot list every file', () => {
    expect(rejectReason(pr(1, { changedFiles: 3000 }))).toBe('too many files (3000)');
    expect(rejectReason(pr(1, { changedFiles: 2999 }))).toBeNull();
  });
  it('ignores the Full verify status itself', () => {
    expect(
      rejectReason(
        pr(1, { statusCheckRollup: [...green, { context: 'Full verify', state: 'PENDING' }] }),
      ),
    ).toBeNull();
  });
  it.each([
    ['no label', { labels: [] }, 'no merge-ready'],
    ['in a batch', { labels: ['merge-ready', 'in-batch'] }, 'already in a batch'],
    ['draft', { isDraft: true }, 'draft'],
    ['other base', { baseRefName: 'dev' }, 'base'],
    ['conflict', { mergeable: 'CONFLICTING' }, 'conflicts'],
    ['workflows', { touchesWorkflows: true }, 'workflows'],
    ['no checks', { statusCheckRollup: [] }, 'no light run'],
    [
      'pending',
      { statusCheckRollup: [{ name: 'Plan gates', status: 'IN_PROGRESS' }] },
      'not green',
    ],
    ['failed', { statusCheckRollup: [{ name: 'Lint', conclusion: 'FAILURE' }] }, 'Lint: FAILURE'],
  ])('rejects %s', (_, over, text) => {
    expect(rejectReason(pr(1, over))).toContain(text);
  });
});

describe('selectCandidates / shouldStart', () => {
  it('keeps ready PRs oldest first and caps the batch', () => {
    const prs = [pr(9), pr(3, { isDraft: true }), pr(5), pr(7)];
    expect(selectCandidates(prs).map((p) => p.number)).toEqual([5, 7, 9]);
    expect(selectCandidates(prs, 2).map((p) => p.number)).toEqual([5, 7]);
  });
  it('starts with two PRs, or one woken by its own label', () => {
    expect(shouldStart([pr(1), pr(2)], 'schedule')).toBe(true);
    expect(shouldStart([pr(1)], 'schedule')).toBe(false);
    expect(shouldStart([pr(1)], 'label')).toBe(true);
    expect(shouldStart([], 'label')).toBe(false);
  });
});

describe('split / waves', () => {
  it('halves in order, first half larger', () => {
    expect(split([1, 2, 3, 4, 5])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(split([1])).toEqual([[1]]);
  });
  it('runs at most two groups at once', () => {
    expect(waves([[1], [2], [3]])).toEqual([[[1], [2]], [[3]]]);
  });
});

describe('resolveRound', () => {
  it('merges a green batch while main has not moved', () => {
    expect(resolveRound([{ prs: [1, 2, 3], green: true }], 'm0', 'm0')).toEqual({
      merge: [1, 2, 3],
      culprits: [],
      requeue: [],
      retest: [],
    });
  });
  it('splits a red batch', () => {
    expect(resolveRound([{ prs: [1, 2, 3, 4], green: false }], 'm0', 'm0').retest).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
  it('red half + green half: green merges, red is bisected further', () => {
    const r = resolveRound(
      [
        { prs: [1, 2], green: false },
        { prs: [3, 4], green: true },
      ],
      'm0',
      'm0',
    );
    expect(r).toEqual({ merge: [3, 4], culprits: [], requeue: [], retest: [[1], [2]] });
  });
  it('both halves green (interaction): first merges, second is re-tested on new main', () => {
    const r = resolveRound(
      [
        { prs: [1, 2], green: true },
        { prs: [3], green: true },
      ],
      'm0',
      'm0',
    );
    expect(r.merge).toEqual([1, 2]);
    expect(r.requeue).toEqual([3]);
  });
  it('a red single is the culprit', () => {
    const r = resolveRound(
      [
        { prs: [1], green: false },
        { prs: [2], green: true },
      ],
      'm0',
      'm0',
    );
    expect(r.culprits).toEqual([1]);
    expect(r.merge).toEqual([2]);
  });
  it('never merges a group tested on a main that has since moved', () => {
    const r = resolveRound([{ prs: [2], green: true }], 'm0', 'm1');
    expect(r.merge).toEqual([]);
    expect(r.requeue).toEqual([2]);
  });
});

describe('creditDecision / statusDescription', () => {
  it('credits only identical trees', () => {
    expect(creditDecision({ headTree: 'abc', expectedTree: 'abc' }).credit).toBe(true);
    expect(creditDecision({ headTree: 'abc', expectedTree: 'abd' }).credit).toBe(false);
    expect(creditDecision({ headTree: '', expectedTree: 'abc' }).credit).toBe(false);
  });
  it('marks intermediate steps as not deployed alone', () => {
    expect(statusDescription({ position: 3, size: 3, tipTree: 'f'.repeat(40) })).toContain(
      'fully verified',
    );
    expect(statusDescription({ position: 1, size: 3, tipTree: 'f'.repeat(40) })).toContain(
      'not deployed alone',
    );
  });
});

describe('parseGhJson', () => {
  it('parses objects and empty output', () => {
    expect(parseGhJson('{"behind":0}\n')).toEqual({ behind: 0 });
    expect(parseGhJson('')).toBeNull();
  });
  it('rejects a bare sha with a clear message (scalar --jq is read as text)', () => {
    expect(() => parseGhJson('4ef6a1b2c3\n')).toThrow(/read scalar --jq output as text/);
  });
});

describe('parseLines', () => {
  it('reads every page of a paginated scalar --jq (PR of 150 files, B804)', () => {
    expect(parseLines('a.ts\nb.ts\n\n.github/workflows/x.yml\r\n')).toEqual([
      'a.ts',
      'b.ts',
      '.github/workflows/x.yml',
    ]);
  });
  it('returns an empty list for no output', () => {
    expect(parseLines('')).toEqual([]);
    expect(parseLines(undefined)).toEqual([]);
  });
});

describe('deferStacked', () => {
  const a = { number: 735, headRefOid: 'a' };
  const b = { number: 736, headRefOid: 'b' }; // branched from #735
  const c = { number: 737, headRefOid: 'c' };
  const anc = (x, y) => x === 'a' && y === 'b';
  it('takes the bottom of a stack and defers the PR built on it', () => {
    const r = deferStacked([a, b, c], anc);
    expect(r.take.map((p) => p.number)).toEqual([735, 737]);
    expect(r.deferred).toEqual([{ pr: b, on: 735 }]);
  });
  it('keeps independent PRs', () => {
    expect(deferStacked([a, c], () => false).take).toEqual([a, c]);
  });
});

describe('effectiveChecks / cancelledOnlyRuns', () => {
  const run = (id, conclusion, completedAt) => ({
    name: 'Plan gates',
    workflowName: 'Verify and deploy',
    status: 'COMPLETED',
    conclusion,
    completedAt,
    detailsUrl: `https://github.com/o/r/actions/runs/${id}/job/1`,
  });
  it('a cancelled duplicate does not hide the successful run (#742)', () => {
    const rollup = [
      run(44450053730, 'CANCELLED', '2026-11-19T04:00:05Z'),
      run(44450054137, 'SUCCESS', '2026-11-19T04:09:00Z'),
    ];
    expect(rejectReason(pr(742, { statusCheckRollup: rollup }))).toBeNull();
    expect(cancelledOnlyRuns(pr(742, { statusCheckRollup: rollup }))).toEqual([]);
  });
  it('the newest finished run wins over an older failure', () => {
    const rollup = [
      run(1, 'FAILURE', '2026-11-19T04:00:00Z'),
      run(2, 'SUCCESS', '2026-11-19T05:00:00Z'),
    ];
    expect(effectiveChecks(rollup)).toHaveLength(1);
    expect(effectiveChecks(rollup)[0].conclusion).toBe('SUCCESS');
  });
  it('a re-run in progress keeps the PR waiting', () => {
    const rollup = [
      run(1, 'CANCELLED', '2026-11-19T04:00:00Z'),
      { ...run(1, '', null), status: 'IN_PROGRESS' },
    ];
    expect(rejectReason(pr(1, { statusCheckRollup: rollup }))).toContain('not green');
  });
  it('only cancelled runs: still rejected, and the run is offered for re-run', () => {
    const rollup = [run(7, 'CANCELLED', '2026-11-19T04:00:00Z')];
    expect(rejectReason(pr(1, { statusCheckRollup: rollup }))).toContain('CANCELLED');
    expect(cancelledOnlyRuns(pr(1, { statusCheckRollup: rollup }))).toEqual(['7']);
  });
});

describe('bot merge heads (#809/#792/#784/#769)', () => {
  const merge = {
    author: 'github-actions[bot]',
    message: "Merge branch 'main' into claude/x",
    parents: ['p1', 'm1'],
  };
  const waiting = pr(809, {
    statusCheckRollup: [
      { name: 'Plan gates', status: 'ACTION_REQUIRED', conclusion: 'ACTION_REQUIRED' },
    ],
  });
  it('recognises only our clean merge of main', () => {
    expect(isOwnMainMerge(merge)).toBe(true);
    expect(isOwnMainMerge({ ...merge, author: 'alex' })).toBe(false);
    expect(isOwnMainMerge({ ...merge, parents: ['p1'] })).toBe(false);
    expect(isOwnMainMerge({ ...merge, message: 'feat: x' })).toBe(false);
  });
  it('borrows the green light run of the PR head under the merge', () => {
    const r = inheritParentChecks(waiting, merge, green);
    expect(rejectReason(r)).toBeNull();
    expect(r.inheritedFrom).toBe('p1');
  });
  it('does not borrow a red parent run or for a non-bot head', () => {
    const red = [{ name: 'Lint', conclusion: 'FAILURE' }];
    expect(rejectReason(inheritParentChecks(waiting, merge, red))).not.toBeNull();
    expect(
      rejectReason(inheritParentChecks(waiting, { ...merge, author: 'x' }, green)),
    ).not.toBeNull();
  });
  it('leaves a ready PR untouched', () => {
    expect(inheritParentChecks(pr(1), merge, [])).toEqual(pr(1));
  });
});

describe('shouldNoticeStuck', () => {
  it('comments once on a merge-ready PR skipped for an hour', () => {
    expect(
      shouldNoticeStuck({ reason: 'no light run yet', ageMin: 61, alreadyNoticed: false }),
    ).toBe(true);
    expect(
      shouldNoticeStuck({ reason: 'no light run yet', ageMin: 61, alreadyNoticed: true }),
    ).toBe(false);
    expect(
      shouldNoticeStuck({ reason: 'no light run yet', ageMin: 10, alreadyNoticed: false }),
    ).toBe(false);
    expect(
      shouldNoticeStuck({ reason: 'already in a batch', ageMin: 300, alreadyNoticed: false }),
    ).toBe(false);
    expect(shouldNoticeStuck({ reason: null, ageMin: 300, alreadyNoticed: false })).toBe(false);
  });
});

describe('isRetryableMergeError', () => {
  it.each([
    'GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)',
    'GraphQL: Pull Request is not mergeable (mergePullRequest)',
    'X Pull request o/r#1 is not mergeable: the base branch policy prohibits the merge.',
  ])('retries %s', (text) => {
    expect(isRetryableMergeError(`Command failed: gh pr merge 1 --squash\n${text}`)).toBe(true);
  });
  it.each([
    'tree abc ≠ batch def',
    'Command failed: gh pr merge 1\nGraphQL: Head branch was modified. Review and try again.',
    'Command failed: gh api statuses\nBase branch was modified',
    'main does not merge into #1 cleanly',
    '',
  ])('does not retry %s', (text) => {
    expect(isRetryableMergeError(text)).toBe(false);
  });
});

describe('retryMerge', () => {
  const refusal = 'Command failed: gh pr merge 1\nGraphQL: Base branch was modified.';
  const run = async (outcomes, merged = []) => {
    let calls = 0;
    let reads = 0;
    const result = await retryMerge({
      attempt: async () => {
        const o = outcomes[Math.min(calls++, outcomes.length - 1)];
        if (o === 'ok') return 'tree equals';
        throw new Error(o);
      },
      isMerged: async () => {
        const m = merged[reads++] ?? false;
        if (m === 'fail') throw new Error('HTTP 502');
        return m;
      },
      wait: async () => {},
      note: () => {},
    }).catch((err) => `threw: ${err.message.split('\n')[0]}`);
    return { result, calls };
  };
  it('retries a refusal, even when the merged state cannot be read', async () => {
    expect(await run([refusal, 'ok'], ['fail'])).toEqual({ result: 'tree equals', calls: 2 });
  });
  it('counts a PR that merged despite the fourth refusal', async () => {
    const out = await run([refusal], [false, false, false, true]);
    expect(out).toEqual({ result: 'merged despite the refusal', calls: 4 });
  });
  it('gives up after four refusals', async () => {
    const out = await run([refusal]);
    expect(out).toEqual({ result: 'threw: Command failed: gh pr merge 1', calls: 4 });
  });
  it('stops at once on a tree mismatch or a moved head', async () => {
    expect((await run(['tree a ≠ batch b'])).calls).toBe(1);
    const moved = 'Command failed: gh pr merge 1\nHead branch was modified';
    expect((await run([moved])).calls).toBe(1);
  });
});

describe('stale and cancelled runs (B804)', () => {
  const check = (name, id, conclusion, over = {}) => ({
    name,
    workflowName: 'Verify and deploy',
    status: conclusion ? 'COMPLETED' : 'IN_PROGRESS',
    conclusion,
    completedAt: conclusion ? `2026-11-25T10:0${id}:00Z` : '0001-01-01T00:00:00Z',
    detailsUrl: `https://github.com/o/r/actions/runs/${id}/job/1`,
    ...over,
  });
  const reason = (...checks) => rejectReason(pr(1, { statusCheckRollup: checks }));
  const reruns = (...checks) => cancelledOnlyRuns(pr(1, { statusCheckRollup: checks }));

  it('ignores a cancelled shard that the later green run does not have', () => {
    const old = check('Affected tests (shard 1/8)', 1, 'CANCELLED');
    expect(reason(old, check('Verify', 2, 'SUCCESS'))).toBeNull();
    expect(reruns(old, check('Verify', 2, 'SUCCESS'))).toEqual([]);
  });
  it('keeps a cancelled check without a later green Verify', () => {
    const old = check('Lint', 2, 'CANCELLED');
    expect(reason(old)).toMatch(/CANCELLED/);
    expect(reason(old, check('Verify', 1, 'SUCCESS'))).toMatch(/CANCELLED/);
    expect(reason(old, check('Verify', 3, 'FAILURE'))).toMatch(/CANCELLED|FAILURE/);
    expect(reason(old, check('Verify', 3, 'SUCCESS', { workflowName: 'Other' }))).toMatch(
      /CANCELLED/,
    );
  });
  it('never ignores a real failure of an older run', () => {
    const red = check('Affected tests (shard 7/8)', 1, 'FAILURE');
    expect(reason(red, check('Verify', 2, 'SUCCESS'))).toMatch(/FAILURE/);
  });
  it('waits for a running check instead of trusting its earlier result', () => {
    const going = check('Verify', 2, '');
    expect(reason(check('Verify', 1, 'SUCCESS'), going)).toMatch(/Verify: IN_PROGRESS/);
    expect(reason(check('Verify', 1, 'FAILURE'), going)).toMatch(/Verify: IN_PROGRESS/);
  });
  it('re-runs a cancelled run whose only failure is the aggregate Verify', () => {
    expect(reruns(check('Verify', 7, 'FAILURE'), check('Affected', 7, 'CANCELLED'))).toEqual(['7']);
  });
  it('does not re-run a run with a really failed shard', () => {
    const run = [check('S1', 7, 'CANCELLED'), check('S7', 7, 'FAILURE')];
    expect(reruns(...run, check('Verify', 7, 'FAILURE'))).toEqual([]);
  });
});
