import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractVacancyRequirements, type VacancyRequirementsInput } from '../domain/vacancyRequirements';
import { SqliteVacancyRequirementsStore } from './sqliteVacancyRequirementsStore';

describe('durable public vacancy requirement queue', () => {
  const databases: DatabaseSync[] = [];
  function setup() {
    const db = new DatabaseSync(':memory:'); databases.push(db);
    return { db, store: new SqliteVacancyRequirementsStore(db) };
  }
  afterEach(() => { for (const db of databases.splice(0)) db.close(); });
  const input = { vacancyId: 'v1', clusterId: 'c1', description: 'Requirements\n- SQL' };

  it('ensures schema idempotently and reuses exact cached results without model work', async () => {
    const { store, db } = setup();
    new SqliteVacancyRequirementsStore(db);
    store.enqueue(input, { titleStrategyPriority: 2, freshAt: 20 });
    const extract = vi.fn(async (source: VacancyRequirementsInput) => extractVacancyRequirements(source));
    await store.runNext('worker', extract, 100);
    expect(store.get(input)?.requirements[0].text).toBe('SQL');
    expect(store.enqueue(input)).toMatchObject({ state: 'cached' });
    expect(await store.runNext('worker', extract, 101)).toBeNull();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.getLatest('v1')?.descriptionHash).toBe(store.get(input)?.descriptionHash);
  });

  it('never serves a different extractor version through the runtime latest lookup', () => {
    const { store } = setup();
    const old = { ...input, extractorVersion: 'obsolete-extractor' };
    store.enqueue(old);
    store.complete(store.claim('old', 1)!, extractVacancyRequirements(old), 2);
    expect(store.getLatest(input.vacancyId)).toBeNull();
    const hash = extractVacancyRequirements(input).descriptionHash;
    expect(store.getLatest(input.vacancyId, hash)).toBeNull();
    expect(store.getLatest(input.vacancyId, hash, 'obsolete-extractor')?.extractorVersion).toBe('obsolete-extractor');
    store.enqueue(input);
    store.complete(store.claim('current', 3)!, extractVacancyRequirements(input), 4);
    expect(store.getLatest(input.vacancyId, hash)?.extractorVersion).toBe(extractVacancyRequirements(input).extractorVersion);
  });

  it('retains the worker lease through the bounded provider timeout and retry window', async () => {
    const { store, db } = setup();
    const other = new SqliteVacancyRequirementsStore(db);
    store.enqueue(input);
    let clock = 1000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    let replacement: ReturnType<typeof other.claim> = null;
    try {
      const result = await store.runNext('slow-provider', async (source) => {
        // Three permitted 60-second requests and two maximum 5-second retry pauses.
        clock += 190000;
        replacement = other.claim('competing-worker', clock);
        return extractVacancyRequirements(source);
      }, clock);
      expect(replacement).toBeNull();
      expect(result?.status).toBe('extracted');
      expect(store.get(input)?.status).toBe('extracted');
    } finally { dateNow.mockRestore(); }
  });

  it('invalidates by description, version and cluster', () => {
    const { store } = setup();
    const job = store.enqueue(input);
    expect(job.state).toBe('queued');
    expect(store.enqueue(input)).toMatchObject({ state: 'queued', jobId: job.jobId });
    expect(store.enqueue({ ...input, description: 'Different' }).jobId).not.toBe(job.jobId);
    expect(store.enqueue({ ...input, extractorVersion: 'next' }).jobId).not.toBe(job.jobId);
    expect(store.enqueue({ ...input, clusterId: 'c2' }).jobId).not.toBe(job.jobId);
  });

  it('prioritizes title/strategy before freshness and leases exclusively', () => {
    const { store, db } = setup();
    store.enqueue({ ...input, vacancyId: 'fresh' }, { titleStrategyPriority: 0, freshAt: 500 });
    store.enqueue({ ...input, vacancyId: 'top-old' }, { titleStrategyPriority: 5, freshAt: 1 });
    store.enqueue({ ...input, vacancyId: 'top-new' }, { titleStrategyPriority: 5, freshAt: 2 });
    expect(store.claim('a', 100, 50)?.input.vacancyId).toBe('top-new');
    const second = new SqliteVacancyRequirementsStore(db);
    expect(second.claim('b', 100, 50)?.input.vacancyId).toBe('top-old');
    expect(store.claim('c', 100, 50)?.input.vacancyId).toBe('fresh');
    expect(store.claim('d', 101, 50)).toBeNull();
  });

  it('retries failed work after backoff and rejects stale lease completion', () => {
    const { store } = setup(); store.enqueue(input);
    const old = store.claim('old', 100, 10)!;
    const replacement = store.claim('new', 111, 10)!;
    expect(() => store.complete(old, extractVacancyRequirements(input), 112)).toThrow(/lease/u);
    store.fail(replacement, 'provider_unavailable', 112);
    expect(store.claim('other', 113)).toBeNull();
    const retry = store.claim('retry', 10000)!;
    expect(retry.attempts).toBe(3);
    store.complete(retry, extractVacancyRequirements(input), 10001);
    expect(store.get(input)?.status).toBe('extracted');
  });

  it('caches source no_description without invoking fallback', async () => {
    const { store } = setup(); store.enqueue({ vacancyId: 'empty' });
    await store.runNext('worker', async (source) => extractVacancyRequirements(source), 1);
    expect(store.get({ vacancyId: 'empty' })?.status).toBe('no_description');
  });

  it('does not cache an unavailable model as an empty requirements success', async () => {
    const { store } = setup(); store.enqueue(input);
    await store.runNext('worker', async () => ({ ...extractVacancyRequirements(input), fallbackStatus: 'unavailable' }), 1);
    expect(store.get(input)).toBeNull();
    expect(store.claim('retry', 5000)?.attempts).toBe(2);
  });

  it('keeps the rule requirements after the last invalid model answer instead of failing the vacancy (B562-r)', async () => {
    const { store } = setup(); store.enqueue(input);
    const invalid = async () => ({ ...extractVacancyRequirements(input), fallbackStatus: 'invalid' as const });
    for (const now of [1, 10000]) {
      await store.runNext('worker', invalid, now);
      expect(store.get(input)).toBeNull();
    }
    const last = await store.runNext('worker', invalid, 20000);
    expect(last).toMatchObject({ method: 'rules', fallbackStatus: 'invalid', status: 'extracted' });
    expect(store.get(input)?.requirements.map((item) => item.text)).toEqual(['SQL']);
    expect(store.enqueue(input).state).toBe('cached');
  });

  it('still fails a vacancy whose model stayed unavailable: an outage is not a final answer', async () => {
    const { store } = setup(); store.enqueue(input);
    const down = async () => ({ ...extractVacancyRequirements(input), fallbackStatus: 'unavailable' as const });
    for (const now of [1, 10000, 20000]) await store.runNext('worker', down, now);
    expect(store.get(input)).toBeNull();
    expect(store.enqueue(input).state).toBe('failed');
  });

  it('preserves cached extraction across database process restarts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oq-requirements-'));
    let db = new DatabaseSync(join(directory, 'queue.sqlite'));
    try {
      const first = new SqliteVacancyRequirementsStore(db);
      first.enqueue(input);
      first.complete(first.claim('a', 1)!, extractVacancyRequirements(input), 2);
      db.close();
      db = new DatabaseSync(join(directory, 'queue.sqlite'));
      expect(new SqliteVacancyRequirementsStore(db).enqueue(input).state).toBe('cached');
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it('exposes exhausted retries instead of reporting work as newly queued', () => {
    const { store } = setup(); store.enqueue(input);
    for (const now of [1, 10000, 20000]) {
      const job = store.claim('worker', now)!;
      store.fail(job, 'provider_timeout', now + 1);
    }
    expect(store.enqueue(input).state).toBe('failed');
    expect(store.claim('worker', 999999)).toBeNull();
  });

  it('reuses an identical description across source vacancies within one cluster', () => {
    const { store } = setup(); store.enqueue(input);
    store.complete(store.claim('worker', 1)!, extractVacancyRequirements(input), 2);
    const alias = { ...input, vacancyId: 'another-source-id' };
    expect(store.enqueue(alias).state).toBe('cached');
    expect(store.get(alias)).toMatchObject({ vacancyId: alias.vacancyId, clusterId: 'c1' });
    expect(store.getLatest(alias.vacancyId)?.status).toBe('extracted');
  });
});
