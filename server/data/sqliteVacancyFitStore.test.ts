import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SealedText } from './sealedText';
import { SqliteVacancyFitStore } from './sqliteVacancyFitStore';
import { evaluateVacancyFit, type VacancyFitInput } from '../domain/vacancyFit';

function input(candidateId = 'candidate-a'): VacancyFitInput {
  return { candidateId, vacancyId: 'vacancy', description: 'TypeScript required. Node. SQL.', requirements: [{ id: 'r1', text: 'TypeScript', sourceQuote: 'TypeScript required', origin: 'explicit', importance: 'high', kind: 'experience', hard: true, stopFactor: false }, ...['Node', 'SQL'].map((skill) => ({ id: skill, text: skill, sourceQuote: skill, origin: 'structural' as const, importance: 'medium' as const, kind: 'other' as const, hard: false, stopFactor: false }))], facts: [{ id: 'f1', candidateId, kind: 'fact', status: 'confirmed', statement: 'PRIVATE TypeScript services on Node with SQL', sourceMessageIds: ['m1'], sensitive: false }], checkedFactIds: ['f1'], gates: { role: { status: 'matched', reason: 'verified' }, level: { status: 'matched', reason: 'verified' }, region: { status: 'matched', reason: 'verified' }, workAuthorization: { status: 'matched', reason: 'verified' }, workFormat: { status: 'matched', reason: 'verified' } }, assessments: ['r1', 'Node', 'SQL'].map((requirementId) => ({ requirementId, status: 'matched' as const, evidence: [{ factId: 'f1', quote: requirementId === 'r1' ? 'TypeScript' : requirementId }] })) };
}
function setup() {
  const database = new DatabaseSync(':memory:');
  return { database, store: new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7))) };
}
const now = '2026-10-18T10:00:00.000Z';

describe('a recount of one candidate (04.11)', () => {
  // As on prod: the sweep queues the input without requirements, the worker stores under the input with them.
  function counted(store: SqliteVacancyFitStore, candidateId = 'candidate-a') {
    const resolved = input(candidateId);
    const queued = { ...resolved, requirements: [] };
    store.enqueue(queued, now);
    const claimed = store.claim({ now })!;
    expect(store.complete(claimed, evaluateVacancyFit(resolved, now), now, resolved)).toBe(true);
    return { queued, resolved };
  }

  it('the result and its finished job go together, so the row is asked again and its percent stays on screen', () => {
    const { database, store } = setup();
    const { queued, resolved } = counted(store);
    const other = input('candidate-b');
    store.putCache(other, evaluateVacancyFit(other, now), now);
    expect(store.cacheKey(queued)).not.toBe(store.cacheKey(resolved));

    expect(store.assessedResults('candidate-a')).toEqual([{ key: store.cacheKey(resolved), vacancyId: 'vacancy', percent: 100, updatedAt: now }]);
    expect(store.forgetResult(queued, resolved)).toEqual({ result: true, job: true });

    expect(store.getCache(resolved)).toBeUndefined();
    expect(store.enqueue(queued, now).status).toBe('pending');
    expect(store.getPreviousCache(resolved)?.coveragePercent).toBe(100);
    expect(store.getCache(other)?.coveragePercent).toBe(100);
    database.close();
  });
  it('a row whose result is already gone still loses its finished job: the first batch of 04.11', () => {
    const { database, store } = setup();
    const { queued, resolved } = counted(store);
    store.forgetResult(queued, resolved);
    store.enqueue(queued, now);
    const claimed = store.claim({ now })!;
    store.complete(claimed, evaluateVacancyFit(resolved, now), now, resolved);
    database.prepare('DELETE FROM vacancy_fit_cache').run();
    expect(store.forgetResult(queued, resolved)).toEqual({ result: false, job: true });
    expect(store.enqueue(queued, now).status).toBe('pending');
    database.close();
  });
  it('leaves a job still waiting or failed and only assessed rows are listed', () => {
    const { database, store } = setup();
    const row = input();
    const waiting = { ...row, requirements: [] };
    store.enqueue(waiting, now);
    store.putCache(row, evaluateVacancyFit(row, now), now);
    expect(store.forgetResult(waiting, row)).toEqual({ result: true, job: false });
    expect(store.getJobState(waiting)).toBe('pending');
    const blocked = { ...input('candidate-c'), gates: { ...input().gates, role: { status: 'blocked', reason: 'x' } } } as VacancyFitInput;
    store.putCache(blocked, evaluateVacancyFit(blocked, now), now);
    expect(store.assessedResults('candidate-c')).toEqual([]);
    database.close();
  });
  it('lists the newest result of a vacancy: an older profile is not read anyway', () => {
    const { database, store } = setup();
    const row = input();
    store.putCache(row, evaluateVacancyFit(row, now), now);
    const newer = { ...row, facts: [{ ...row.facts[0]!, statement: `${row.facts[0]!.statement} more` }] };
    store.putCache(newer, evaluateVacancyFit(newer, now), '2026-10-19T10:00:00.000Z');
    expect(store.assessedResults('candidate-a').map((item) => item.updatedAt)).toEqual(['2026-10-19T10:00:00.000Z']);
    database.close();
  });
});

describe('duties of the text (04.11)', () => {
  it('a row stored before the rule still reads, with its verdicts, and asks the model nothing', () => {
    const { database, store } = setup();
    const lines = ['Own the budget', 'Run the audits', 'Budget models', 'Excel', 'SQL'];
    const description = `Responsibilities\n- ${lines[0]}\n- ${lines[1]}\nRequired skills\n- ${lines[2]}\n- ${lines[3]}\n- ${lines[4]}`;
    const row: VacancyFitInput = {
      ...input(), description,
      requirements: lines.map((text, index) => ({ id: `r${index}`, text, sourceQuote: text, origin: 'explicit', importance: 'high', kind: 'other', hard: false, stopFactor: false, skill: true })),
      assessments: lines.map((_, index) => ({ requirementId: `r${index}`, status: index < 2 ? 'unknown' : 'matched', evidence: index < 2 ? [] : [{ factId: 'f1', quote: 'TypeScript' }] })),
    };
    const stored = evaluateVacancyFit(row, now);
    store.putCache(row, stored, now);
    const key = (database.prepare('SELECT cache_key FROM vacancy_fit_cache').get() as { cache_key: string }).cache_key;
    const { duties: _duties, ...before } = stored;
    const old = JSON.stringify({ ...before, coveragePercent: 60, coverage: { ...before.coverage, total: 5 } });
    database.prepare('UPDATE vacancy_fit_cache SET result_cipher = ?').run(new SealedText(Buffer.alloc(32, 7)).seal(old, key));
    const read = store.getCache(row);
    expect(read?.coveragePercent).toBe(100);
    expect(read?.duties).toEqual(['r0', 'r1']);
    expect(read?.assessments).toHaveLength(5);
    database.close();
  });
});

describe('encrypted persistent vacancy fit cache and queue', () => {
  it('isolates tenants and invalidates changed profiles, descriptions and gate outcomes', () => {
    const { database, store } = setup();
    const a = input();
    store.putCache(a, evaluateVacancyFit(a), now);
    expect(store.getCache(a)?.coveragePercent).toBe(100);
    expect(store.getCache(input('candidate-b'))).toBeUndefined();
    expect(store.getCache({ ...a, facts: [] })).toBeUndefined();
    expect(store.getCache({ ...a, description: 'changed' })).toBeUndefined();
    expect(store.getCache({ ...a, gates: { ...a.gates, role: { status: 'unknown', reason: 'unknown' } } })).toBeUndefined();
    expect(JSON.stringify(database.prepare('SELECT * FROM vacancy_fit_cache').all())).not.toContain('candidate-a');
    database.close();
  });
  it('lists the vacancies with a stored result for one candidate in a single read, never another tenant', () => {
    const { database, store } = setup();
    const a = input();
    const other = { ...input(), vacancyId: 'vacancy-2' };
    store.putCache(a, evaluateVacancyFit(a), now);
    store.putCache(other, evaluateVacancyFit(other), now);
    const b = input('candidate-b');
    store.putCache(b, evaluateVacancyFit(b), now);
    expect([...store.cachedVacancyIds('candidate-a')].sort()).toEqual(['vacancy', 'vacancy-2']);
    expect([...store.cachedVacancyIds('candidate-c')]).toEqual([]);
    database.close();
  });
  it('warms the stored-result ids in batches that yield, then a list read opens nothing (prod 03.11: 4 s on the first read of a process)', async () => {
    const { database } = setup();
    const sealed = new SealedText(Buffer.alloc(32, 7));
    const store = new SqliteVacancyFitStore(database, sealed);
    const ids = Array.from({ length: 7 }, (_, index) => `vacancy-${index}`);
    for (const vacancyId of ids) { const row = { ...input(), vacancyId }; store.putCache(row, evaluateVacancyFit(row), now); }
    const other = input('candidate-b');
    store.putCache(other, evaluateVacancyFit(other), now);
    const opened = vi.spyOn(sealed, 'open');
    let yields = 0;
    await store.warmCachedVacancyIds('candidate-a', { batch: 3, yieldToLoop: async () => { yields += 1; } });
    expect(yields).toBe(3);
    expect(opened).toHaveBeenCalledTimes(7);
    opened.mockClear();
    expect([...store.cachedVacancyIds('candidate-a')].sort()).toEqual([...ids].sort());
    expect(opened).not.toHaveBeenCalled();
    database.close();
  });
  it('opens only rows stored since the last read (prod 02.11: every list page opened them all)', () => {
    const { database } = setup();
    const sealed = new SealedText(Buffer.alloc(32, 7));
    const opened = vi.spyOn(sealed, 'open');
    const store = new SqliteVacancyFitStore(database, sealed);
    const a = input();
    store.putCache(a, evaluateVacancyFit(a), now);
    expect([...store.cachedVacancyIds('candidate-a')]).toEqual(['vacancy']);
    opened.mockClear();
    expect([...store.cachedVacancyIds('candidate-a')]).toEqual(['vacancy']);
    expect(opened).not.toHaveBeenCalled();
    const second = { ...input(), vacancyId: 'vacancy-2' };
    // Another process (the maintenance worker) writes the row: the store did not see the write.
    new SqliteVacancyFitStore(database, sealed).putCache(second, evaluateVacancyFit(second), now);
    opened.mockClear();
    expect([...store.cachedVacancyIds('candidate-a')].sort()).toEqual(['vacancy', 'vacancy-2']);
    expect(opened).toHaveBeenCalledTimes(1);
    database.prepare('DELETE FROM vacancy_fit_cache WHERE rowid = (SELECT MIN(rowid) FROM vacancy_fit_cache)').run();
    expect([...store.cachedVacancyIds('candidate-a')]).toEqual(['vacancy-2']);
    database.close();
  });
  it('hands the same id set to every read until a row lands (PRB-041: each page copied thousands of ids)', () => {
    const { database } = setup();
    const store = new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7)));
    const a = input();
    store.putCache(a, evaluateVacancyFit(a), now);
    const first = store.cachedVacancyIds('candidate-a');
    expect(store.cachedVacancyIds('candidate-a')).toBe(first);
    const second = { ...input(), vacancyId: 'vacancy-2' };
    store.putCache(second, evaluateVacancyFit(second), now);
    const after = store.cachedVacancyIds('candidate-a');
    expect(after).not.toBe(first);
    expect([...first]).toEqual(['vacancy']);
    expect([...after].sort()).toEqual(['vacancy', 'vacancy-2']);
    database.close();
  });
  it('persists queue/cache across store recreation and never exposes profile statements in SQLite rows', () => {
    const { database, store } = setup();
    const a = input();
    store.enqueue(a, now);
    expect(JSON.stringify(database.prepare('SELECT * FROM vacancy_fit_queue').all())).not.toContain('PRIVATE');
    const restarted = new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7)));
    const job = restarted.claim({ now });
    expect(job?.input.facts[0].statement).toContain('PRIVATE');
    expect(restarted.complete(job!, evaluateVacancyFit(a), now)).toBe(true);
    expect(store.getCache(a)?.coveragePercent).toBe(100);
    database.close();
  });
  it('recovers durable work after the SQLite connection is closed and reopened', () => {
    const folder = mkdtempSync(join(tmpdir(), 'oq-fit-'));
    const path = join(folder, 'fit.sqlite');
    const sealed = new SealedText(Buffer.alloc(32, 8));
    const a = input();
    try {
      const first = new DatabaseSync(path);
      new SqliteVacancyFitStore(first, sealed).enqueue(a, now);
      first.close();
      const second = new DatabaseSync(path);
      const restarted = new SqliteVacancyFitStore(second, sealed);
      const job = restarted.claim({ now })!;
      expect(restarted.complete(job, evaluateVacancyFit(a), now)).toBe(true);
      second.close();
      const third = new DatabaseSync(path);
      expect(new SqliteVacancyFitStore(third, sealed).getCache(a)?.coveragePercent).toBe(100);
      third.close();
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  it('enqueues idempotently and fences old/expired leases', () => {
    const { database, store } = setup();
    const a = input();
    expect(store.enqueue(a, now).key).toBe(store.enqueue(a, now).key);
    const first = store.claim({ now, leaseMs: 1000 })!;
    expect(store.claim({ now })).toBeUndefined();
    const later = '2026-10-18T10:00:02.000Z';
    const second = store.claim({ now: later })!;
    expect(second.attempts).toBe(2);
    expect(store.complete(first, evaluateVacancyFit(a), later)).toBe(false);
    expect(store.fail(first, { now: later })).toBe(false);
    expect(store.complete(second, evaluateVacancyFit(a), later)).toBe(true);
    expect(store.claim({ now: later })).toBeUndefined();
    database.close();
  });
  it('caches resolved requirements atomically without accepting a changed candidate profile', () => {
    const { database, store } = setup();
    const original = { ...input(), requirements: [] };
    store.enqueue(original, now);
    const job = store.claim({ now })!;
    const resolved = input();
    expect(() => store.complete(job, evaluateVacancyFit({ ...resolved, facts: [] }), now, { ...resolved, facts: [] })).toThrow('resolved input scope mismatch');
    expect(store.complete(job, evaluateVacancyFit(resolved), now, resolved)).toBe(true);
    expect(store.getCache(resolved)?.coveragePercent).toBe(100);
    expect(store.getCache(original)).toBeUndefined();
    database.close();
  });
  it('does not accept another candidate result and deletes facts, queue and cache by tenant', () => {
    const { database, store } = setup();
    const a = input();
    const b = input('candidate-b');
    expect(() => store.putCache(a, evaluateVacancyFit(b))).toThrow('scope mismatch');
    store.putCache(a, evaluateVacancyFit(a));
    store.putCache(b, evaluateVacancyFit(b));
    store.enqueue(a); store.enqueue(b);
    store.deleteCandidate(a.candidateId);
    expect(store.getCache(a)).toBeUndefined();
    expect(store.getCache(b)).toBeDefined();
    expect(database.prepare('SELECT count(*) as n FROM vacancy_fit_queue').get()).toEqual({ n: 1 });
    database.close();
  });
  it('rejects numerical cache claims that do not derive from validated facts', () => {
    const { database, store } = setup();
    const a = { ...input(), facts: [] };
    expect(() => store.putCache(a, { ...evaluateVacancyFit(a), coveragePercent: 100 })).toThrow('unverified vacancy fit result');
    database.close();
  });
  it('caches honest unknown outcomes without changing them into numbers', () => {
    const { database, store } = setup();
    const a = { ...input(), facts: [] };
    store.putCache(a, evaluateVacancyFit(a));
    expect(store.getCache(a)?.coveragePercent).toBeNull();
    database.close();
  });
});

describe('jobs queued by another release (B562-r)', () => {
  it('re-keys a job whose fingerprint changed instead of failing it silently', () => {
    const { database, store } = setup();
    const sealed = new SealedText(Buffer.alloc(32, 7));
    const job = input();
    // The HTTP process of 4c9dac14 queued this row under its key while the 043b1004 worker was still running (25.10, 15:03–15:06).
    const otherKey = sealed.indexToken('vacancy-fit:candidate-a', 'fingerprint of another release');
    database.prepare(`INSERT INTO vacancy_fit_queue(cache_key,candidate_key,input_cipher,status,requested_at,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?)`)
      .run(otherKey, sealed.indexToken('vacancy-fit-candidate', 'candidate-a'), sealed.seal(JSON.stringify(job), otherKey), now, now, now);
    const claimed = store.claim({ now });
    expect(claimed?.key).toBe(store.cacheKey(job));
    expect(claimed?.input.vacancyId).toBe('vacancy');
    expect(database.prepare("SELECT COUNT(*) AS n FROM vacancy_fit_queue WHERE status='failed'").get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM vacancy_fit_queue WHERE cache_key=?').get(otherKey)).toEqual({ n: 0 });
    database.close();
  });

  it('still fails a row it cannot decrypt', () => {
    const { database, store } = setup();
    database.prepare(`INSERT INTO vacancy_fit_queue(cache_key,candidate_key,input_cipher,status,requested_at,created_at,updated_at) VALUES('k','c','broken','pending',?,?,?)`).run(now, now, now);
    expect(store.claim({ now })).toBeUndefined();
    expect(database.prepare("SELECT status FROM vacancy_fit_queue WHERE cache_key='k'").get()).toEqual({ status: 'failed' });
    database.close();
  });

  it('carries a result stored under the profile stamp of an earlier release to the new stamp (B580)', () => {
    const { database, store } = setup();
    const old = { ...input(), profileContextHash: 'stamp-with-about-text' };
    store.putCache(old, evaluateVacancyFit(old), now);
    const current = { ...input(), profileContextHash: 'stamp-of-compared-fields', legacyProfileContextHash: 'stamp-with-about-text' };

    expect(store.getCache(current)?.coveragePercent).toBe(100);
    expect(store.getCache({ ...current, legacyProfileContextHash: undefined })?.coveragePercent).toBe(100);
    expect(store.getCache({ ...current, legacyProfileContextHash: 'other-profile', profileContextHash: 'new' })).toBeUndefined();
    database.close();
  });

  it('carries a result stored under the stamp with role names to the stamp without them (29.10)', () => {
    const { database, store } = setup();
    const old = { ...input(), profileContextHash: 'stamp-with-role-names' };
    store.putCache(old, evaluateVacancyFit(old), now);
    const current = { ...input(), profileContextHash: 'stamp-without-roles', roleScopedProfileContextHash: 'stamp-with-role-names' };

    expect(store.getCache(current)?.coveragePercent).toBe(100);
    expect(store.getCache({ ...current, roleScopedProfileContextHash: undefined })?.coveragePercent).toBe(100);
    expect(store.getCache({ ...current, profileContextHash: 'renamed', roleScopedProfileContextHash: 'stamp-with-other-roles' })).toBeUndefined();
    database.close();
  });

  it('a consultant hypothesis or open question does not move the cache key (B580-r)', () => {
    const { database, store } = setup();
    const base = input();
    const hypothesis = { id: 'h1', candidateId: 'candidate-a', kind: 'hypothesis', status: 'proposed' as const, statement: 'Может подойти роль CTO', sourceMessageIds: ['m2'], sensitive: false };
    expect(store.cacheKey({ ...base, facts: [...base.facts, hypothesis] })).toBe(store.cacheKey(base));
    expect(store.cacheKey({ ...base, facts: [{ ...base.facts[0], statement: 'PRIVATE Go services' }] })).not.toBe(store.cacheKey(base));
    database.close();
  });

  it('carries a result keyed by every fact under the previous stamp to the evidence-only key (B580-r)', () => {
    const { database, store } = setup();
    const hypothesis = { id: 'h1', candidateId: 'candidate-a', kind: 'hypothesis', status: 'proposed' as const, statement: 'Может подойти роль CTO', sourceMessageIds: ['m2'], sensitive: false };
    const withHypothesis = { ...input(), facts: [...input().facts, hypothesis] };
    const old = { ...withHypothesis, profileContextHash: 'stamp-of-all-memory' };
    // A row the B580 release wrote: its key hashed every memory row, the hypothesis included.
    const sealed = new SealedText(Buffer.alloc(32, 7));
    const oldKey = store.cacheKey(old, undefined, 'all');
    database.prepare('INSERT INTO vacancy_fit_cache(cache_key,candidate_key,result_cipher,updated_at) VALUES(?,?,?,?)')
      .run(oldKey, sealed.indexToken('vacancy-fit-candidate', 'candidate-a'), sealed.seal(JSON.stringify(evaluateVacancyFit(old)), oldKey), now);
    const current = { ...withHypothesis, profileContextHash: 'stamp-of-evidence', previousProfileContextHash: 'stamp-of-all-memory' };

    expect(store.getCache(current)?.coveragePercent).toBe(100);
    expect(store.getCache({ ...current, previousProfileContextHash: undefined })?.coveragePercent).toBe(100);
    database.close();
  });

  it('B580: the visible page is claimed before the background sweep, the sweep in relevance order', () => {
    const { database, store } = setup();
    const at = (vacancyId: string) => ({ ...input(), vacancyId });
    store.enqueue(at('visible'), now);
    store.enqueue(at('sweep-1'), '2026-10-18T10:00:01.000Z', { backgroundRank: 0 });
    store.enqueue(at('sweep-2'), '2026-10-18T10:00:02.000Z', { backgroundRank: 1 });

    const order = [1, 2, 3].map(() => store.claim({ now: '2026-10-18T10:00:03.000Z' })?.input.vacancyId);

    expect(order).toEqual(['visible', 'sweep-1', 'sweep-2']);
    database.close();
  });
});
