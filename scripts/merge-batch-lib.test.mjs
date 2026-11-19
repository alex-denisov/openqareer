import { describe, expect, it } from 'vitest';
import {
  creditDecision,
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
