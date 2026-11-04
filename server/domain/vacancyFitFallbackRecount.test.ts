import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_RECOUNT_DAY_USD,
  FALLBACK_RECOUNT_TASK,
  askVertexOnce,
  recountFallbackRows,
  type FallbackRecountDeps,
  type FallbackRecountRow,
  type VertexOnceOutcome,
} from './vacancyFitFallbackRecount';
import type { VacancyFitInput, VacancyFitResult } from './vacancyFit';

const input = (vacancyId: string): VacancyFitInput =>
  ({ candidateId: 'candidate', vacancyId }) as VacancyFitInput;
const rowOf = (vacancyId: string): FallbackRecountRow => ({ key: `key-${vacancyId}`, candidateId: 'candidate', vacancyId });
const result = { status: 'assessed' } as VacancyFitResult;
const answered: VertexOnceOutcome = { kind: 'answered', result, answeredBy: 'vertex gemini-3.8-flash' };

function harness(rows: readonly FallbackRecountRow[], outcomes: readonly VertexOnceOutcome[], overrides: Partial<FallbackRecountDeps> = {}) {
  const events: string[] = [];
  const queue = [...outcomes];
  const deps: FallbackRecountDeps = {
    rows: () => rows,
    resolve: (row) => input(row.vacancyId),
    keyOf: (resolved) => `key-${resolved.vacancyId}`,
    mark: (row) => { events.push(`mark ${row.vacancyId}`); },
    release: (row) => { events.push(`release ${row.vacancyId}`); },
    ask: async (resolved) => { events.push(`ask ${resolved.vacancyId}`); return queue.shift() ?? answered; },
    write: (resolved, _result, answeredBy) => { events.push(`write ${resolved.vacancyId} ${answeredBy}`); },
    spentToday: () => 0,
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
  return { deps, events };
}

describe('the one pass over rows a fallback model answered (05.11)', () => {
  it('marks the row before the call and writes the answer of Vertex', async () => {
    const { deps, events } = harness([rowOf('a')], [answered]);
    const report = await recountFallbackRows(deps);
    expect(events).toEqual(['mark a', 'ask a', 'write a vertex gemini-3.8-flash']);
    expect(report).toMatchObject({ rows: 1, answered: 1, noAnswer: 0, stale: 0, stopped: null });
  });

  it('a call that gave no answer leaves the old row and its mark, and is not asked again', async () => {
    const { deps, events } = harness([rowOf('a'), rowOf('b')], [{ kind: 'no_answer', failure: 'vertex_timeout' }, answered]);
    const report = await recountFallbackRows(deps);
    expect(events).toEqual(['mark a', 'ask a', 'mark b', 'ask b', 'write b vertex gemini-3.8-flash']);
    expect(report).toMatchObject({ answered: 1, noAnswer: 1, failures: { vertex_timeout: 1 } });
  });

  it('a call the gate skipped cost nothing: the mark is released, the same row is asked after a pause', async () => {
    const { deps, events } = harness([rowOf('a')], [{ kind: 'skipped' }, answered]);
    const report = await recountFallbackRows(deps);
    expect(events).toEqual(['mark a', 'ask a', 'release a', 'mark a', 'ask a', 'write a vertex gemini-3.8-flash']);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ answered: 1, noAnswer: 0, stopped: null });
  });

  it('a gate that stays shut stops the pass with no mark left behind', async () => {
    const shut = Array.from({ length: 40 }, () => ({ kind: 'skipped' }) as const);
    const { deps, events } = harness([rowOf('a'), rowOf('b')], shut);
    const report = await recountFallbackRows(deps);
    expect(report.stopped).toBe('vertex_skipped');
    expect(events.filter((event) => event === 'mark a').length).toBe(events.filter((event) => event === 'release a').length);
    expect(events.some((event) => event.endsWith(' b'))).toBe(false);
  });

  it('stops at the day ceiling before the next call', async () => {
    let spent = FALLBACK_RECOUNT_DAY_USD - 0.01;
    const { deps, events } = harness([rowOf('a'), rowOf('b')], [answered], {
      spentToday: () => spent,
      write: () => { spent = FALLBACK_RECOUNT_DAY_USD; },
    });
    const report = await recountFallbackRows(deps);
    expect(events).toEqual(['mark a', 'ask a']);
    expect(report).toMatchObject({ answered: 1, stopped: 'day_ceiling' });
  });

  it('a row whose profile or text moved on is not paid for and not marked', async () => {
    const { deps, events } = harness([rowOf('a'), rowOf('b')], [answered], {
      resolve: (row) => (row.vacancyId === 'a' ? undefined : input(row.vacancyId)),
      keyOf: () => 'another-key',
    });
    const report = await recountFallbackRows(deps);
    expect(events).toEqual([]);
    expect(report).toMatchObject({ stale: 2, answered: 0 });
  });
});

describe('one question to Vertex', () => {
  const resolved: VacancyFitInput = { candidateId: 'c', vacancyId: 'vacancy', description: 'TypeScript required. Node. SQL.', requirements: [{ id: 'r1', text: 'TypeScript', sourceQuote: 'TypeScript required', origin: 'explicit', importance: 'high', kind: 'experience', hard: true, stopFactor: false }, ...['Node', 'SQL'].map((skill) => ({ id: skill, text: skill, sourceQuote: skill, origin: 'structural' as const, importance: 'medium' as const, kind: 'other' as const, hard: false, stopFactor: false }))], facts: [{ id: 'f1', candidateId: 'c', kind: 'fact', status: 'confirmed', statement: 'PRIVATE TypeScript services on Node with SQL', sourceMessageIds: ['m1'], sensitive: false }], checkedFactIds: ['f1'], gates: { role: { status: 'matched', reason: 'verified' }, level: { status: 'matched', reason: 'verified' }, region: { status: 'matched', reason: 'verified' }, workAuthorization: { status: 'matched', reason: 'verified' }, workFormat: { status: 'matched', reason: 'verified' } }, assessments: ['r1', 'Node', 'SQL'].map((requirementId) => ({ requirementId, status: 'matched' as const, evidence: [{ factId: 'f1', quote: requirementId === 'r1' ? 'TypeScript' : requirementId }] })) };

  it('asks only Vertex, once, under its own task', async () => {
    const complete = vi.fn(async () => ({ content: '{"assessments":[]}', provider: 'vertex', model: 'gemini-3.8-flash' }));
    await askVertexOnce({ complete } as never, 'run', resolved);
    const request = (complete.mock.calls[0] as never as [Record<string, unknown>])[0];
    expect(request).toMatchObject({ task: FALLBACK_RECOUNT_TASK, onlyVertex: true });
    expect(request.patientVertex).toBeFalsy();
    expect(request.firstLane).toBeUndefined();
  });

  it('names a skipped call apart from a failed one', async () => {
    const skip = { complete: async () => { throw new Error('Vertex gave no answer: no_stage'); } };
    const failed = { complete: async () => { throw new Error('Vertex gave no answer: vertex_timeout'); } };
    expect(await askVertexOnce(skip as never, 'run', resolved)).toEqual({ kind: 'skipped' });
    expect(await askVertexOnce(failed as never, 'run', resolved)).toEqual({ kind: 'no_answer', failure: 'vertex_timeout' });
  });
});
