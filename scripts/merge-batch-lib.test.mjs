import { describe, expect, it } from 'vitest';
import {
  cancelledOnlyRuns,
  creditDecision,
  effectiveChecks,
  inheritParentChecks,
  isOwnMainMerge,
  shouldNoticeStuck,
  deferStacked,
  parseGhJson,
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
