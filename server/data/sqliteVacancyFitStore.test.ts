import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SealedText } from './sealedText';
import { SqliteVacancyFitStore } from './sqliteVacancyFitStore';
import { evaluateVacancyFit, type VacancyFitInput } from '../domain/vacancyFit';

function input(candidateId = 'candidate-a'): VacancyFitInput {
  return { candidateId, vacancyId: 'vacancy', description: 'TypeScript required. Node. SQL.', requirements: [{ id: 'r1', text: 'TypeScript', sourceQuote: 'TypeScript required', origin: 'explicit', importance: 'high', kind: 'experience', hard: true, stopFactor: false }, ...['Node', 'SQL'].map((skill) => ({ id: skill, text: skill, sourceQuote: skill, origin: 'structural' as const, importance: 'medium' as const, kind: 'other' as const, hard: false, stopFactor: false }))], facts: [{ id: 'f1', candidateId, kind: 'fact', status: 'confirmed', statement: 'PRIVATE TypeScript services on Node with SQL', sourceMessageIds: ['m1'], sensitive: false }], gates: { role: { status: 'matched', reason: 'verified' }, level: { status: 'matched', reason: 'verified' }, region: { status: 'matched', reason: 'verified' }, workAuthorization: { status: 'matched', reason: 'verified' }, workFormat: { status: 'matched', reason: 'verified' } }, assessments: ['r1', 'Node', 'SQL'].map((requirementId) => ({ requirementId, status: 'matched' as const, evidence: [{ factId: 'f1', quote: requirementId === 'r1' ? 'TypeScript' : requirementId }] })) };
}
function setup() {
  const database = new DatabaseSync(':memory:');
  return { database, store: new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7))) };
}
const now = '2026-10-18T10:00:00.000Z';

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
